import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSessionOrgFeature } from "@/lib/entitlements";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canAccessSuperAdminByEmail } from "@/lib/roles";

export const runtime = "nodejs";

const statsRowSchema = z.object({
  label: z.string(),
  count: z.number(),
  minutes: z.number(),
  missed: z.number(),
  answered: z.number(),
  bookings: z.number(),
});

const statsResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    totals: z.object({
      count: z.number(),
      minutes: z.number(),
      missed: z.number(),
      answered: z.number(),
      bookings: z.number(),
    }),
    weekly: z.array(statsRowSchema),
    monthly: z.array(statsRowSchema),
    timezone: z.string(),
    lastWebhookAt: z.string().nullable().optional(),
  }),
  debug: z
    .object({
      from: z.string(),
      to: z.string(),
      rows: z.object({ total: z.number(), filtered: z.number() }),
    })
    .optional(),
});

function isAbortError(err: unknown) {
  const msg = String((err as any)?.message || "").toLowerCase();
  const code = (err as any)?.code as string | undefined;
  return code === "ECONNRESET" || msg.includes("aborted") || msg.includes("aborterror");
}

function getTimeZoneOffsetMs(timeZone: string, date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const map = new Map(parts.map((p) => [p.type, p.value]));
  const year = Number(map.get("year") || 0);
  const month = Number(map.get("month") || 1);
  const day = Number(map.get("day") || 1);
  const hour = Number(map.get("hour") || 0);
  const minute = Number(map.get("minute") || 0);
  const second = Number(map.get("second") || 0);
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  return asUtc - date.getTime();
}

function parseDateParam(raw: string | null, timeZone: string, end = false): Date | null {
  if (!raw) return null;
  const [yy, mm, dd] = raw.split("-").map((n) => Number(n));
  if (!yy || !mm || !dd) return null;
  const hour = end ? 23 : 0;
  const minute = end ? 59 : 0;
  const second = end ? 59 : 0;
  const ms = end ? 999 : 0;
  const baseUtc = new Date(Date.UTC(yy, mm - 1, dd, hour, minute, second, ms));
  try {
    const offsetMs = getTimeZoneOffsetMs(timeZone, baseUtc);
    return new Date(baseUtc.getTime() - offsetMs);
  } catch {
    return baseUtc;
  }
}

function formatYmd(date: Date, timeZone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const map = new Map(parts.map((p) => [p.type, p.value]));
    return `${map.get("year")}-${map.get("month")}-${map.get("day")}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
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
  if (req.signal.aborted) {
    return NextResponse.json({ ok: false, error: "aborted" }, { status: 499 });
  }
  try {
  const auth = await requireSessionOrgFeature("analytics");
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error, entitlements: auth.entitlements }, { status: auth.status });
  }

  const url = new URL(req.url);

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

  const defaultFromRaw = formatYmd(new Date(Date.now() - 30 * 86400000), tz);
  const defaultToRaw = formatYmd(new Date(), tz);

  const fromDate =
    parseDateParam(url.searchParams.get("from"), tz) ??
    parseDateParam(defaultFromRaw, tz) ??
    new Date(Date.now() - 30 * 86400000);

  const toDate =
    parseDateParam(url.searchParams.get("to"), tz, true) ??
    parseDateParam(defaultToRaw, tz, true) ??
    new Date();

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

  if (totals.count === 0 && logs.length > 0) {
    console.warn("[calls.stats] zero filtered results", {
      orgId: auth.orgId,
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      logs: logs.length,
      filtered: filtered.length,
      businessHoursOnly,
    });
  }

  const weeklyRows = Array.from(weekly.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([label, row]) => ({ label, ...row }));
  const monthlyRows = Array.from(monthly.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([label, row]) => ({ label, ...row }));

  const session = await getServerSession(authOptions);
  const canDebug = await canAccessSuperAdminByEmail(session?.user?.email || null);
  const settings = await prisma.orgSettings.findUnique({
    where: { orgId: auth.orgId },
    select: { data: true },
  });
  const settingsData = (settings?.data as Record<string, unknown>) || {};
  const callsMeta = (settingsData.calls as Record<string, unknown>) || {};
  const lastWebhookAt = typeof callsMeta.lastWebhookAt === "string" ? callsMeta.lastWebhookAt : null;

  const payload = {
    ok: true,
    data: {
      totals: {
        count: Number.isFinite(totals.count) ? totals.count : 0,
        minutes: Number.isFinite(totals.minutes) ? totals.minutes : 0,
        missed: Number.isFinite(totals.missed) ? totals.missed : 0,
        answered: Number.isFinite(totals.answered) ? totals.answered : 0,
        bookings: Number.isFinite(totals.bookings) ? totals.bookings : 0,
      },
      weekly: weeklyRows.map((row) => ({
        label: row.label,
        count: Number.isFinite(row.count) ? row.count : 0,
        minutes: Number.isFinite(row.minutes) ? row.minutes : 0,
        missed: Number.isFinite(row.missed) ? row.missed : 0,
        answered: Number.isFinite(row.answered) ? row.answered : 0,
        bookings: Number.isFinite(row.bookings) ? row.bookings : 0,
      })),
      monthly: monthlyRows.map((row) => ({
        label: row.label,
        count: Number.isFinite(row.count) ? row.count : 0,
        minutes: Number.isFinite(row.minutes) ? row.minutes : 0,
        missed: Number.isFinite(row.missed) ? row.missed : 0,
        answered: Number.isFinite(row.answered) ? row.answered : 0,
        bookings: Number.isFinite(row.bookings) ? row.bookings : 0,
      })),
      timezone: tz,
      lastWebhookAt,
    },
    debug: canDebug
      ? {
          from: fromDate.toISOString(),
          to: toDate.toISOString(),
          rows: { total: logs.length, filtered: filtered.length },
        }
      : undefined,
  };
  const parsed = statsResponseSchema.safeParse(payload);
  if (!parsed.success) {
    console.error("[calls.stats] invalid response shape", parsed.error.flatten());
    return NextResponse.json({ ok: false, error: "Invalid response shape" }, { status: 500 });
  }

  return NextResponse.json(parsed.data);
  } catch (err) {
    if (req.signal.aborted || isAbortError(err)) {
      return NextResponse.json({ ok: false, error: "aborted" }, { status: 499 });
    }
    throw err;
  }
}
