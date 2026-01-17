import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { addBookingHold, resolveBookingHolds, type BookingHold } from "@/lib/booking/holds";
import { requireSessionOrgFeature } from "@/lib/entitlements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET() {
  const gate = await requireSessionOrgFeature("holds");
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  }

  const orgSettings = await prisma.orgSettings.findUnique({
    where: { orgId: gate.orgId },
    select: { data: true },
  });

  const data = (orgSettings?.data as Record<string, unknown>) || {};
  const holds = resolveBookingHolds(data);

  return NextResponse.json({ ok: true, holds });
}

export async function POST(req: Request) {
  const gate = await requireSessionOrgFeature("holds");
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  }

  const payload = (await req.json().catch(() => ({}))) as {
    start: string;
    end: string;
    staffId?: string | null;
    note?: string;
    holdMinutes?: number;
  };

  if (!payload.start || !payload.end) {
    return NextResponse.json({ ok: false, error: "Missing start/end" }, { status: 400 });
  }

  const holdMinutes = Math.min(60, Math.max(5, Number(payload.holdMinutes || 15)));
  const expiresAt = new Date(Date.now() + holdMinutes * 60000).toISOString();
  const hold: BookingHold = {
    id: `hold_${Math.random().toString(36).slice(2)}`,
    start: payload.start,
    end: payload.end,
    staffId: payload.staffId ?? null,
    createdAt: new Date().toISOString(),
    expiresAt,
    source: "inbox",
    note: payload.note,
  };

  const orgSettings = await prisma.orgSettings.findUnique({
    where: { orgId: gate.orgId },
    select: { data: true },
  });
  const data = (orgSettings?.data as Record<string, unknown>) || {};
  const nextData = addBookingHold(data, hold);

  await prisma.orgSettings.upsert({
    where: { orgId: gate.orgId },
    update: { data: nextData as any },
    create: { orgId: gate.orgId, data: nextData as any },
  });

  return NextResponse.json({ ok: true, hold });
}
