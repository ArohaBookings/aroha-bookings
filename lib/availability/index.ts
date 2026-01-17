// lib/availability/index.ts
import { prisma } from "@/lib/db";
import { addMinutes, overlaps } from "@/lib/retell/time";
import { getCalendarClient } from "@/lib/integrations/google/calendar";
import { isSlotHeld, resolveBookingHolds } from "@/lib/booking/holds";

type Slot = { start: string; end: string; staffId?: string | null };

type AvailabilityInput = {
  orgId: string;
  from: Date;
  to: Date;
  serviceId?: string;
  staffId?: string;
  tz?: string;
};

type Rules = {
  slotIntervalMin: number;
  leadTimeMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  allowOverlaps: boolean;
};

function clampMin(n: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function toInputDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function alignToInterval(mins: number, interval: number) {
  if (interval <= 0) return mins;
  return Math.ceil(mins / interval) * interval;
}

async function getRules(orgId: string): Promise<Rules> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { dashboardConfig: true },
  });
  const cfg = (org?.dashboardConfig as Record<string, unknown>) || {};
  const bookingRules = (cfg.bookingRules as Record<string, unknown>) || {};

  return {
    slotIntervalMin: clampMin(Number(bookingRules.slotMin ?? 30), 5, 240, 30),
    leadTimeMin: clampMin(Number(bookingRules.minLeadMin ?? 0), 0, 1440, 0),
    bufferBeforeMin: clampMin(Number(bookingRules.bufferBeforeMin ?? 0), 0, 240, 0),
    bufferAfterMin: clampMin(Number(bookingRules.bufferAfterMin ?? 0), 0, 240, 0),
    allowOverlaps: Boolean(bookingRules.allowOverlaps),
  };
}

