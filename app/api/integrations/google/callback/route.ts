// app/api/integrations/google/callback/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { google } from "googleapis";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readGoogleCalendarIntegration, writeGoogleCalendarIntegration } from "@/lib/orgSettings";
import { getGoogleOAuthClient } from "@/lib/google/connect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function resolveOrigin(req: Request): string {
  const forwardedProto = req.headers.get("x-forwarded-proto");
  const forwardedHost = req.headers.get("x-forwarded-host");
  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`.replace(/\/+$/, "");
  }
  const envNextAuth = (process.env.NEXTAUTH_URL || "").trim();
  if (envNextAuth) return envNextAuth.replace(/\/+$/, "");
  const envPublic = (process.env.NEXT_PUBLIC_APP_URL || "").trim();
  if (envPublic) return envPublic.replace(/\/+$/, "");
  if (process.env.NODE_ENV !== "production") return "http://localhost:3000";
  return "";
}

function decodeState(state: string | null) {
  if (!state) return null;
  try {
    const json = Buffer.from(state, "base64url").toString("utf-8");
    return JSON.parse(json) as { orgId: string; nonce: string; ts: number };
  } catch {
    return null;
  }
}

function emailFromIdToken(idToken?: string | null): string | null {
  if (!idToken) return null;
  try {
    const parts = idToken.split(".");
    if (parts.length < 2) return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8")) as { email?: string };
    const email = payload?.email || "";
    return email.trim() || null;
  } catch {
    return null;
  }
}

function isSuperadmin(email?: string | null): boolean {
  if (!email) return false;
  const list = (process.env.SUPERADMINS || "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.trim().toLowerCase());
}

export async function GET(req: Request) {
  const origin = resolveOrigin(req);
  const redirectBase = origin || (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || "").trim();
  const redirectTarget = (path: string) => {
    const base = redirectBase.replace(/\/+$/, "");
    return base ? `${base}${path}` : path;
  };

  const fail = (reason: string) => {
    const url = redirectTarget(`/calendar/connect?status=error&reason=${encodeURIComponent(reason)}`);
    const res = NextResponse.redirect(url);
    res.cookies.delete("gcal_oauth_state");
    return res;
  };

  try {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      return fail("Google OAuth not configured.");
    }

    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const oauthError = url.searchParams.get("error");
    if (oauthError) return fail(oauthError);
    if (!code || !state) return fail("Missing code or state");

    const cookieState = (await cookies()).get("gcal_oauth_state")?.value || "";
    if (!cookieState || cookieState !== state) return fail("Invalid OAuth state");

    const payload = decodeState(state);
    if (!payload?.orgId) return fail("Invalid OAuth state payload");

    const session = await getServerSession(authOptions);
    const email = session?.user?.email || null;
    if (!email) return fail("Not authenticated");

    if (!isSuperadmin(email)) {
      const membership = await prisma.membership.findFirst({
        where: { orgId: payload.orgId, user: { email } },
        select: { id: true },
      });
      if (!membership) return fail("Not authorized for org");
    }

    if (!origin) return fail("Google OAuth origin could not be resolved.");

    const redirectUrl = `${origin}/api/integrations/google/callback`;
    if (process.env.NODE_ENV !== "production") {
      console.log("[google-oauth] callback redirect_uri:", redirectUrl);
    }
    const oauth2 = getGoogleOAuthClient(redirectUrl);
    const { tokens } = await oauth2.getToken(code);
    if (!tokens.access_token) return fail("Missing access token");

    oauth2.setCredentials(tokens);
    const oauth2api = google.oauth2({ version: "v2", auth: oauth2 });
    let accountEmail = "";
    try {
      const profile = await oauth2api.userinfo.get();
      accountEmail = profile.data.email || "";
    } catch {
      accountEmail = emailFromIdToken(tokens.id_token) || "";
    }
    if (!accountEmail) return fail("Google account email missing");

    const existing = await prisma.calendarConnection.findFirst({
      where: { orgId: payload.orgId, provider: "google", accountEmail },
      select: { id: true, refreshToken: true },
    });

    const refreshToken = tokens.refresh_token || existing?.refreshToken || "";
    const expiresAt = tokens.expiry_date ? new Date(tokens.expiry_date) : new Date(Date.now() + 55 * 60 * 1000);

    await prisma.calendarConnection.upsert({
      where: {
        orgId_provider_accountEmail: {
          orgId: payload.orgId,
          provider: "google",
          accountEmail,
        },
      },
      update: {
        accessToken: tokens.access_token,
        refreshToken,
        expiresAt,
      },
      create: {
        orgId: payload.orgId,
        provider: "google",
        accountEmail,
        accessToken: tokens.access_token,
        refreshToken,
        expiresAt,
      },
    });

    const os = await prisma.orgSettings.upsert({
      where: { orgId: payload.orgId },
      create: { orgId: payload.orgId, data: {} },
      update: {},
    });
    const data = { ...(os.data as Record<string, unknown>) };
    const existingGoogle = readGoogleCalendarIntegration(data);
    const next = writeGoogleCalendarIntegration(data, {
      connected: true,
      accountEmail,
      calendarId: existingGoogle.calendarId || "primary",
      syncEnabled: true,
    });

    await prisma.orgSettings.update({
      where: { orgId: payload.orgId },
      data: { data: next as any },
    });

    const res = NextResponse.redirect(redirectTarget("/calendar/connect?status=connected"));
    res.cookies.delete("gcal_oauth_state");
    return res;
  } catch (err: any) {
    console.error("[gcal oauth callback]", err);
    const message = err?.message || "OAuth failed";
    return fail(message);
  }
}
