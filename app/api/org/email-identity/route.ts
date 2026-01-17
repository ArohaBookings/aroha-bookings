import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

type EmailIdentity = {
  fromName?: string;
  replyTo?: string;
  supportEmail?: string;
  footerText?: string;
};

function isValidEmail(email?: string | null) {
  if (!email) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeIdentity(input: EmailIdentity) {
  return {
    fromName: typeof input.fromName === "string" ? input.fromName.trim() : "",
    replyTo: isValidEmail(input.replyTo) ? input.replyTo!.trim() : "",
    supportEmail: isValidEmail(input.supportEmail) ? input.supportEmail!.trim() : "",
    footerText: typeof input.footerText === "string" ? input.footerText.trim() : "",
  };
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
  }

  const membership = await prisma.membership.findFirst({
    where: { user: { email: session.user.email } },
    select: { orgId: true },
    orderBy: { orgId: "asc" },
  });

  if (!membership?.orgId) {
    return NextResponse.json({ ok: false, error: "No organization" }, { status: 400 });
  }

  const orgSettings = await prisma.orgSettings.findUnique({
    where: { orgId: membership.orgId },
    select: { data: true },
  });
  const data = (orgSettings?.data as Record<string, unknown>) || {};
  const identity = normalizeIdentity((data.emailIdentity as EmailIdentity) || {});

  return NextResponse.json({ ok: true, identity });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
  }

  const membership = await prisma.membership.findFirst({
    where: { user: { email: session.user.email } },
    select: { orgId: true },
    orderBy: { orgId: "asc" },
  });

  if (!membership?.orgId) {
    return NextResponse.json({ ok: false, error: "No organization" }, { status: 400 });
  }

  const payload = (await req.json().catch(() => ({}))) as EmailIdentity;
  const identity = normalizeIdentity(payload);

  const orgSettings = await prisma.orgSettings.findUnique({
    where: { orgId: membership.orgId },
    select: { data: true },
  });
  const data = (orgSettings?.data as Record<string, unknown>) || {};

  await prisma.orgSettings.upsert({
    where: { orgId: membership.orgId },
    update: { data: { ...data, emailIdentity: identity } as any },
    create: { orgId: membership.orgId, data: { emailIdentity: identity } as any },
  });

  return NextResponse.json({ ok: true, identity });
}