async function getCalendarId(orgId: string) {
  const os = await prisma.orgSettings.findUnique({
    where: { orgId },
    select: { data: true },
  });
  const data = (os?.data as Record<string, unknown>) || {};
  const id = data.googleCalendarId;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

async function getGoogleBusy(orgId: string, timeMin: Date, timeMax: Date) {
  try {
    const calendarId = await getCalendarId(orgId);
    if (!calendarId) return [];
    const client = await getCalendarClient(orgId);
    if (!client) return [];

    const resp = await client.freebusy.query({
      requestBody: {
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        items: [{ id: calendarId }],
      },
    });

    const busy = resp.data.calendars?.[calendarId]?.busy ?? [];
    return busy
      .filter((b) => b.start && b.end)
      .map((b) => ({ start: new Date(b.start as string), end: new Date(b.end as string) }));
  } catch (err) {
    console.error("getGoogleBusy error:", err);
    return [];
  }
}

export async function getAvailability(input: AvailabilityInput): Promise<{ slots: Slot[]; meta: Record<string, unknown> }> {
  const { orgId, from, to, serviceId, staffId } = input;

  const [rules, hours, schedules, appts, holidays, service, googleBusy, orgSettings] = await Promise.all([
    getRules(orgId),
    prisma.openingHours.findMany({ where: { orgId } }),
    prisma.staffSchedule.findMany({
      where: { staff: { orgId }, ...(staffId ? { staffId } : {}) },
      select: { staffId: true, dayOfWeek: true, startTime: true, endTime: true },
    }),
    prisma.appointment.findMany({
      where: {
        orgId,
        startsAt: { lt: to },
        endsAt: { gt: from },
        status: { not: "CANCELLED" },
      },
      select: { staffId: true, startsAt: true, endsAt: true },
    }),
    prisma.holiday.findMany({
      where: { orgId, dateISO: { gte: toInputDate(from), lte: toInputDate(to) } },
      select: { dateISO: true },
    }),
    serviceId
      ? prisma.service.findFirst({ where: { id: serviceId, orgId }, select: { durationMin: true } })
      : Promise.resolve(null),
    getGoogleBusy(orgId, from, to),
    prisma.orgSettings.findUnique({ where: { orgId }, select: { data: true } }),
  ]);

  const holds = resolveBookingHolds((orgSettings?.data as Record<string, unknown>) || {});

  const durationMin = service?.durationMin ?? rules.slotIntervalMin;
  const staffIds = staffId ? [staffId] : Array.from(new Set(schedules.map((s) => s.staffId)));

  const hoursByDow = new Map<number, { openMin: number; closeMin: number }>();
  hours.forEach((h) => hoursByDow.set(h.weekday, { openMin: h.openMin, closeMin: h.closeMin }));

  const schedByStaff = new Map<string, Array<{ dow: number; startMin: number; endMin: number }>>();
  schedules.forEach((s) => {
    const [sh, sm] = s.startTime.split(":").map(Number);
    const [eh, em] = s.endTime.split(":").map(Number);
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;
    const list = schedByStaff.get(s.staffId) ?? [];
    list.push({ dow: s.dayOfWeek, startMin, endMin });
    schedByStaff.set(s.staffId, list);
  });

  const holidaySet = new Set(holidays.map((h) => h.dateISO));

  const apptByStaffDay = new Map<string, Array<{ start: Date; end: Date }>>();
  appts.forEach((a) => {
    const key = `${a.staffId ?? "any"}:${a.startsAt.toDateString()}`;
    const list = apptByStaffDay.get(key) ?? [];
    list.push({
      start: addMinutes(a.startsAt, -rules.bufferBeforeMin),
      end: addMinutes(a.endsAt, rules.bufferAfterMin),
    });
    apptByStaffDay.set(key, list);
  });

  const googleBlocksByDay = new Map<string, Array<{ start: Date; end: Date }>>();
  googleBusy.forEach((b) => {
    const key = b.start.toDateString();
    const list = googleBlocksByDay.get(key) ?? [];
    list.push({ start: b.start, end: b.end });
    googleBlocksByDay.set(key, list);
  });

  const slots: Slot[] = [];
  const now = new Date();
  const minStart = addMinutes(now, rules.leadTimeMin);

  for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    const day = new Date(d);
    const dateKey = toInputDate(day);
    if (holidaySet.has(dateKey)) continue;

    const dow = day.getDay();
    const orgHours = hoursByDow.get(dow);
    if (!orgHours) continue;

    const baseOpen = orgHours.openMin;
    const baseClose = orgHours.closeMin;

    for (const sid of staffIds) {
      const staffSched = (schedByStaff.get(sid) ?? []).filter((s) => s.dow === dow);
      if (staffSched.length === 0) continue;

      for (const sched of staffSched) {
        const open = Math.max(baseOpen, sched.startMin);
        const close = Math.min(baseClose, sched.endMin);
        if (close - open < durationMin) continue;

        let cursorMin = alignToInterval(open, rules.slotIntervalMin);
        while (cursorMin + durationMin <= close) {
          const start = new Date(day);
          start.setHours(0, cursorMin, 0, 0);
          const end = addMinutes(start, durationMin);

          if (start < minStart) {
            cursorMin += rules.slotIntervalMin;
            continue;
          }

          const booked = apptByStaffDay.get(`${sid}:${start.toDateString()}`) ?? [];
          const busyBlocks = googleBlocksByDay.get(start.toDateString()) ?? [];
          const blocked =
            (!rules.allowOverlaps && booked.some((b) => overlaps(start, end, b.start, b.end))) ||
            busyBlocks.some((b) => overlaps(start, end, b.start, b.end)) ||
            isSlotHeld(holds, start.toISOString(), end.toISOString(), sid);

          if (!blocked) {
            slots.push({ start: start.toISOString(), end: end.toISOString(), staffId: sid });
          }

          cursorMin += rules.slotIntervalMin;
        }
      }
    }
  }

  slots.sort((a, b) => a.start.localeCompare(b.start));

  return {
    slots,
    meta: {
      durationMin,
      slotIntervalMin: rules.slotIntervalMin,
      leadTimeMin: rules.leadTimeMin,
      bufferBeforeMin: rules.bufferBeforeMin,
      bufferAfterMin: rules.bufferAfterMin,
      allowOverlaps: rules.allowOverlaps,
      totalSlots: slots.length,
    },
  };
}
