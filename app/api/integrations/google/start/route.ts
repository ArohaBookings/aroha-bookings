// app/api/integrations/google/start/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { buildGoogleAuthUrl } from "@/lib/integrations/google/calendar";
import { randomBytes } from "crypto";

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

  const session = await getServerSession(authOptions);
  const email = session?.user?.email || null;
  if (!email) {
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
  }

  const url = new URL(req.url);
  const orgId = (url.searchParams.get("orgId") || "").trim();
  if (!orgId) {
    return NextResponse.json({ ok: false, error: "Missing orgId" }, { status: 400 });
  }

  const isSuper = isSuperadmin(email);
  if (!isSuper) {
    const membership = await prisma.membership.findFirst({
      where: { orgId, user: { email } },
      select: { id: true },
    });
    if (!membership) {
      return NextResponse.json({ ok: false, error: "Not authorized for org" }, { status: 403 });
    }
  }

  const nonce = randomBytes(16).toString("hex");
  const statePayload = JSON.stringify({ orgId, nonce, ts: Date.now() });
  const state = Buffer.from(statePayload).toString("base64url");

  const origin = resolveOrigin(req);
  if (!origin) {
    return NextResponse.json(
      { ok: false, error: "Google OAuth origin could not be resolved (check NEXT_PUBLIC_APP_URL or NEXTAUTH_URL)." },
      { status: 500 }
    );
  }

  const redirectUrl = `${origin}/api/integrations/google/callback`;
  if (process.env.NODE_ENV !== "production") {
    console.log("[google-oauth] redirect_uri:", redirectUrl);
  }

  const authUrl = buildGoogleAuthUrl(state, redirectUrl);
  const res = NextResponse.redirect(authUrl);
  res.cookies.set("gcal_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60,
  });
  return res;
}
