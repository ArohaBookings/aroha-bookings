// app/analytics/calls/page.tsx
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import React from "react";
import { Card } from "@/components/ui";
import { prisma } from "@/lib/db";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";

type SearchParams = {
  from?: string;
  to?: string;
  agent?: string;
};

type DayPoint = { label: string; value: number };

function toInputDate(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

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

function dayKey(d: Date) {
  return toInputDate(d);
}

function minutesBetween(start: Date, end?: Date | null) {
  if (!end) return null;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
}

function percent(n: number, d: number) {
  if (!d) return 0;
  return Math.round((n / d) * 100);
}

function Ring({ value, label }: { value: number; label: string }) {
  const r = 34;
  const circ = 2 * Math.PI * r;
  const clamped = Math.min(100, Math.max(0, value));
  const dash = (clamped / 100) * circ;
  return (
    <Card className="flex items-center gap-4 p-4">
      <svg width="88" height="88" viewBox="0 0 88 88">
        <circle cx="44" cy="44" r={r} stroke="#e4e4e7" strokeWidth="10" fill="none" />
        <circle
          cx="44"
          cy="44"
          r={r}
          stroke="#10b981"
          strokeWidth="10"
          fill="none"
          strokeDasharray={`${dash} ${circ - dash}`}
          strokeLinecap="round"
          transform="rotate(-90 44 44)"
        />
        <text x="44" y="50" textAnchor="middle" className="fill-zinc-900 text-lg font-semibold">
          {clamped}%
        </text>
      </svg>
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">{label}</p>
        <p className="text-sm text-zinc-600">Percent of total calls in range.</p>
      </div>
    </Card>
  );
}

function Sparkline({ points, label }: { points: DayPoint[]; label: string }) {
  if (points.length === 0) {
    return (
      <Card className="p-4">
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">{label}</p>
        <p className="mt-2 text-sm text-zinc-500">No data yet.</p>
      </Card>
    );
  }
  const max = Math.max(...points.map((p) => p.value), 1);
  const width = 220;
  const height = 80;
  const step = width / Math.max(points.length - 1, 1);
  const coords = points.map((p, i) => {
    const x = i * step;
    const y = height - (p.value / max) * height;
    return `${x},${y}`;
  });
  const latest = points[points.length - 1]?.value ?? 0;
  return (
    <Card className="p-4">
      <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-zinc-900">{latest.toFixed(1)} min</p>
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} className="mt-3">
        <polyline
          fill="none"
          stroke="#0ea5e9"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={coords.join(" ")}
        />
      </svg>
    </Card>
  );
}

