import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolveBranding, type BrandingConfig } from "@/lib/branding";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

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
  return NextResponse.json({ ok: true, branding: resolveBranding(data) });
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

  const payload = (await req.json().catch(() => ({}))) as Partial<BrandingConfig>;

  const orgSettings = await prisma.orgSettings.findUnique({
    where: { orgId: membership.orgId },
    select: { data: true },
  });

  const data = (orgSettings?.data as Record<string, unknown>) || {};
  const next = resolveBranding({ ...data, branding: payload });

  await prisma.orgSettings.upsert({
    where: { orgId: membership.orgId },
    update: { data: { ...data, branding: next } as any },
    create: { orgId: membership.orgId, data: { branding: next } as any },
  });

  return NextResponse.json({ ok: true, branding: next });
}
