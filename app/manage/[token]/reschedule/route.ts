import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAvailability } from "@/lib/availability/index";
import { createOrUpdateAppointmentEvent } from "@/lib/integrations/google/syncAppointment";
import { getManageContext } from "@/app/manage/verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const callsByIp = new Map<string, { last: number; count: number }>();
function rateLimit(ip: string, maxPerMinute = 30) {
  const now = Date.now();
  const m = callsByIp.get(ip) || { last: now, count: 0 };
  if (now - m.last > 60_000) {
    m.last = now;
    m.count = 0;
  }
  m.count++;
  callsByIp.set(ip, m);
  return m.count <= maxPerMinute;
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    (req as { ip?: string }).ip ||
    "0.0.0.0";
  if (!rateLimit(ip, 40)) {
    return json({ ok: false, error: "Rate limit" }, 429);
  }

  const body = (await req.json().catch(() => ({}))) as {
    startISO?: string;
    honeypot?: string;
  };
  if (body.honeypot) {
    return json({ ok: false, error: "Invalid submission" }, 400);
  }

  const startISO = (body.startISO || "").trim();
  if (!startISO) {
    return json({ ok: false, error: "Missing start time" }, 400);
  }

  const { token } = await params;
  const managed = await getManageContext(token);
  if (!managed.ok) {
    return json({ ok: false, error: managed.error }, 403);
  }

  const appt = managed.appointment;
  if (appt.status === "CANCELLED") {
    return json({ ok: false, error: "Booking is cancelled" }, 400);
  }
  if (!appt.serviceId) {
    return json({ ok: false, error: "Service not available for reschedule" }, 400);
  }

  const start = new Date(startISO);
  if (Number.isNaN(start.getTime())) {
    return json({ ok: false, error: "Invalid start time" }, 400);
  }

  const dayStart = new Date(start);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(start);
  dayEnd.setHours(23, 59, 59, 999);

  const availability = await getAvailability({
    orgId: appt.orgId,
    from: dayStart,
    to: dayEnd,
    serviceId: appt.serviceId,
    staffId: appt.staffId ?? undefined,
    tz: appt.org.timezone,
  });

  const slot = availability.slots.find(
    (s) => s.start === start.toISOString() && (!appt.staffId || s.staffId === appt.staffId)
  );
  if (!slot) {
    return json({ ok: false, error: "Selected time is no longer available" }, 409);
  }

  const end = new Date(slot.end);

  const org = await prisma.organization.findUnique({
    where: { id: appt.orgId },
    select: { dashboardConfig: true },
  });

  const bookingRules = (org?.dashboardConfig as Record<string, unknown>)?.bookingRules as
    | Record<string, unknown>
    | undefined;
  const allowOverlaps = Boolean(bookingRules?.allowOverlaps);
  const bufferBeforeMin = Number(bookingRules?.bufferBeforeMin ?? 0) || 0;
  const bufferAfterMin = Number(bookingRules?.bufferAfterMin ?? 0) || 0;

  const startBuffered = new Date(start.getTime() - bufferBeforeMin * 60_000);
  const endBuffered = new Date(end.getTime() + bufferAfterMin * 60_000);

  const result = await prisma.$transaction(async (tx) => {
    if (!allowOverlaps && appt.staffId) {
      const overlap = await tx.appointment.count({
        where: {
          orgId: appt.orgId,
          staffId: appt.staffId,
          status: { not: "CANCELLED" },
          id: { not: appt.id },
          startsAt: { lt: endBuffered },
          endsAt: { gt: startBuffered },
        },
      });
      if (overlap > 0) {
        return { conflict: true };
      }
    }

    const updated = await tx.appointment.update({
      where: { id: appt.id },
      data: { startsAt: start, endsAt: end },
      select: { id: true, startsAt: true, endsAt: true },
    });

    return { conflict: false, updated };
  });

  if (result.conflict) {
    return json({ ok: false, error: "Selected time is no longer available" }, 409);
  }

  if (result.updated?.id) {
    createOrUpdateAppointmentEvent(appt.orgId, result.updated.id).catch((err) =>
      console.error("google-sync(manage-reschedule) error:", err)
    );
  }

  return json({
    ok: true,
    startsAt: result.updated?.startsAt.toISOString(),
    endsAt: result.updated?.endsAt.toISOString(),
  });
}
