// lib/availability.ts
import { prisma } from "@/lib/db";
import { addMinutes, overlaps, toDate } from "./retell/time";

export type Slot = { start: Date; end: Date; staffId?: string };

type FindAvailabilityInput = {
  orgId: string;
  serviceDurationMin: number;
  dateFrom: Date;
  dateTo: Date;
  staffId?: string; // optional staff targeting
  bufferMin?: number; // padding between bookings
};

export async function findAvailability(input: FindAvailabilityInput): Promise<Slot[]> {
  const { orgId, serviceDurationMin, dateFrom, dateTo, staffId, bufferMin = 0 } = input;

  // Pull org hours & staff schedules
  const [hours, schedules, appts] = await Promise.all([
    prisma.openingHours.findMany({ where: { orgId } }),
    prisma.staffSchedule.findMany({
      where: { staff: { orgId }, ...(staffId ? { staffId } : {}) },
      select: { staffId: true, dayOfWeek: true, startTime: true, endTime: true },
    }),
    prisma.appointment.findMany({
      where: { orgId, startsAt: { gte: dateFrom }, endsAt: { lte: dateTo }, status: { not: "CANCELLED" } },
      select: { staffId: true, startsAt: true, endsAt: true },
    }),
  ]);

  // Map hours by weekday
  const hoursByDow = new Map<number, { openMin: number; closeMin: number }>();
  for (const h of hours) {
    hoursByDow.set(h.weekday, { openMin: h.openMin, closeMin: h.closeMin });
  }

  // Map schedules by staff/day
  const schedByStaffDow = new Map<string, Array<{ startMin: number; endMin: number; dow: number }>>();
  for (const s of schedules) {
    const [sh, sm] = s.startTime.split(":").map(Number);
    const [eh, em] = s.endTime.split(":").map(Number);
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;
    const key = s.staffId;
    const list = schedByStaffDow.get(key) ?? [];
    list.push({ startMin, endMin, dow: s.dayOfWeek });
    schedByStaffDow.set(key, list);
  }

  // Existing bookings by staff/day
  const apptsByStaffDate = new Map<string, Array<{ startsAt: Date; endsAt: Date }>>();
  for (const a of appts) {
    const key = `${a.staffId ?? "any"}:${a.startsAt.toDateString()}`;
    const list = apptsByStaffDate.get(key) ?? [];
    list.push({ startsAt: a.startsAt, endsAt: a.endsAt });
    apptsByStaffDate.set(key, list);
  }

  const out: Slot[] = [];

  // Iterate each day in range
  for (let d = new Date(dateFrom); d <= dateTo; d.setDate(d.getDate() + 1)) {
    const day = new Date(d);
    const dow = day.getDay(); // 0..6
    const orgHours = hoursByDow.get(dow);
    if (!orgHours) continue;

    // For each staff (or target staff)
    const staffIds = staffId
      ? [staffId]
      : Array.from(schedByStaffDow.keys());
    for (const sid of staffIds) {
      const schedulesToday = (schedByStaffDow.get(sid) ?? []).filter((x) => x.dow === dow);
      if (schedulesToday.length === 0) continue;

      // Build blocks (intersection of org hours and staff schedule)
      for (const blk of schedulesToday) {
        const open = Math.max(orgHours.openMin, blk.startMin);
        const close = Math.min(orgHours.closeMin, blk.endMin);
        if (close - open < serviceDurationMin) continue;

        // Walk the block in service-duration steps (plus buffer)
        let cursorMin = open;
        while (cursorMin + serviceDurationMin <= close) {
          const start = new Date(day);
          start.setHours(0, cursorMin, 0, 0);
          const end = addMinutes(start, serviceDurationMin);

          // Check for overlap with existing appts for that staff
          const bookedToday = apptsByStaffDate.get(`${sid}:${start.toDateString()}`) ?? [];
          const blocked = bookedToday.some((b) => overlaps(start, end, b.startsAt, b.endsAt));

          if (!blocked) {
            out.push({ start, end, staffId: sid });
          }

          cursorMin += serviceDurationMin + bufferMin;
        }
      }
    }
  }

  // Sort just in case
  out.sort((a, b) => a.start.getTime() - b.start.getTime());
  return out;
}
