import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { inferIntentRange } from "@/lib/booking/intent";
import { getAvailability } from "@/lib/availability/index";
import { rankSlots } from "@/lib/availability/intelligence";
import { requireSessionOrgFeature } from "@/lib/entitlements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function POST(req: Request) {
  const gate = await requireSessionOrgFeature("holds");
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  }

  const membership = await prisma.membership.findFirst({
    where: { orgId: gate.orgId },
    select: { orgId: true, org: { select: { timezone: true, slug: true } } },
  });

  if (!membership?.orgId || !membership.org) {
    return NextResponse.json({ ok: false, error: "No organization" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as { text?: string; staffId?: string | null; serviceId?: string | null };
  const text = (body.text || "").trim();

  const intent = inferIntentRange(text || "next 7 days");
  const availability = await getAvailability({
    orgId: membership.orgId,
    from: intent.from,
    to: intent.to,
    serviceId: body.serviceId || undefined,
    staffId: body.staffId || undefined,
    tz: membership.org.timezone,
  });

  let ranked = await rankSlots({ orgId: membership.orgId, slots: availability.slots });

  if (intent.preferredTime) {
    const desiredMinutes = intent.preferredTime.hour * 60 + intent.preferredTime.minute;
    ranked = ranked.sort((a, b) => {
      const aDate = new Date(a.start);
      const bDate = new Date(b.start);
      const aMinutes = aDate.getHours() * 60 + aDate.getMinutes();
      const bMinutes = bDate.getHours() * 60 + bDate.getMinutes();
      return Math.abs(aMinutes - desiredMinutes) - Math.abs(bMinutes - desiredMinutes);
    });
  }

  const top = ranked.slice(0, 3);

  return NextResponse.json({
    ok: true,
    label: intent.label,
    preferredTime: intent.preferredTime || null,
    slots: top,
    orgSlug: membership.org.slug,
  });
}
