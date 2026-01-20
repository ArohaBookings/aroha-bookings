// app/api/integrations/google/callback/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { google } from "googleapis";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { writeGoogleCalendarIntegration } from "@/lib/orgSettings";
import { getGoogleOAuthClient } from "@/lib/google/connect";
import { resolveOrigin } from "@/lib/http/origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function decodeState(state: string | null) {
  if (!state) return null;
  try {
    const json = Buffer.from(state, "base64url").toString("utf-8");
    return JSON.parse(json) as { orgId: string; nonce: string; ts: number };
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
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return NextResponse.json(
      { ok: false, error: "Google OAuth not configured (missing GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET)." },
      { status: 500 }
    );
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    return NextResponse.json({ ok: false, error: "Missing code or state" }, { status: 400 });
  }

  const cookieState = (await cookies()).get("gcal_oauth_state")?.value || "";
  if (!cookieState || cookieState !== state) {
    return NextResponse.json({ ok: false, error: "Invalid OAuth state" }, { status: 400 });
  }

  const payload = decodeState(state);
  if (!payload?.orgId) {
    return NextResponse.json({ ok: false, error: "Invalid OAuth state payload" }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  const email = session?.user?.email || null;
  if (!email) {
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
  }

  if (!isSuperadmin(email)) {
    const membership = await prisma.membership.findFirst({
      where: { orgId: payload.orgId, user: { email } },
      select: { id: true },
    });
    if (!membership) {
      return NextResponse.json({ ok: false, error: "Not authorized for org" }, { status: 403 });
    }
  }

  const origin = resolveOrigin(req);
  if (!origin) {
    return NextResponse.json(
      { ok: false, error: "Google OAuth origin could not be resolved (check NEXT_PUBLIC_APP_URL or NEXTAUTH_URL)." },
      { status: 500 }
    );
  }

  const redirectUrl = `${origin}/api/integrations/google/callback`;
  const oauth2 = getGoogleOAuthClient(redirectUrl);
  const { tokens } = await oauth2.getToken(code);
  if (!tokens.access_token) {
    return NextResponse.json({ ok: false, error: "Missing access token" }, { status: 400 });
  }

  oauth2.setCredentials(tokens);
  const oauth2api = google.oauth2({ version: "v2", auth: oauth2 });
  const profile = await oauth2api.userinfo.get();
  const accountEmail = profile.data.email || "";
  if (!accountEmail) {
    return NextResponse.json({ ok: false, error: "Google account email missing" }, { status: 400 });
  }

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
  const next = writeGoogleCalendarIntegration(data, {
    connected: true,
    accountEmail,
    syncEnabled: true,
  });

  await prisma.orgSettings.update({
    where: { orgId: payload.orgId },
    data: { data: next as any },
  });


  const res = NextResponse.redirect(`/settings?google=connected`);
  res.cookies.delete("gcal_oauth_state");
  return res;
}
