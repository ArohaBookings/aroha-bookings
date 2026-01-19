import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSessionOrgFeature } from "@/lib/entitlements";

export const runtime = "nodejs";

function startOfDayLocal(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDayLocal(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function parseDateParam(raw?: string, end = false): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return end ? endOfDayLocal(d) : startOfDayLocal(d);
}

function weekKey(d: Date) {
  const copy = new Date(d);
  const day = (copy.getDay() + 6) % 7; // Mon=0
  copy.setDate(copy.getDate() - day);
  copy.setHours(0, 0, 0, 0);
  return copy.toISOString().slice(0, 10);
}

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function minutesBetween(start: Date, end?: Date | null) {
  if (!end) return 0;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
}

function withinBusinessHours(
  date: Date,
  hours: Record<string, [number, number]> | null | undefined,
  tz: string
) {
  if (!hours || !Object.keys(hours).length) return true;
  const parts = new Intl.DateTimeFormat("en-NZ", {
    timeZone: tz,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const map = new Map(parts.map((p) => [p.type, p.value]));
  const weekday = (map.get("weekday") || "Mon").toLowerCase().slice(0, 3);
  const hour = Number(map.get("hour") || 0);
  const minute = Number(map.get("minute") || 0);
  const minutes = hour * 60 + minute;
  const window = hours[weekday];
  if (!window) return false;
  return minutes >= window[0] && minutes <= window[1];
}

export async function GET(req: Request) {
  const auth = await requireSessionOrgFeature("analytics");
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error, entitlements: auth.entitlements }, { status: auth.status });
  }

const url = new URL(req.url);

const fromDate =
  parseDateParam(url.searchParams.get("from") ?? undefined) ??
  startOfDayLocal(new Date(Date.now() - 30 * 86400000));

const toDate =
  parseDateParam(url.searchParams.get("to") ?? undefined, true) ??
  endOfDayLocal(new Date());

const agentId = (url.searchParams.get("agent") || "").trim();
const outcome = (url.searchParams.get("outcome") || "").trim().toUpperCase();
const staffId = (url.searchParams.get("staffId") || "").trim();
const serviceId = (url.searchParams.get("serviceId") || "").trim();
const businessHoursOnly = url.searchParams.get("businessHoursOnly") === "true";

  const org = await prisma.organization.findUnique({
    where: { id: auth.orgId },
    select: { timezone: true, name: true },
  });

  const emailSettings = await prisma.emailAISettings.findUnique({
    where: { orgId: auth.orgId },
    select: { businessHoursJson: true, businessHoursTz: true },
  });

  const hours = (emailSettings?.businessHoursJson as Record<string, [number, number]>) || null;
  const tz = emailSettings?.businessHoursTz || org?.timezone || "Pacific/Auckland";

  const logs = await prisma.callLog.findMany({
    where: {
      orgId: auth.orgId,
      ...(agentId ? { agentId } : {}),
      ...(outcome ? { outcome: outcome as any } : {}),
      startedAt: { gte: fromDate, lte: toDate },
      ...(staffId || serviceId
        ? {
            appointment: {
              ...(staffId ? { staffId } : {}),
              ...(serviceId ? { serviceId } : {}),
            },
          }
        : {}),
    },
    select: {
      startedAt: true,
      endedAt: true,
      outcome: true,
      appointmentId: true,
    },
    orderBy: { startedAt: "asc" },
  });

  const filtered = businessHoursOnly
    ? logs.filter((l) => withinBusinessHours(l.startedAt, hours, tz))
    : logs;

  const weekly = new Map<string, { count: number; minutes: number; missed: number; answered: number; bookings: number }>();
  const monthly = new Map<string, { count: number; minutes: number; missed: number; answered: number; bookings: number }>();

  for (const log of filtered) {
    const week = weekKey(log.startedAt);
    const month = monthKey(log.startedAt);
    const minutes = minutesBetween(log.startedAt, log.endedAt);
    const answered = log.outcome === "COMPLETED";
    const missed = !answered;
    const booking = Boolean(log.appointmentId);

    const w = weekly.get(week) || { count: 0, minutes: 0, missed: 0, answered: 0, bookings: 0 };
    w.count += 1;
    w.minutes += minutes;
    if (answered) w.answered += 1;
    if (missed) w.missed += 1;
    if (booking) w.bookings += 1;
    weekly.set(week, w);

    const m = monthly.get(month) || { count: 0, minutes: 0, missed: 0, answered: 0, bookings: 0 };
    m.count += 1;
    m.minutes += minutes;
    if (answered) m.answered += 1;
    if (missed) m.missed += 1;
    if (booking) m.bookings += 1;
    monthly.set(month, m);
  }

  const totals = {
    count: filtered.length,
    minutes: filtered.reduce((sum, l) => sum + minutesBetween(l.startedAt, l.endedAt), 0),
    missed: filtered.filter((l) => l.outcome !== "COMPLETED").length,
    answered: filtered.filter((l) => l.outcome === "COMPLETED").length,
    bookings: filtered.filter((l) => l.appointmentId).length,
  };

  const weeklyRows = Array.from(weekly.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([label, row]) => ({ label, ...row }));
  const monthlyRows = Array.from(monthly.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([label, row]) => ({ label, ...row }));

  return NextResponse.json({
    ok: true,
    totals,
    weekly: weeklyRows,
    monthly: monthlyRows,
    timezone: tz,
  });
}
