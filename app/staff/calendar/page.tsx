// app/staff/calendar/page.tsx
import React from "react";
import { prisma } from "@/lib/db";
import { requireStaffPageContext } from "../lib";
import { Badge, Card, EmptyState } from "@/components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dateKeyInTZ(date: Date, tz: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function fmtDayLabel(dateKey: string, tz: string) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const safe = new Date(Date.UTC(y, (m || 1) - 1, d || 1, 12));
  return new Intl.DateTimeFormat("en-NZ", {
    timeZone: tz,
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).format(safe);
}

function fmtTime(iso: string, tz: string) {
  return new Intl.DateTimeFormat("en-NZ", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function LinkRequired() {
  return (
    <main className="min-h-screen bg-zinc-50 flex items-center justify-center px-6">
      <Card className="max-w-md p-8 text-center">
        <h1 className="text-xl font-semibold text-zinc-900">Staff calendar</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Your account isn’t linked to a staff profile yet. Ask an admin to connect your email to a staff member.
        </p>
      </Card>
    </main>
  );
}

export default async function StaffCalendarPage() {
  const ctx = await requireStaffPageContext();
  if (!ctx.staff) return <LinkRequired />;

  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);

  const rows = await prisma.appointment.findMany({
    where: {
      orgId: ctx.org.id,
      staffId: ctx.staff.id,
      startsAt: { gte: start, lt: end },
      status: { not: "CANCELLED" },
    },
    orderBy: { startsAt: "asc" },
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      customerName: true,
      status: true,
      service: { select: { name: true } },
    },
  });

  const buckets = new Map<string, typeof rows>();
  rows.forEach((r) => {
    const key = dateKeyInTZ(r.startsAt, ctx.org.timezone);
    const list = buckets.get(key) ?? [];
    list.push(r);
    buckets.set(key, list);
  });

  const days = Array.from({ length: 7 }).map((_, idx) => {
    const d = new Date(start.getTime() + idx * 24 * 60 * 60 * 1000);
    return { key: dateKeyInTZ(d, ctx.org.timezone), date: d };
  });

  return (
    <main className="min-h-screen bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Staff portal</p>
            <h1 className="text-2xl font-semibold text-zinc-900 mt-2">Calendar</h1>
            <p className="text-sm text-zinc-600">
              {ctx.org.name} · {ctx.staff.name}
            </p>
          </div>
          <span className="text-xs text-zinc-500">{ctx.org.timezone}</span>
        </div>
      </header>

      <section className="max-w-6xl mx-auto px-6 py-8">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {days.map((d) => {
            const items = buckets.get(d.key) ?? [];
            const dayIndex = new Date(d.date).getDay();
            return (
              <Card key={d.key} className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">{DAYS[dayIndex]}</p>
                    <p className="text-sm font-semibold text-zinc-900">{fmtDayLabel(d.key, ctx.org.timezone)}</p>
                  </div>
                  <Badge variant="neutral">{items.length} appts</Badge>
                </div>
                <div className="mt-3 space-y-2">
                  {items.length === 0 ? (
                    <EmptyState title="No appointments" body="You’re clear for this day." />
                  ) : (
                    items.map((a) => (
                      <div key={a.id} className="rounded-xl border border-zinc-200 p-3">
                        <p className="text-xs text-zinc-500">
                          {fmtTime(a.startsAt.toISOString(), ctx.org.timezone)} –{" "}
                          {fmtTime(a.endsAt.toISOString(), ctx.org.timezone)}
                        </p>
                        <p className="text-sm font-semibold text-zinc-900">{a.customerName}</p>
                        <p className="text-xs text-zinc-600">{a.service?.name ?? "Appointment"}</p>
                      </div>
                    ))
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      </section>
    </main>
  );
}
