/* app/dashboard/page.tsx
   Aroha Bookings — Production Dashboard (hardened)
   - Multi-tenant (scoped by signed-in user's org)
   - SSR (App Router) + noStore()
   - No external chart libs (SVG-only)
   - No Prisma crashes on empty DBs
   - Friendly empty states & QA hints
   - Strict types, no implicit any
*/

/* segment flags */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const dynamicParams = true;

import React from "react";
import { prisma } from "@/lib/db";
import { generateText, hasAI } from "@/lib/ai/client";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { LogoutButton } from "@/components/LogoutButton";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import { redirect } from "next/navigation";
import { unstable_noStore as noStore } from "next/cache";
import { Badge } from "@/components/ui";
import { getOrgEntitlements } from "@/lib/entitlements";


/* ──────────────────────────────────────────────────────────────────────────
   Constants & helpers
────────────────────────────────────────────────────────────────────────── */

const TZ = "Pacific/Auckland";
const LOCALE = "en-NZ";

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function startOfWeek(d: Date): Date {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // Mon=0
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfWeek(d: Date): Date {
  const e = startOfWeek(d);
  e.setDate(e.getDate() + 7);
  e.setHours(23, 59, 59, 999);
  return e;
}
function startOfWeeksAgo(base: Date, weeksAgo: number): Date {
  const d = startOfWeek(base);
  d.setDate(d.getDate() - weeksAgo * 7);
  return d;
}
function endOfWeeksAgo(base: Date, weeksAgo: number): Date {
  const d = endOfWeek(base);
  d.setDate(d.getDate() - weeksAgo * 7);
  return d;
}
function daysAgo(base: Date, n: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() - n);
  return d;
}
function minutesBetween(a: Date, b: Date): number {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));
}
function moneyNZ(cents: number): string {
  return new Intl.NumberFormat(LOCALE, { style: "currency", currency: "NZD" }).format(
    (cents || 0) / 100,
  );
}
function fmtDateTime(d: Date): string {
  return d.toLocaleString(LOCALE, {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    day: "numeric",
    month: "short",
  });
}
function fmtTime(d: Date): string {
  return d.toLocaleTimeString(LOCALE, { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
}
function fmtStatus(status?: string | null): string {
  if (!status) return "Scheduled";
  if (status === "NO_SHOW") return "No-show";
  if (status === "CANCELLED") return "Cancelled";
  if (status === "COMPLETED") return "Completed";
  return "Scheduled";
}

/* ──────────────────────────────────────────────────────────────────────────
   Local Types
────────────────────────────────────────────────────────────────────────── */

type StaffLite = { id: string; name: string | null };
type ServiceLite = { name: string | null; priceCents: number | null };

type ApptLite = {
  id: string;
  orgId: string;
  startsAt: Date;
  endsAt: Date;
  customerName: string;
  customerPhone: string;
  status?: "SCHEDULED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
  source?: string | null;
  staff: StaffLite | null;
  service: ServiceLite | null;
};

type RecentRow = { when: string; client: string; service: string; staff: string; status: string };
type UtilRow = { staff: string; pct: number };
type TopServiceRow = { name: string; count: number; revenueCents: number };
type SourceSlice = { label: string; count: number };

type WeekPoint = { label: string; value: number };
type CompareRow = { service: string; last: number; this: number; deltaPct: number };

/* ──────────────────────────────────────────────────────────────────────────
   Page
────────────────────────────────────────────────────────────────────────── */

export default async function DashboardPage(): Promise<React.ReactElement> {
  noStore();

  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    redirect("/api/auth/signin");
  }

  // Resolve org (first membership wins for now)
  const user = await prisma.user.findUnique({
    where: { email: session.user.email! },
    include: { memberships: { include: { org: true } } },
  });

  const org = user?.memberships?.[0]?.org ?? null;

  if (!org) {
    return (
      <div className="space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
            <p className="mt-1 text-sm text-zinc-600">No organisation yet.</p>
          </div>
          <LogoutButton />
        </header>
        <Card>
          <p className="text-sm text-zinc-600">
            You don’t have an organisation or membership yet. Create one on the
            <a className="underline ml-1" href="/onboarding">onboarding</a> page.
          </p>
        </Card>
      </div>
    );
  }

  const entitlements = await getOrgEntitlements(org.id);
  const showCallAnalytics = entitlements.features.analytics;

  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const weekStart = startOfWeek(now);
  const weekEnd = endOfWeek(now);
  const lastWeekStart = startOfWeeksAgo(now, 1);
  const lastWeekEnd = endOfWeeksAgo(now, 1);
  const weeksBack = 7; // 8 weeks inclusive

  /* ──────────────────────────────────────────────────────────────
     Main queries (scoped by org)
  ─────────────────────────────────────────────────────────────── */
  let todayCount = 0;
  let uniqueTodayPhones: Array<{ customerPhone: string }> = [];
  let uniqueAllPhones: Array<{ customerPhone: string }> = [];
  let staffList: StaffLite[] = [];
  let weekAppts: ApptLite[] = [];
  let recentAppts: ApptLite[] = [];
  let cancelledCount = 0;
  let noShowCount = 0;
  let bookingsPerWeek: WeekPoint[] = [];
  let revenuePerWeek: WeekPoint[] = [];
  let phones90d: Array<{ customerPhone: string }> = [];
  let serviceThisWeek: Array<{ service: { name: string | null } | null }> = [];
  let serviceLastWeek: Array<{ service: { name: string | null } | null }> = [];
  let sourceBreakdown: SourceSlice[] = [];
  let orgSettingsData: Record<string, unknown> = {};
  let calendarConnected = false;
  let inboxAvgResponseMin = 0;
  let noShowTrend = 0;
  let recoveredCount = 0;
  let orgSettingsRow: { data: unknown } | null = null;
  let calendarConnection: { id: string } | null = null;
  let responseSamples: Array<{ receivedAt: Date | null; createdAt: Date }> = [];
  let noShowRecent = 0;
  let noShowPrev = 0;
  let callLogs7d: Array<{
    startedAt: Date;
    endedAt: Date | null;
    outcome: string;
    appointmentId: string | null;
  }> = [];

  try {
    [
      todayCount,
      uniqueTodayPhones,
      uniqueAllPhones,
      staffList,
      weekAppts,
      recentAppts,
      cancelledCount,
      noShowCount,
      bookingsPerWeek,
      revenuePerWeek,
      phones90d,
      serviceThisWeek,
      serviceLastWeek,
      sourceBreakdown,
      orgSettingsRow,
      calendarConnection,
      responseSamples,
      noShowRecent,
      noShowPrev,
      recoveredCount,
      callLogs7d,
    ] = await Promise.all([
      prisma.appointment.count({
        where: { orgId: org.id, startsAt: { gte: todayStart, lte: todayEnd } },
      }),

      prisma.appointment.findMany({
        where: { orgId: org.id, startsAt: { gte: todayStart, lte: todayEnd } },
        select: { customerPhone: true },
        distinct: ["customerPhone"],
      }),

      prisma.appointment.findMany({
        where: { orgId: org.id },
        select: { customerPhone: true },
        distinct: ["customerPhone"],
      }),

      prisma.staffMember.findMany({
        where: { orgId: org.id },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),

      prisma.appointment.findMany({
        where: { orgId: org.id, startsAt: { gte: weekStart, lte: weekEnd } },
        include: {
          staff: { select: { id: true, name: true } },
          service: { select: { name: true, priceCents: true } },
        },
        orderBy: { startsAt: "asc" },
      }) as Promise<ApptLite[]>,

      prisma.appointment.findMany({
        where: { orgId: org.id },
        orderBy: { startsAt: "desc" },
        take: 14,
        include: {
          staff: { select: { name: true } },
          service: { select: { name: true } },
        },
      }) as Promise<ApptLite[]>,

      prisma.appointment.count({
        where: { orgId: org.id, status: "CANCELLED" },
      }),

      prisma.appointment.count({
        where: { orgId: org.id, status: "NO_SHOW" },
      }),

      // bookings per week (count)
      (async (): Promise<WeekPoint[]> => {
        const pts: WeekPoint[] = [];
        for (let i = weeksBack; i >= 0; i--) {
          const s = startOfWeeksAgo(now, i);
          const e = endOfWeeksAgo(now, i);
          // eslint-disable-next-line no-await-in-loop
          const count = await prisma.appointment.count({
            where: { orgId: org.id, startsAt: { gte: s, lte: e } },
          });
          pts.push({ label: weekLabel(s), value: count });
        }
        return pts;
      })(),

      // revenue per week (sum of service price)
      (async (): Promise<WeekPoint[]> => {
        const pts: WeekPoint[] = [];
        for (let i = weeksBack; i >= 0; i--) {
          const s = startOfWeeksAgo(now, i);
          const e = endOfWeeksAgo(now, i);
          // eslint-disable-next-line no-await-in-loop
          const appts = (await prisma.appointment.findMany({
            where: { orgId: org.id, startsAt: { gte: s, lte: e } },
            select: { service: { select: { priceCents: true } } },
          })) as Array<{ service: { priceCents: number | null } | null }>;
          const cents = appts.reduce((sum: number, a) => sum + (a.service?.priceCents ?? 0), 0);
          pts.push({ label: weekLabel(s), value: cents });
        }
        return pts;
      })(),

      prisma.appointment.findMany({
        where: { orgId: org.id, startsAt: { gte: daysAgo(now, 90), lte: now } },
        select: { customerPhone: true },
      }),

      prisma.appointment.findMany({
        where: { orgId: org.id, startsAt: { gte: weekStart, lte: weekEnd } },
        select: { service: { select: { name: true } } },
      }),

      prisma.appointment.findMany({
        where: { orgId: org.id, startsAt: { gte: lastWeekStart, lte: lastWeekEnd } },
        select: { service: { select: { name: true } } },
      }),

      (async (): Promise<SourceSlice[]> => {
        const labels: string[] = ["phone", "web", "manual"];
        const out: SourceSlice[] = [];
        for (const label of labels) {
          // eslint-disable-next-line no-await-in-loop
          const count = await prisma.appointment.count({
            where: { orgId: org.id, source: label },
          });
          out.push({ label, count });
        }
        return out;
      })(),
      prisma.orgSettings.findUnique({
        where: { orgId: org.id },
        select: { data: true },
      }),
      prisma.calendarConnection.findFirst({
        where: { orgId: org.id },
        select: { id: true },
      }),
      prisma.emailAILog.findMany({
        where: {
          orgId: org.id,
          action: { in: ["auto_sent", "sent"] },
          receivedAt: { not: null },
          createdAt: { gte: daysAgo(now, 30) },
        },
        select: { receivedAt: true, createdAt: true },
        take: 200,
      }),
      prisma.appointment.count({
        where: {
          orgId: org.id,
          status: "NO_SHOW",
          startsAt: { gte: daysAgo(now, 30), lte: now },
        },
      }),
      prisma.appointment.count({
        where: {
          orgId: org.id,
          status: "NO_SHOW",
          startsAt: { gte: daysAgo(now, 60), lte: daysAgo(now, 30) },
        },
      }),
      prisma.emailAILog.count({
        where: {
          orgId: org.id,
          action: "auto_sent",
          createdAt: { gte: daysAgo(now, 7) },
        },
      }),
      showCallAnalytics
        ? prisma.callLog.findMany({
            where: {
              orgId: org.id,
              startedAt: { gte: daysAgo(now, 6), lte: now },
            },
            select: {
              startedAt: true,
              endedAt: true,
              outcome: true,
              appointmentId: true,
            },
            orderBy: { startedAt: "asc" },
          })
        : Promise.resolve([]),
    ]);
  } catch (err) {
    console.error("Dashboard data error", err);
    return (
      <div className="space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
            <p className="mt-1 text-sm text-zinc-600">We ran into a data issue.</p>
          </div>
          <LogoutButton />
        </header>

        <Card className="border-red-200 text-red-700">
          <p className="text-sm">
            Unable to load dashboard data right now. Please refresh, or try again in a moment.
          </p>
        </Card>
      </div>
    );
  }

  /* ──────────────────────────────────────────────────────────────
     Derived metrics
  ─────────────────────────────────────────────────────────────── */

  orgSettingsData = (orgSettingsRow?.data as Record<string, unknown>) || {};
  calendarConnected = Boolean(calendarConnection);

  const syncState = (orgSettingsData.emailAiSync as Record<string, unknown>) || {};
  const lastSyncMs =
    typeof syncState.lastSuccessAt === "number"
      ? syncState.lastSuccessAt
      : typeof syncState.lastSuccessAt === "string"
      ? Date.parse(syncState.lastSuccessAt)
      : 0;
  const inboxSyncHealthy = lastSyncMs ? Date.now() - lastSyncMs < 60 * 60 * 1000 : false;

  const responseTimes = responseSamples
    .filter((r) => r.receivedAt && r.createdAt)
    .map((r) => Math.max(0, minutesBetween(r.receivedAt as Date, r.createdAt)));
  inboxAvgResponseMin = responseTimes.length
    ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
    : 0;

  noShowTrend = noShowPrev ? Math.round(((noShowRecent - noShowPrev) / noShowPrev) * 100) : 0;

  let healthScore = 100;
  if (!inboxSyncHealthy) healthScore -= 15;
  if (!calendarConnected) healthScore -= 10;
  if (inboxAvgResponseMin > 120) healthScore -= 15;
  if (noShowTrend > 10) healthScore -= 10;
  if (healthScore < 30) healthScore = 30;

  let healthSummary = `Automation ${inboxSyncHealthy ? "healthy" : "needs attention"}, ` +
    `${calendarConnected ? "calendar connected" : "calendar disconnected"}, ` +
    `avg response ${inboxAvgResponseMin ? `${inboxAvgResponseMin}m` : "—"}, ` +
    `no-show trend ${noShowTrend >= 0 ? "+" : ""}${noShowTrend}%.`;

  if (hasAI()) {
    const aiText = await generateText(
      [
        "Write a 1-sentence business health summary.",
        `Inbox sync: ${inboxSyncHealthy ? "healthy" : "error/lagging"}`,
        `Calendar: ${calendarConnected ? "connected" : "disconnected"}`,
        `Avg response minutes: ${inboxAvgResponseMin}`,
        `No-show trend: ${noShowTrend}%`,
        `Recovered auto-sends last 7d: ${recoveredCount}`,
      ].join("\n")
    );
    if (aiText) healthSummary = aiText;
  }

  const callPoints: WeekPoint[] = [];
  let callsAnswered = 0;
  let callsMissed = 0;
  let callsBookings = 0;
  let callsMinutes = 0;
  let callConversionPct = 0;
  if (showCallAnalytics) {
    const dayMap = new Map<string, number>();
    callLogs7d.forEach((log) => {
      const key = weekLabel(log.startedAt);
      dayMap.set(key, (dayMap.get(key) || 0) + 1);
      if (log.outcome === "COMPLETED") callsAnswered += 1;
      else callsMissed += 1;
      if (log.appointmentId) callsBookings += 1;
      if (log.endedAt) callsMinutes += minutesBetween(log.startedAt, log.endedAt);
    });
    for (let i = 6; i >= 0; i--) {
      const day = daysAgo(now, i);
      const label = weekLabel(day);
      callPoints.push({ label, value: dayMap.get(label) || 0 });
    }
    callConversionPct = callsAnswered ? Math.round((callsBookings / callsAnswered) * 100) : 0;
  }

  const uniqueClientsToday = uniqueTodayPhones.length;
  const uniqueClientsAllTime = uniqueAllPhones.length;

  const estWeekCents = weekAppts.reduce(
    (sum: number, a: ApptLite) => sum + (a.service?.priceCents ?? 0),
    0,
  );

  const weekDurationsMin: number[] = weekAppts.map((a: ApptLite) =>
    Math.max(5, minutesBetween(a.startsAt, a.endsAt)),
  );
  const avgDur: string =
    weekDurationsMin.length > 0
      ? `${Math.round(weekDurationsMin.reduce((s: number, n: number) => s + n, 0) / weekDurationsMin.length)}m`
      : "—";

  // Top services (count + revenue) for this week
  const svcCount = new Map<string, TopServiceRow>();
  for (const a of weekAppts) {
    const key = a.service?.name ?? "Unknown";
    const curr = svcCount.get(key) ?? { name: key, count: 0, revenueCents: 0 };
    svcCount.set(key, {
      name: curr.name,
      count: curr.count + 1,
      revenueCents: curr.revenueCents + (a.service?.priceCents ?? 0),
    });
  }
  const topServices: TopServiceRow[] = [...svcCount.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Staff utilisation (naive weekly capacity = 40h)
  const weeklyCapacityMin = 5 * 8 * 60;
  const staffUtil: UtilRow[] = staffList
    .map((s: StaffLite): UtilRow => {
      const apptsFor: ApptLite[] = weekAppts.filter((a: ApptLite) => a.staff?.id === s.id);
      const bookedMin = apptsFor.reduce(
        (m: number, a: ApptLite) => m + Math.max(5, minutesBetween(a.startsAt, a.endsAt)),
        0,
      );
      const pct = weeklyCapacityMin ? Math.min(100, Math.round((bookedMin / weeklyCapacityMin) * 100)) : 0;
      return { staff: s.name ?? "—", pct };
    })
    .sort((a: UtilRow, b: UtilRow) => b.pct - a.pct);

  // Today schedule (first 8)
  type TodayRow = { id: string; time: string; label: string; staff: string };
  const todaySchedule: TodayRow[] = weekAppts
    .filter((a: ApptLite) => a.startsAt >= startOfDay(now) && a.startsAt <= endOfDay(now))
    .sort((a: ApptLite, b: ApptLite) => a.startsAt.getTime() - b.startsAt.getTime())
    .slice(0, 8)
    .map((a: ApptLite): TodayRow => ({
      id: a.id,
      time: `${fmtTime(a.startsAt)} – ${fmtTime(a.endsAt)}`,
      label: `${a.customerName} • ${a.service?.name ?? "Service"}`,
      staff: a.staff?.name ?? "—",
    }));

  // Recent list
  const recentRows: RecentRow[] = recentAppts.map((a: ApptLite): RecentRow => ({
    when: fmtDateTime(a.startsAt),
    client: a.customerName || "Client",
    service: a.service?.name ?? "Service",
    staff: a.staff?.name ?? "Staff",
    status: fmtStatus(a.status),
  }));

  // Weekly bookings line chart
  const bookingPoints: WeekPoint[] = bookingsPerWeek;

  // Revenue area chart
  const revenuePoints: WeekPoint[] = revenuePerWeek;

  // Retention (repeat phones / unique last 90d)
  const phoneCounts = new Map<string, number>();
  for (const p of phones90d) {
    const key = (p.customerPhone || "").trim();
    if (!key) continue;
    phoneCounts.set(key, (phoneCounts.get(key) ?? 0) + 1);
  }
  let repeatPhones = 0;
  phoneCounts.forEach((cnt) => {
    if (cnt > 1) repeatPhones += 1;
  });
  const unique90d = phoneCounts.size;
  const retentionPct = unique90d ? Math.round((repeatPhones / unique90d) * 100) : 0;

  // Last-week vs this-week service performance
  function tallyServices(list: Array<{ service: { name: string | null } | null }>): Map<string, number> {
    const m = new Map<string, number>();
    for (const x of list) {
      const name = x.service?.name ?? "Unknown";
      m.set(name, (m.get(name) ?? 0) + 1);
    }
    return m;
  }

  const tThis = tallyServices(serviceThisWeek);
  const tLast = tallyServices(serviceLastWeek);
  const svcNames = Array.from(new Set<string>([...tThis.keys(), ...tLast.keys()]));
  const svcCompare: CompareRow[] = svcNames
    .map((name: string): CompareRow => {
      const last = tLast.get(name) ?? 0;
      const ths = tThis.get(name) ?? 0;
      const deltaPct = last === 0 ? (ths > 0 ? 100 : 0) : Math.round(((ths - last) / last) * 100);
      return { service: name, last, this: ths, deltaPct };
    })
    .sort((a, b) => (b.this - b.last) - (a.this - a.last));

  // Source phone trend (bar)
  const sourcePhoneTrend: WeekPoint[] = [];
  for (let i = weeksBack; i >= 0; i--) {
    const s = startOfWeeksAgo(now, i);
    const e = endOfWeeksAgo(now, i);
    // eslint-disable-next-line no-await-in-loop
    const count = await prisma.appointment.count({
      where: { orgId: org.id, source: "phone", startsAt: { gte: s, lte: e } },
    });
    sourcePhoneTrend.push({ label: weekLabel(s), value: count });
  }

  // Source breakdown pie
  const totalSources = sourceBreakdown.reduce((s: number, x: SourceSlice) => s + x.count, 0);
  const sourceWithAngles =
    totalSources > 0
      ? (() => {
          let acc = 0;
          return sourceBreakdown.map((s: SourceSlice) => {
            const angle = (s.count / totalSources) * Math.PI * 2;
            const start = acc;
            const end = acc + angle;
            acc = end;
            return { ...s, start, end };
          });
        })()
      : [];

  // QA checks
  const qaFindings: string[] = [];
  if (uniqueClientsAllTime && uniqueClientsAllTime < todayCount) {
    qaFindings.push("Unique-all-time < today's bookings — check duplicate phone handling.");
  }
  if (estWeekCents === 0 && weekAppts.length > 0) {
    qaFindings.push("Services missing prices — weekly revenue is showing $0.");
  }
  if (staffList.length === 0) {
    qaFindings.push("No staff — utilisation will be empty.");
  }

  const pulseItems: Array<{ title: string; detail: string }> = [];
  const weekCount = Math.max(1, weekAppts.length);
  const noShowRate = noShowCount / weekCount;
  if (noShowRate >= 0.05) {
    pulseItems.push({
      title: "No-show trend",
      detail: `No-shows are at ${(noShowRate * 100).toFixed(1)}% this week. Consider confirmation nudges.`,
    });
  }
  if (cancelledCount > 0) {
    pulseItems.push({
      title: "Cancellation risk",
      detail: `${cancelledCount} cancellations this week. Offer a reschedule link to recover revenue.`,
    });
  }
  if (uniqueClientsToday === 0) {
    pulseItems.push({
      title: "Low client flow",
      detail: "No new clients today. Share your booking link and boost availability visibility.",
    });
  }
  if (estWeekCents === 0 && weekAppts.length > 0) {
    pulseItems.push({
      title: "Pricing data",
      detail: "Revenue is tracking at $0 because service prices are missing. Add prices in Services.",
    });
  }

  const pulseSelected = pulseItems.slice(0, 3);
  const pulseSummary =
    hasAI() && pulseSelected.length
      ? await generateText(
          `Turn these business insights into a 1-2 sentence summary:\n${pulseSelected
            .map((p) => `- ${p.title}: ${p.detail}`)
            .join("\n")}`
        )
      : null;

  /* ──────────────────────────────────────────────────────────────
     UI
  ─────────────────────────────────────────────────────────────── */
  return (
    <div className="space-y-8 pb-16">
      {/* Header */}
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{org.name} Dashboard</h1>
          <p className="mt-1 text-sm text-zinc-600">Times shown in {TZ}.</p>
        </div>
        <LogoutButton />
      </header>

      {/* KPI Cards */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <CardStat label="Today's bookings" value={String(todayCount)} />
        <CardStat label="Unique clients today" value={String(uniqueClientsToday)} />
        <CardStat label="All-time clients" value={String(uniqueClientsAllTime)} />
        <CardStat label="Avg booking length (wk)" value={avgDur} />
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Business Health</h2>
          <Badge variant={healthScore >= 80 ? "success" : healthScore >= 60 ? "info" : "warning"}>
            {healthScore}/100
          </Badge>
        </div>
        <p className="mt-2 text-sm text-zinc-700">{healthSummary}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm text-zinc-600">
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
            Inbox sync: <span className="font-medium">{inboxSyncHealthy ? "Healthy" : "Needs attention"}</span>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
            Calendar: <span className="font-medium">{calendarConnected ? "Connected" : "Disconnected"}</span>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
            Avg response: <span className="font-medium">{inboxAvgResponseMin ? `${inboxAvgResponseMin} min` : "—"}</span>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
            Recovered: <span className="font-medium">{recoveredCount} auto-sends</span>
          </div>
        </div>
      </section>

      {pulseSelected.length > 0 && (
        <section className="rounded-xl border border-emerald-100 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Business Pulse</h2>
            <Badge variant={pulseSummary ? "info" : "neutral"}>
              {pulseSummary ? "AI summary" : "Deterministic insights"}
            </Badge>
          </div>
          {pulseSummary ? (
            <p className="mt-2 text-sm text-zinc-700">{pulseSummary}</p>
          ) : null}
          <ul className="mt-3 grid gap-2 text-sm text-zinc-600">
            {pulseSelected.map((item) => (
              <li key={item.title} className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
                <span className="font-medium text-zinc-800">{item.title}:</span> {item.detail}
              </li>
            ))}
          </ul>
        </section>
      )}

      {org.niche ? (
        <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Niche insights</h2>
          <p className="mt-1 text-sm text-zinc-600">
            Tailored suggestions for <span className="font-medium">{String(org.niche).replace("_", " ")}</span>.
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {org.niche === "HAIR_BEAUTY" && (
              <>
                <HintCard title="Pre-book prompts" body="Add a 10–15 min buffer for color services to reduce runover." />
                <HintCard title="No-show protection" body="Enable reminders 24h + 2h before appointments." />
              </>
            )}
            {org.niche === "TRADES" && (
              <>
                <HintCard title="Travel buffers" body="Use 15–30 min buffers between on-site jobs." />
                <HintCard title="Lead time" body="Set a 2–4 hour lead time for same-day jobs." />
              </>
            )}
            {org.niche === "DENTAL" && (
              <>
                <HintCard title="Chair utilization" body="Keep 10 min buffers for sterilization turnover." />
                <HintCard title="Recall rhythm" body="Track 6–12 month follow-up flows in notes." />
              </>
            )}
            {org.niche === "LAW" && (
              <>
                <HintCard title="Long consults" body="Use 60 min slots for initial consults." />
                <HintCard title="Prep time" body="Set buffer before for file review and prep." />
              </>
            )}
            {org.niche === "AUTO" && (
              <>
                <HintCard title="Drop-off windows" body="Offer early drop-offs with longer working hours." />
                <HintCard title="Parts lead time" body="Add lead time for complex repairs." />
              </>
            )}
            {org.niche === "MEDICAL" && (
              <>
                <HintCard title="Short slots" body="15 min slots with 5 min buffers improves flow." />
                <HintCard title="Recall intervals" body="Use reminders for follow-up appointments." />
              </>
            )}
          </div>
        </section>
      ) : null}

      {/* Trends Row */}
      <section className="grid lg:grid-cols-3 gap-6">
        <SectionCard title="Revenue (last 8 weeks)">
          {sumValues(revenuePoints) > 0 ? (
            <RevenueAreaChart points={revenuePoints} height={160} />
          ) : (
            <Empty text="No revenue data yet." />
          )}
          <div className="mt-2 text-sm text-zinc-600">
            Total: <strong>{moneyNZ(sumValues(revenuePoints))}</strong>
          </div>
        </SectionCard>

        <SectionCard title="Bookings (last 8 weeks)">
          {sumValues(bookingPoints) > 0 ? (
            <LineChart points={bookingPoints} height={160} />
          ) : (
            <Empty text="No bookings yet." />
          )}
          <div className="mt-2 text-sm text-zinc-600">
            Total: <strong>{sumValues(bookingPoints)}</strong>
          </div>
        </SectionCard>

        <SectionCard title="Retention (last 90 days)">
          <div className="flex items-end gap-6">
            <div className="text-5xl font-semibold">{retentionPct}%</div>
            <div className="text-sm text-zinc-600">
              Repeat clients / unique clients in last 90 days
              <div className="mt-1">
                <span className="text-zinc-700">{repeatPhones}</span> repeat •{" "}
                <span className="text-zinc-700">{unique90d}</span> unique
              </div>
            </div>
          </div>
        </SectionCard>
      </section>

      {/* Sources + Services Compare */}
      <section className="grid lg:grid-cols-3 gap-6">
        <SectionCard title="Booking sources (breakdown)">
          {totalSources > 0 ? (
            <div className="flex items-center gap-6">
              <Pie
                radius={60}
                slices={sourceWithAngles.map((s) => ({ start: s.start, end: s.end }))}
              />
              <ul className="text-sm">
                {sourceBreakdown.map((s: SourceSlice, i: number) => (
                  <li key={i} className="flex items-center gap-2">
                    <Swatch index={i} />
                    <span className="w-20 capitalize">{s.label}</span>
                    <span className="text-zinc-600">{s.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <Empty text="No bookings yet to analyse." />
          )}
        </SectionCard>

        <SectionCard title="Phone source trend (last 8 weeks)">
          {sumValues(sourcePhoneTrend) > 0 ? (
            <BarChart points={sourcePhoneTrend} height={160} />
          ) : (
            <Empty text="No 'phone' source data yet." />
          )}
        </SectionCard>

        <SectionCard title="Services: this week vs last week">
          {svcCompare.length > 0 ? (
            <table className="w-full text-sm">
              <thead className="text-zinc-600 border-b border-zinc-200">
                <tr>
                  <th className="text-left py-2">Service</th>
                  <th className="text-right py-2">Last</th>
                  <th className="text-right py-2">This</th>
                  <th className="text-right py-2">Δ%</th>
                </tr>
              </thead>
              <tbody>
                {svcCompare.map((r: CompareRow, i: number) => (
                  <tr key={i} className="border-t border-zinc-100">
                    <td className="py-2">{r.service}</td>
                    <td className="py-2 text-right">{r.last}</td>
                    <td className="py-2 text-right">{r.this}</td>
                    <td className={`py-2 text-right ${r.deltaPct >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {r.deltaPct}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty text="No recent service activity." />
          )}
        </SectionCard>
      </section>

      {showCallAnalytics && (
        <section className="grid lg:grid-cols-2 gap-6">
          <SectionCard title="Calls (last 7 days)">
            {sumValues(callPoints) > 0 ? (
              <BarChart points={callPoints} height={160} />
            ) : (
              <Empty text="No calls yet." />
            )}
            <div className="mt-2 text-sm text-zinc-600">
              Total: <strong>{sumValues(callPoints)}</strong>
            </div>
          </SectionCard>

          <SectionCard title="Call outcomes (last 7 days)">
            <div className="grid sm:grid-cols-2 gap-4">
              <Health number={callsAnswered} label="Answered" />
              <Health number={callsMissed} label="Missed" />
              <Health number={callsBookings} label="Bookings" />
              <Health number={callsMinutes} label="Minutes" />
            </div>
            <p className="text-xs text-zinc-500 mt-3">
              Conversion: {callConversionPct}% of answered calls created a booking.
            </p>
          </SectionCard>
        </section>
      )}

      {/* Utilisation + Health */}
      <section className="grid lg:grid-cols-2 gap-6">
        <SectionCard title="Staff utilisation (week)">
          {staffUtil.length > 0 ? (
            <div className="space-y-3">
              {staffUtil.map((s: UtilRow, i: number) => (
                <div key={i}>
                  <div className="flex items-center justify-between text-sm">
                    <div className="font-medium">{s.staff}</div>
                    <div className="text-zinc-600">{s.pct}%</div>
                  </div>
                  <div className="mt-1 h-2 w-full bg-zinc-200 rounded">
                    <div className="h-2 rounded bg-[#00bfa6]" style={{ width: `${s.pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty text="Add staff to see utilisation." />
          )}
        </SectionCard>

        <SectionCard title="Booking health">
          <div className="grid sm:grid-cols-2 gap-4">
            <Health number={cancelledCount} label="Cancellations (all time)" />
            <Health number={noShowCount} label="No-shows (all time)" />
          </div>
          <p className="text-xs text-zinc-500 mt-3">
            Lower these with SMS reminders and deposit rules (coming soon).
          </p>
        </SectionCard>
      </section>

      {/* Today + Recent */}
      <section className="grid lg:grid-cols-2 gap-6">
        <SectionCard title="Today’s appointments">
          {todaySchedule.length > 0 ? (
            <ul className="divide-y divide-zinc-200">
              {todaySchedule.map((row: TodayRow, i: number) => (
                <li key={row.id ?? i} className="py-2 flex items-center justify-between">
                  <div>
                    <div className="font-medium">{row.label}</div>
                    <div className="text-xs text-zinc-500">{row.staff}</div>
                  </div>
                  <div className="text-sm text-zinc-800">{row.time}</div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty text="No appointments today." />
          )}
        </SectionCard>

        <SectionCard title="Booking activity">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-zinc-600 border-b border-zinc-200">
                  <th className="text-left py-2">When</th>
                  <th className="text-left py-2">Client</th>
                  <th className="text-left py-2">Service</th>
                  <th className="text-left py-2">Staff</th>
                  <th className="text-left py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {recentRows.length > 0 ? (
                  recentRows.map((r: RecentRow, i: number) => (
                    <tr key={i} className="border-t border-zinc-100">
                      <td className="py-2">{r.when}</td>
                      <td className="py-2">{r.client}</td>
                      <td className="py-2">{r.service}</td>
                      <td className="py-2">{r.staff}</td>
                      <td className="py-2">{r.status}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="py-4 text-zinc-500" colSpan={5}>
                      No bookings yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </section>

      {/* QA Box */}
      <section>
        <SectionCard title="Data checks (QA)">
          {qaFindings.length > 0 ? (
            <ul className="list-disc list-inside text-sm text-amber-700">
              {qaFindings.map((t: string, i: number) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          ) : (
            <div className="text-sm text-emerald-700">All good — no issues detected.</div>
          )}
        </SectionCard>
      </section>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   Small UI helpers (no external libs)
────────────────────────────────────────────────────────────────────────── */

function SectionCard({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <Card padded={false} className="overflow-hidden">
      <header className="px-5 py-3 border-b border-zinc-200 font-semibold">{title}</header>
      <div className="p-5">{children}</div>
    </Card>
  );
}

function CardStat({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <Card padded={false} className="p-5">
      <div className="text-sm text-zinc-600">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </Card>
  );
}

function HintCard({ title, body }: { title: string; body: string }): React.ReactElement {
  return (
    <Card padded={false} className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
      <div className="text-sm font-semibold text-zinc-900">{title}</div>
      <div className="mt-1 text-sm text-zinc-600">{body}</div>
    </Card>
  );
}

function Empty({ text }: { text: string }): React.ReactElement {
  return <EmptyState title={text} body="Once data is available, insights will appear here." />;
}

function Health({ number, label }: { number: number; label: string }): React.ReactElement {
  return (
    <Card padded={false} className="rounded-lg border border-zinc-200 p-4">
      <div className="text-2xl font-semibold">{number}</div>
      <div className="text-sm text-zinc-600">{label}</div>
    </Card>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   SVG Charts (no deps)
────────────────────────────────────────────────────────────────────────── */

function RevenueAreaChart({
  points,
  height = 160,
}: {
  points: WeekPoint[];
  height?: number;
}): React.ReactElement {
  const width = 460;
  const padding = 24;

  const ys = points.map((p) => p.value);
  const maxY = Math.max(1, ...ys);

  const toX = (i: number): number =>
    padding + (i / Math.max(1, points.length - 1)) * (width - padding * 2);
  const toY = (v: number): number => height - padding - (v / maxY) * (height - padding * 2);

  let lineD = "";
  let areaD = "";
  if (points.length > 0) {
    lineD = `M ${toX(0)} ${toY(ys[0])}`;
    areaD = `M ${toX(0)} ${toY(ys[0])}`;
    for (let i = 1; i < points.length; i++) {
      lineD += ` L ${toX(i)} ${toY(ys[i])}`;
      areaD += ` L ${toX(i)} ${toY(ys[i])}`;
    }
    areaD += ` L ${toX(points.length - 1)} ${height - padding}`;
    areaD += ` L ${toX(0)} ${height - padding} Z`;
  }

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-[180px]" role="img" aria-label="Revenue trend">
      <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#e5e7eb" />
      <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="#e5e7eb" />
      <path d={areaD} fill="rgba(0,191,166,0.15)" />
      <path d={lineD} stroke="#00bfa6" strokeWidth="2" fill="none" />
      {points.map((p, i) => (
        <circle key={i} cx={toX(i)} cy={toY(p.value)} r={3} fill="#00bfa6">
          <title>
            {p.label}: {moneyNZ(p.value)}
          </title>
        </circle>
      ))}
      {points.map((p, i) => (
        <text key={`lbl-${i}`} x={toX(i)} y={height - padding + 14} fontSize="10" textAnchor="middle" fill="#6b7280">
          {p.label}
        </text>
      ))}
    </svg>
  );
}

function LineChart({ points, height = 160 }: { points: WeekPoint[]; height?: number }): React.ReactElement {
  const width = 460;
  const padding = 24;
  const ys = points.map((p) => p.value);
  const maxY = Math.max(1, ...ys);

  const toX = (i: number): number =>
    padding + (i / Math.max(1, points.length - 1)) * (width - padding * 2);
  const toY = (v: number): number => height - padding - (v / maxY) * (height - padding * 2);

  let lineD = "";
  if (points.length > 0) {
    lineD = `M ${toX(0)} ${toY(ys[0])}`;
    for (let i = 1; i < points.length; i++) {
      lineD += ` L ${toX(i)} ${toY(ys[i])}`;
    }
  }

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-[180px]" role="img" aria-label="Bookings trend">
      <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#e5e7eb" />
      <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="#e5e7eb" />
      <path d={lineD} stroke="#2563eb" strokeWidth="2" fill="none" />
      {points.map((p, i) => (
        <circle key={i} cx={toX(i)} cy={toY(p.value)} r={3} fill="#2563eb">
          <title>
            {p.label}: {p.value}
          </title>
        </circle>
      ))}
      {points.map((p, i) => (
        <text key={`lbl-${i}`} x={toX(i)} y={height - padding + 14} fontSize="10" textAnchor="middle" fill="#6b7280">
          {p.label}
        </text>
      ))}
    </svg>
  );
}

function BarChart({ points, height = 160 }: { points: WeekPoint[]; height?: number }): React.ReactElement {
  const width = 460;
  const padding = 24;
  const gap = 8;
  const innerW = width - padding * 2;
  const barW = points.length > 0 ? (innerW - gap * (points.length - 1)) / points.length : 0;

  const ys = points.map((p) => p.value);
  const maxY = Math.max(1, ...ys);
  const toY = (v: number): number => height - padding - (v / maxY) * (height - padding * 2);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-[180px]" role="img" aria-label="Phone source trend">
      <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#e5e7eb" />
      <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="#e5e7eb" />
      {points.map((p, i) => {
        const x = padding + i * (barW + gap);
        const y = toY(p.value);
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={height - padding - y} fill="#6366f1" />
            <text x={x + barW / 2} y={height - padding + 14} fontSize="10" textAnchor="middle" fill="#6b7280">
              {p.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Pie({
  radius,
  slices,
}: {
  radius: number;
  slices: Array<{ start: number; end: number }>;
}): React.ReactElement {
  const cx = radius;
  const cy = radius;
  const r = radius;

  const pathFor = (start: number, end: number): string => {
    const x1 = cx + r * Math.cos(start);
       const y1 = cy + r * Math.sin(start);
    const x2 = cx + r * Math.cos(end);
    const y2 = cy + r * Math.sin(end);
    const largeArc = end - start > Math.PI ? 1 : 0;
    return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
  };

  return (
    <svg viewBox={`0 0 ${radius * 2} ${radius * 2}`} className="w-[140px] h-[140px]" role="img" aria-label="Source breakdown">
      {slices.length === 0 ? (
        <circle cx={cx} cy={cy} r={r} fill="#e5e7eb" />
      ) : (
        slices.map((s: { start: number; end: number }, i: number) => (
          <path key={i} d={pathFor(s.start, s.end)} fill={palette(i)} />
        ))
      )}
    </svg>
  );
}

function Swatch({ index }: { index: number }): React.ReactElement {
  return <span className="inline-block h-3 w-3 rounded" style={{ background: palette(index) }} />;
}

function palette(i: number): string {
  const colors: string[] = ["#00bfa6", "#2563eb", "#f59e0b", "#ef4444", "#6b7280"];
  return colors[i % colors.length];
}

/* ──────────────────────────────────────────────────────────────────────────
   tiny utils
────────────────────────────────────────────────────────────────────────── */

function weekLabel(s: Date): string {
  return `${s.toLocaleDateString(LOCALE, { month: "short" })} ${s.getDate()}`;
}

function sumValues(arr: WeekPoint[]): number {
  return arr.reduce((s: number, p: WeekPoint) => s + p.value, 0);
}
