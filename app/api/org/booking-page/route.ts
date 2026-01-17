// app/api/org/booking-page/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolveBookingPageConfig, type BookingPageConfig } from "@/lib/booking/templates";

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
    select: { orgId: true, org: { select: { niche: true } } },
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
  const config = resolveBookingPageConfig(membership.org?.niche ?? null, data);

  return NextResponse.json({ ok: true, config });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
  }

  const membership = await prisma.membership.findFirst({
    where: { user: { email: session.user.email } },
    select: { orgId: true, org: { select: { niche: true } } },
    orderBy: { orgId: "asc" },
  });

  if (!membership?.orgId) {
    return NextResponse.json({ ok: false, error: "No organization" }, { status: 400 });
  }

  const payload = (await req.json().catch(() => ({}))) as Partial<BookingPageConfig>;

  const orgSettings = await prisma.orgSettings.findUnique({
    where: { orgId: membership.orgId },
    select: { data: true },
  });

  const data = (orgSettings?.data as Record<string, unknown>) || {};
  const current = resolveBookingPageConfig(membership.org?.niche ?? null, data);

  const next: BookingPageConfig = {
    template: (payload.template as BookingPageConfig["template"]) || current.template,
    content: {
      ...current.content,
      ...(payload.content || {}),
    },
    fields: {
      ...current.fields,
      ...(payload.fields || {}),
    },
  };

  await prisma.orgSettings.upsert({
    where: { orgId: membership.orgId },
    update: {
      data: {
        ...data,
        bookingPage: next,
      } as any,
    },
    create: {
      orgId: membership.orgId,
      data: {
        bookingPage: next,
      } as any,
    },
  });

  return NextResponse.json({ ok: true, config: next });
}