function BarList({ rows, title }: { rows: Array<{ label: string; value: number }>; title: string }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <Card className="p-4">
      <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">{title}</p>
      <div className="mt-4 space-y-3">
        {rows.length === 0 ? (
          <p className="text-sm text-zinc-500">No missed calls in this range.</p>
        ) : (
          rows.map((row) => (
            <div key={row.label}>
              <div className="flex justify-between text-xs text-zinc-500">
                <span>{row.label}</span>
                <span>{row.value}</span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-zinc-100">
                <div
                  className="h-2 rounded-full bg-rose-400"
                  style={{ width: `${Math.round((row.value / max) * 100)}%` }}
                />
              </div>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

export default async function CallAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<React.ReactElement> {
  const params = await searchParams;
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/api/auth/signin");

  const user = await prisma.user.findUnique({
    where: { email: session.user.email! },
    include: { memberships: { include: { org: true } } },
  });
  const org = user?.memberships?.[0]?.org ?? null;
  if (!org) {
    return (
      <Card className="p-6">
        <h1 className="text-xl font-semibold">Call analytics</h1>
        <p className="mt-2 text-sm text-zinc-600">No organisation found for this account.</p>
      </Card>
    );
  }

  const now = new Date();
  const defaultFrom = startOfDayLocal(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));
  const fromDate = parseDateParam(params.from) ?? defaultFrom;
  const toDate = parseDateParam(params.to, true) ?? endOfDayLocal(now);
  const agentId = params.agent?.trim() || "";

  const where = {
    orgId: org.id,
    ...(agentId ? { agentId } : {}),
    startedAt: { gte: fromDate, lte: toDate },
  };

const [logs, agents] = await Promise.all([
  prisma.callLog.findMany({
    where,
    select: {
      startedAt: true,
      endedAt: true,
      outcome: true,
      appointmentId: true,
    },
    orderBy: { startedAt: "asc" },
  }),
  prisma.callLog.findMany({
    where: { orgId: org.id },
    distinct: ["agentId"],
    select: { agentId: true },
    orderBy: { agentId: "asc" },
  }),
]);


  const totalCalls = logs.length;
  const answeredCalls = logs.filter((l) => l.outcome === "COMPLETED").length;
  const bookingCalls = logs.filter((l) => l.appointmentId).length;
  const avgLength =
    logs
      .map((l) => minutesBetween(l.startedAt, l.endedAt))
      .filter((v): v is number => v !== null)
      .reduce((acc, v) => acc + v, 0) /
    Math.max(
      logs.filter((l) => l.endedAt).length,
      1
    );

  const missedCounts = logs.reduce<Record<string, number>>((acc, l) => {
    if (l.outcome !== "COMPLETED") acc[l.outcome] = (acc[l.outcome] || 0) + 1;
    return acc;
  }, {});

type Row = { label: string; value: number };

const missedRows: Row[] = Object.entries(missedCounts)
  .map(([label, raw]) => {
    const value =
      typeof raw === "number"
        ? raw
        : Number.isFinite(Number(raw))
        ? Number(raw)
        : 0;

    return {
      label: label.replace(/_/g, " "),
      value,
    };
  })
  .sort((a, b) => b.value - a.value)
  .slice(0, 4);


  const dayMap = new Map<string, { sum: number; count: number }>();
  logs.forEach((l) => {
    if (!l.endedAt) return;
    const key = dayKey(l.startedAt);
    const current = dayMap.get(key) || { sum: 0, count: 0 };
    const mins = minutesBetween(l.startedAt, l.endedAt) || 0;
    current.sum += mins;
    current.count += 1;
    dayMap.set(key, current);
  });

  const days: DayPoint[] = [];
  const cursor = new Date(fromDate);
  while (cursor <= toDate) {
    const key = dayKey(cursor);
    const entry = dayMap.get(key);
    const avg = entry && entry.count ? entry.sum / entry.count : 0;
    days.push({ label: key, value: Number(avg.toFixed(1)) });
    cursor.setDate(cursor.getDate() + 1);
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Call analytics</p>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">
            Performance for {org.name}
          </h1>
        </div>
        <div className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs text-zinc-600 shadow-sm">
          {totalCalls} calls
        </div>
      </header>

      <form
        method="get"
        className="grid gap-3 rounded-2xl border border-zinc-200 bg-gradient-to-br from-white via-white to-zinc-50 p-4 shadow-sm md:grid-cols-4"
      >
        <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-widest text-zinc-500">
          From
          <input
            type="date"
            name="from"
            defaultValue={toInputDate(fromDate)}
            className="h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/30"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-widest text-zinc-500">
          To
          <input
            type="date"
            name="to"
            defaultValue={toInputDate(toDate)}
            className="h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/30"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-widest text-zinc-500 md:col-span-2">
          Agent
          <select
            name="agent"
            defaultValue={agentId}
            className="h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/30"
          >
            <option value="">All agents</option>
            {agents.map((agent) => (
              <option key={agent.agentId} value={agent.agentId}>
                {agent.agentId}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="h-10 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-500"
        >
          Update
        </button>
      </form>

      <div className="grid gap-4 lg:grid-cols-2">
        <Ring value={percent(answeredCalls, totalCalls)} label="Answered rate" />
        <Ring value={percent(bookingCalls, totalCalls)} label="Booking rate" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Sparkline points={days} label="Average call length" />
        <BarList rows={missedRows} title="Top missed reasons" />
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-600 shadow-sm">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Average length</p>
            <p className="text-xl font-semibold text-zinc-900">{Number.isFinite(avgLength) ? avgLength.toFixed(1) : "0.0"} min</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Answered</p>
            <p className="text-xl font-semibold text-zinc-900">{answeredCalls}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Bookings</p>
            <p className="text-xl font-semibold text-zinc-900">{bookingCalls}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
