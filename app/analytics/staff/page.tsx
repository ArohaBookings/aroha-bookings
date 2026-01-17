// app/analytics/staff/page.tsx
import React from "react";
import { Card } from "@/components/ui";
import { prisma } from "@/lib/db";
import { requireOrgOrPurchase } from "@/lib/requireOrgOrPurchase";
import { summarizeStaffPerformance, explainHeatmap } from "@/lib/ai/staff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const BUCKETS = [
  { label: "Early", start: 6, end: 8 },
  { label: "Morning", start: 8, end: 12 },
  { label: "Midday", start: 12, end: 15 },
  { label: "Afternoon", start: 15, end: 18 },
  { label: "Evening", start: 18, end: 21 },
  { label: "Late", start: 21, end: 23 },
];

function dayIndex(date: Date, tz: string) {
  const w = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short" })
    .format(date)
    .slice(0, 3)
    .toLowerCase();
  return w === "mon"
    ? 0
    : w === "tue"
    ? 1
    : w === "wed"
    ? 2
    : w === "thu"
    ? 3
    : w === "fri"
    ? 4
    : w === "sat"
    ? 5
    : 6;
}

function hourInTZ(date: Date, tz: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour12: false,
    hour: "2-digit",
  }).formatToParts(date);
  return Number(parts.find((p) => p.type === "hour")?.value ?? "0");
}

export default async function StaffAnalyticsPage() {
  const gate = await requireOrgOrPurchase();
  const org = gate.org;
  if (!org) return null;

  const tz = (org as any).timezone || "UTC";
  const windowStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [staff, services, appts, settings] = await Promise.all([
    prisma.staffMember.findMany({
      where: { orgId: org.id, active: true },
      select: { id: true, name: true },
    }),
    prisma.service.findMany({
      where: { orgId: org.id },
      select: { id: true, priceCents: true, durationMin: true },
    }),
    prisma.appointment.findMany({
      where: {
        orgId: org.id,
        startsAt: { gte: windowStart },
        status: { not: "CANCELLED" },
      },
      select: {
        staffId: true,
        startsAt: true,
        endsAt: true,
        status: true,
        serviceId: true,
        syncedAt: true,
        externalProvider: true,
      },
    }),
    prisma.orgSettings.findUnique({ where: { orgId: org.id }, select: { data: true } }),
  ]);

  const serviceMap = new Map(services.map((s) => [s.id, s]));
  const byStaff = new Map<string, typeof appts>();
  appts.forEach((a) => {
    if (!a.staffId) return;
    const list = byStaff.get(a.staffId) ?? [];
    list.push(a);
    byStaff.set(a.staffId, list);
  });

  const rows = staff.map((s) => {
    const list = byStaff.get(s.id) ?? [];
    const total = list.length || 1;
    const noShows = list.filter((a) => a.status === "NO_SHOW").length;
    const durationMin = list.reduce((acc, a) => {
      const mins = Math.max(5, Math.round((a.endsAt.getTime() - a.startsAt.getTime()) / 60000));
      return acc + mins;
    }, 0);
    const hours = durationMin / 60 || 1;
    const revenue = list.reduce((acc, a) => {
      const svc = a.serviceId ? serviceMap.get(a.serviceId) : null;
      return acc + (svc?.priceCents ?? 0);
    }, 0);
    const synced = list.filter((a) => a.externalProvider === "google" && a.syncedAt).length;
    return {
      staffId: s.id,
      staffName: s.name,
      noShowRate: noShows / total,
      avgDurationMin: total ? Math.round(durationMin / total) : 0,
      revenuePerHour: revenue / 100 / hours,
      syncReliability: total ? synced / total : 0,
    };
  });

  const summary = await summarizeStaffPerformance({
    orgName: org.name,
    windowLabel: "last 30 days",
    rows,
  });

  const heatmap = Array.from({ length: BUCKETS.length }, () => Array(DAYS.length).fill(0));
  appts.forEach((a) => {
    const d = dayIndex(a.startsAt, tz);
    const hour = hourInTZ(a.startsAt, tz);
    const bucketIndex = BUCKETS.findIndex((b) => hour >= b.start && hour < b.end);
    if (bucketIndex >= 0) heatmap[bucketIndex][d] += 1;
  });
  const max = Math.max(1, ...heatmap.flat());
  const low = heatmap.flat().filter((v) => v > 0).sort((a, b) => a - b)[0] ?? 0;
  const summaryText = low
    ? "Some early/late buckets are underused compared to mid‑day peaks."
    : "Usage is evenly distributed across the week.";
  const heatmapSummary = await explainHeatmap({ orgName: org.name, summary: summaryText });

  const syncErrors = Array.isArray((settings?.data as any)?.calendarSyncErrors)
    ? (settings?.data as any).calendarSyncErrors.length
    : 0;

  return (
    <main className="min-h-screen bg-zinc-50 p-6 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <header>
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Staff performance</p>
          <h1 className="mt-2 text-2xl font-semibold text-zinc-900">Ops dashboard</h1>
          <p className="mt-2 text-sm text-zinc-600">Last 30 days · Sync errors: {syncErrors}</p>
        </header>

        <Card>
          <h2 className="text-sm font-semibold text-zinc-900">Weekly summary</h2>
          <p className="mt-2 text-sm text-zinc-700">{summary.text}</p>
        </Card>

        <Card>
          <h2 className="text-sm font-semibold text-zinc-900">Staff metrics</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-xs uppercase tracking-widest text-zinc-500">
                <tr>
                  <th className="py-2 text-left">Staff</th>
                  <th className="py-2 text-left">No-show rate</th>
                  <th className="py-2 text-left">Avg length</th>
                  <th className="py-2 text-left">Revenue/hr</th>
                  <th className="py-2 text-left">Sync reliability</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200">
                {rows.map((r) => (
                  <tr key={r.staffId}>
                    <td className="py-3 font-semibold text-zinc-900">{r.staffName}</td>
                    <td className="py-3 text-zinc-700">{(r.noShowRate * 100).toFixed(1)}%</td>
                    <td className="py-3 text-zinc-700">{r.avgDurationMin}m</td>
                    <td className="py-3 text-zinc-700">${r.revenuePerHour.toFixed(0)}</td>
                    <td className="py-3 text-zinc-700">{(r.syncReliability * 100).toFixed(0)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <h2 className="text-sm font-semibold text-zinc-900">Availability heatmap</h2>
          <p className="mt-2 text-sm text-zinc-600">{heatmapSummary.text}</p>
          <div className="mt-4 grid grid-cols-[90px_repeat(7,1fr)] gap-2 text-xs">
            <div />
            {DAYS.map((d) => (
              <div key={d} className="text-center text-zinc-500">
                {d}
              </div>
            ))}
            {BUCKETS.map((b, i) => (
              <React.Fragment key={b.label}>
                <div className="text-zinc-500">{b.label}</div>
                {heatmap[i].map((v, idx) => {
                  const intensity = Math.max(0.1, v / max);
                  return (
                    <div
                      key={`${b.label}-${idx}`}
                      className="h-8 rounded-md border border-zinc-200"
                      style={{ backgroundColor: `rgba(16,185,129,${intensity})` }}
                      title={`${v} bookings`}
                    />
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        </Card>
      </div>
    </main>
  );
}
