/* ==========================  START OF PHASE 2  ==========================
   Aroha Bookings — Calendar (Week/Day) with booking CRUD, filters & exports
   - Multi-tenant (scoped by signed-in user's org)
   - Server actions for create/update/cancel
   - Client islands for modal & filters (no external UI libs)
   - Overlap detection, staff filter, text search, CSV export, TZ toggle
   - Keyboard shortcuts:  N=new, /=search, Esc=close modal
   ====================================================================== */

import React from "react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { FiltersBar, NewBookingButton, GridColumn, EditBookingPortal } from "./ClientIslands";

export const runtime = "nodejs";

/* ───────────────────────────────────────────────────────────────
   Types
   ─────────────────────────────────────────────────────────────── */

type ViewMode = "week" | "day";

type StaffRow = {
  id: string;
  name: string;
  active: boolean;
};

type ServiceRow = {
  id: string;
  name: string;
  durationMin: number;
  priceCents: number;
};

type OrgRow = {
  id: string;
  name: string;
  timezone: string;
};

type ApptRow = {
  id: string;
  orgId: string;
  startsAt: Date;
  endsAt: Date;
  customerName: string;
  customerPhone: string;
  staffId: string | null;
  serviceId: string | null;
  staff: { id: string; name: string } | null;
  service: { id: string; name: string; durationMin: number } | null;
};

/** Rendered block */
type Block = {
  id: string;
  top: number; // px
  height: number; // px
  title: string;
  subtitle: string;
  staffName: string;
  colorClass: string;
  startsAt: Date;
  endsAt: Date;
  staffId: string | null;
  serviceId: string | null;
};

/* ───────────────────────────────────────────────────────────────
   Date helpers
   ─────────────────────────────────────────────────────────────── */

const DAY_LABEL = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function isoDateOnlyLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

function parseDateParam(iso?: string): Date {
  if (!iso) return new Date();
  const d = new Date(iso);
  return isNaN(d.getTime()) ? new Date() : d;
}
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
  const dow = x.getDay(); // Sun=0..Sat=6
  const diff = x.getDate() - dow + (dow === 0 ? -6 : 1); // Monday-first
  const s = new Date(x.setDate(diff));
  s.setHours(0, 0, 0, 0);
  return s;
}
function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}
function minutesBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 60000);
}
function setTime(d: Date, hours: number, minutes: number): Date {
  const x = new Date(d);
  x.setHours(hours, minutes, 0, 0);
  return x;
}
function fmtTime(d: Date, tz?: string): string {
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: tz });
}
function fmtDay(d: Date, tz?: string): string {
  return d.toLocaleDateString([], { month: "short", day: "numeric", timeZone: tz });
}
function isoDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/* ───────────────────────────────────────────────────────────────
   Styling helpers
   ─────────────────────────────────────────────────────────────── */

const PALETTE = [
  "bg-indigo-100 border-indigo-300 text-indigo-900",
  "bg-pink-100 border-pink-300 text-pink-900",
  "bg-emerald-100 border-emerald-300 text-emerald-900",
  "bg-amber-100 border-amber-300 text-amber-900",
  "bg-sky-100 border-sky-300 text-sky-900",
  "bg-violet-100 border-violet-300 text-violet-900",
  "bg-rose-100 border-rose-300 text-rose-900",
];
function colorForName(name: string): string {
  const sum = name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return PALETTE[sum % PALETTE.length];
}

/* ───────────────────────────────────────────────────────────────
   Server actions (CRUD)
   ─────────────────────────────────────────────────────────────── */

async function requireOrg(): Promise<OrgRow> {
  "use server";
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/api/auth/signin");
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    include: { memberships: { include: { org: true } } },
  });
  const org = user?.memberships[0]?.org;
  if (!org) redirect("/onboarding");
  return { id: org.id, name: org.name, timezone: org.timezone };
}

export async function createBooking(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  "use server";
  const org = await requireOrg();
  try {
    const startsAt = new Date(String(formData.get("startsAt")));
    const duration = Number(formData.get("durationMin") || 30);
    const endsAt = new Date(startsAt.getTime() + duration * 60000);

    await prisma.appointment.create({
      data: {
        orgId: org.id,
        staffId: (formData.get("staffId") as string) || null,
        serviceId: (formData.get("serviceId") as string) || null,
        customerName: String(formData.get("customerName") || "Client"),
        customerPhone: String(formData.get("customerPhone") || "Unknown"),
        startsAt,
        endsAt,
        source: "manual",
        status: "SCHEDULED",
      },
    });

    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function updateBooking(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  "use server";
  const org = await requireOrg();
  try {
    const id = String(formData.get("id"));
    const startsAt = new Date(String(formData.get("startsAt")));
    const duration = Number(formData.get("durationMin") || 30);
    const endsAt = new Date(startsAt.getTime() + duration * 60000);

    await prisma.appointment.update({
      where: { id },
      data: {
        orgId: org.id,
        staffId: (formData.get("staffId") as string) || null,
        serviceId: (formData.get("serviceId") as string) || null,
        customerName: String(formData.get("customerName") || "Client"),
        customerPhone: String(formData.get("customerPhone") || "Unknown"),
        startsAt,
        endsAt,
      },
    });
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function cancelBooking(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  "use server";
  try {
    const id = String(formData.get("id"));
    await prisma.appointment.update({
      where: { id },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelledBy: "user" },
    });
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: (e as Error).message };
  }
}

/* ───────────────────────────────────────────────────────────────
   Page (server component)
   ─────────────────────────────────────────────────────────────── */

export default async function CalendarPage({
  searchParams,
}: {
  searchParams?: { view?: ViewMode; date?: string; q?: string; staff?: string; tz?: "org" | "local" };
}) {
  // auth + org
  const sp = await searchParams;
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/api/auth/signin");
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    include: { memberships: { include: { org: true } } },
  });
 const org = user?.memberships[0]?.org as OrgRow | undefined;
if (!org) {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
      <p className="mt-2 text-sm text-zinc-600">
        No organisation found. Create one on <a className="underline" href="/onboarding">onboarding</a>.
      </p>
    </div>
  );
}

  const view: ViewMode = sp?.view === "day" ? "day" : "week";
  const baseDate = parseDateParam(sp?.date);
  const tzPref = sp?.tz === "local" ? "local" : "org";
  const activeTZ = tzPref === "org" ? org.timezone : undefined; // undefined uses local

  // Configurable window
  const SLOT_MIN = 30; // minutes
  const PX_PER_SLOT = 64; // Tailwind h-16

  // Opening hours — if not set, use defaults
  const defaultHours = () => [
    { weekday: 1, openMin: 9 * 60, closeMin: 18 * 60 },
    { weekday: 2, openMin: 9 * 60, closeMin: 18 * 60 },
    { weekday: 3, openMin: 9 * 60, closeMin: 18 * 60 },
    { weekday: 4, openMin: 9 * 60, closeMin: 18 * 60 },
    { weekday: 5, openMin: 9 * 60, closeMin: 18 * 60 },
    { weekday: 6, openMin: 0, closeMin: 0 },
    { weekday: 0, openMin: 0, closeMin: 0 },
  ];
  const hoursRows =
    (await prisma.openingHours.findMany({
      where: { orgId: org.id },
      orderBy: { weekday: "asc" },
    })) ?? [];
  const hours = hoursRows.length ? hoursRows : defaultHours();

  const getHoursFor = (d: Date): { openMin: number; closeMin: number } => {
    const row = hours.find((h: { weekday: number }) => h.weekday === d.getDay());
    return {
      openMin: (row?.openMin ?? 9 * 60) as number,
      closeMin: (row?.closeMin ?? 18 * 60) as number,
    };
  };

  // Ranges
  const weekStart = startOfWeek(baseDate);
  const weekEnd = addDays(weekStart, 7);
  const dayStartTs = startOfDay(baseDate);
  const dayEndTs = endOfDay(baseDate);
  const rangeStart = view === "day" ? dayStartTs : weekStart;
  const rangeEnd = view === "day" ? dayEndTs : weekEnd;

  const q = (sp?.q || "").trim().toLowerCase();
  const staffFilter = (sp?.staff || "").trim();

  // Data (scoped by org)
  const [staff, services, apptsRaw] = await Promise.all([
    prisma.staffMember.findMany({
      where: { orgId: org.id, active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, active: true },
    }),
    prisma.service.findMany({
      where: { orgId: org.id },
      orderBy: { name: "asc" },
      select: { id: true, name: true, durationMin: true, priceCents: true },
    }),
    prisma.appointment.findMany({
      where: {
        orgId: org.id,
        startsAt: { gte: rangeStart, lt: rangeEnd },
        ...(q
          ? {
              OR: [
                { customerName: { contains: q, mode: "insensitive" } },
                { customerPhone: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
        ...(staffFilter ? { staffId: staffFilter } : {}),
      },
      include: { staff: true, service: true },
      orderBy: { startsAt: "asc" },
    }),
  ]);

  const DAY_START_H = Math.floor(getHoursFor(baseDate).openMin / 60);
  const DAY_END_H = Math.ceil(getHoursFor(baseDate).closeMin / 60);

  // Gutter ticks (based on active day’s hours)
  const gutterTimes: Date[] = [];
  {
    let t = setTime(rangeStart, DAY_START_H, 0);
    const end = setTime(rangeStart, DAY_END_H, 0);
    while (t < end) {
      gutterTimes.push(new Date(t));
      t = new Date(t.getTime() + SLOT_MIN * 60000);
    }
  }

  const appts = apptsRaw as ApptRow[];

  // Build blocks (WEEK)
  const weekBlocks: Block[][] = Array.from({ length: 7 }, () => []);
  if (view === "week") {
    for (const a of appts) {
      const dIdx = (a.startsAt.getDay() + 6) % 7; // Mon=0
      const hoursForDay = getHoursFor(addDays(weekStart, dIdx));
      const dayStartCalc = new Date(startOfDay(addDays(weekStart, dIdx)).getTime() + hoursForDay.openMin * 60000);
      const topMin = Math.max(0, minutesBetween(dayStartCalc, a.startsAt));
      const durMin = Math.max(10, minutesBetween(a.startsAt, a.endsAt));
      const top = (topMin / SLOT_MIN) * PX_PER_SLOT;
      const height = Math.max(32, (durMin / SLOT_MIN) * PX_PER_SLOT);

      weekBlocks[dIdx].push({
        id: a.id,
        top,
        height,
        title: a.customerName,
        subtitle: `${a.service?.name ?? "Service"} • ${a.staff?.name ?? "Staff"}`,
        staffName: a.staff?.name ?? "Staff",
        colorClass: colorForName(a.staff?.name ?? "Staff"),
        startsAt: a.startsAt,
        endsAt: a.endsAt,
        staffId: a.staffId,
        serviceId: a.serviceId,
      });
    }
  }

  // Build blocks (DAY)
  const dayBlocksByStaff: Record<string, Block[]> = {};
  if (view === "day") {
    for (const s of staff) dayBlocksByStaff[s.id] = [];
    for (const a of appts) {
      if (!a.staffId || !dayBlocksByStaff[a.staffId]) continue;
      const hoursForDay = getHoursFor(baseDate);
      const dayStartCalc = new Date(startOfDay(baseDate).getTime() + hoursForDay.openMin * 60000);
      const topMin = Math.max(0, minutesBetween(dayStartCalc, a.startsAt));
      const durMin = Math.max(10, minutesBetween(a.startsAt, a.endsAt));
      const top = (topMin / SLOT_MIN) * PX_PER_SLOT;
      const height = Math.max(32, (durMin / SLOT_MIN) * PX_PER_SLOT);

      dayBlocksByStaff[a.staffId].push({
        id: a.id,
        top,
        height,
        title: a.customerName,
        subtitle: a.service?.name ?? "Service",
        staffName: a.staff?.name ?? "Staff",
        colorClass: colorForName(a.staff?.name ?? "Staff"),
        startsAt: a.startsAt,
        endsAt: a.endsAt,
        staffId: a.staffId,
        serviceId: a.serviceId,
      });
    }
  }

  // Navigation URLs
const prevDate = addDays(baseDate, view === "day" ? -1 : -7);
const nextDate = addDays(baseDate, view === "day" ?  1 :  7);
  const today = new Date();
  const mkHref = (d: Date, v: ViewMode, extra?: Record<string, string>) => {
  const params = new URLSearchParams({
    view: v,
    date: isoDateOnlyLocal(d), // ✅ use the local-safe version
    ...(q ? { q } : {}),
    ...(staffFilter ? { staff: staffFilter } : {}),
    tz: tzPref,
    ...(extra || {}),
  }).toString();
  return `/calendar?${params}`;
};


  // quick overlap detector (same staff)
  function overlaps(
    a: { startsAt: Date; endsAt: Date; staffId: string | null },
    b: { startsAt: Date; endsAt: Date; staffId: string | null }
  ) {
    return a.staffId && b.staffId && a.staffId === b.staffId && a.startsAt < b.endsAt && b.startsAt < a.endsAt;
  }
  const overlapWarnings: Array<{ idA: string; idB: string }> = [];
  for (let i = 0; i < appts.length; i++) {
    for (let j = i + 1; j < appts.length; j++) {
      if (overlaps(appts[i], appts[j])) {
        overlapWarnings.push({ idA: appts[i].id, idB: appts[j].id });
      }
    }
  }

  return (
    <div className="p-6 md:p-8 bg-zinc-50 min-h-screen text-zinc-900">
      {/* Top bar */}
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Calendar</h1>
          <p className="text-sm text-zinc-500 mt-1">
            {view === "week" ? (
              <>Week of {fmtDay(weekStart, activeTZ)} – {fmtDay(addDays(weekStart, 6), activeTZ)}</>
            ) : (
              <>{DAY_LABEL[(baseDate.getDay() + 6) % 7]} • {fmtDay(baseDate, activeTZ)}</>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm hover:bg-zinc-50" href={mkHref(prevDate, view)}>
            ← Prev
          </Link>
          <Link className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm hover:bg-zinc-50" href={mkHref(today, view)}>
            Today
          </Link>
          <Link className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm hover:bg-zinc-50" href={mkHref(nextDate, view)}>
            Next →
          </Link>

          <div className="w-px h-6 bg-zinc-300 mx-1" />

          <Link
            href={mkHref(baseDate, "week")}
            className={`rounded-md px-3 py-1.5 text-sm border ${
              view === "week" ? "bg-indigo-600 text-white border-indigo-600" : "bg-white border-zinc-300 hover:bg-zinc-50"
            }`}
          >
            Week
          </Link>
          <Link
            href={mkHref(baseDate, "day")}
            className={`rounded-md px-3 py-1.5 text-sm border ${
              view === "day" ? "bg-indigo-600 text-white border-indigo-600" : "bg-white border-zinc-300 hover:bg-zinc-50"
            }`}
          >
            Day
          </Link>

          <div className="w-px h-6 bg-zinc-300 mx-1" />

          {/* filters/search — client island */}
         <FiltersBar
         orgTZ={org.timezone}
         activeTZ={tzPref}
         staff={staff}
         services={services}
         searchQuery={q}
         staffFilter={staffFilter}
         appts={appts}
         />

          <NewBookingButton
            staff={staff}
            services={services}
            defaultDate={view === "day" ? baseDate : weekStart}
          />
        </div>
      </header>

      {/* Overlap warning */}
      {overlapWarnings.length > 0 && (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 text-amber-900 px-4 py-2 text-sm">
          ⚠️ Potential double-bookings detected ({overlapWarnings.length}). Check staff allocations.
        </div>
      )}
{/* Calendar shell */}
<div className="relative border border-zinc-200 rounded-xl bg-white shadow-sm overflow-auto" data-cal-body>
  {/* Sticky header row */}
  <div
    className="sticky top-0 z-10 grid border-b border-zinc-200 bg-white"
    style={{
      gridTemplateColumns:
        view === "week"
          ? `120px repeat(7, minmax(180px, 1fr))`
          : `120px repeat(${Math.max(1, staff.length)}, minmax(220px, 1fr))`,
    }}
  >
    {/* time label cell */}
    <div className="h-12 flex items-center justify-end pr-3 text-sm font-medium text-zinc-500">Time</div>

    {view === "week"
      ? DAY_LABEL.map((label, i) => (
          <div key={i} className="h-12 border-l border-zinc-200 flex flex-col items-center justify-center">
            <span className="font-semibold text-zinc-700">{label}</span>
            <span className="text-xs text-zinc-400">{addDays(weekStart, i).getDate()}</span>
          </div>
        ))
      : staff.map((s: StaffRow) => (
          <div key={s.id} className="h-12 border-l border-zinc-200 flex items-center justify-center gap-2">
            <div className={`w-2 h-2 rounded-full ${colorForName(s.name).split(" ")[0]}`} aria-hidden />
            <span className="font-semibold text-zinc-700">{s.name}</span>
          </div>
        ))}
  </div>

  {/* Main scrollable grid */}
  <div
    className="grid"
    data-cal-grid
    style={{
      gridTemplateColumns:
        view === "week"
          ? `120px repeat(7, minmax(180px, 1fr))`
          : `120px repeat(${Math.max(1, staff.length)}, minmax(220px, 1fr))`,
    }}
  >
    {/* Left time gutter */}
    <div className="bg-zinc-50 border-r border-zinc-200">
      {gutterTimes.map((tm: Date, i: number) => (
        <div key={i} className="h-16 border-b border-zinc-100 text-xs text-zinc-500 flex items-start justify-end pr-3 pt-1">
          {fmtTime(tm, activeTZ)}
        </div>
      ))}
    </div>

          {/* Columns */}
          {view === "week"
            ? DAY_LABEL.map((_, dIdx: number) => (
                <GridColumn
                  key={dIdx}
                  gutterSlots={gutterTimes.length}
                  blocks={weekBlocks[dIdx]}
                  create={{
                    dateISO: isoDateOnly(addDays(weekStart, dIdx)),
                    slotMin: SLOT_MIN,
                    staff: staff.map((s: StaffRow) => ({ id: s.id, name: s.name })),
                    services: services.map((sv: ServiceRow) => ({
                      id: sv.id,
                      name: sv.name,
                      durationMin: sv.durationMin,
                    })),
                  }}
                />
              ))
            : staff.map((s: StaffRow) => (
                <GridColumn
                  key={s.id}
                  gutterSlots={gutterTimes.length}
                  blocks={dayBlocksByStaff[s.id] ?? []}
                  create={{
                    dateISO: isoDateOnly(baseDate),
                    slotMin: SLOT_MIN,
                    staff: [{ id: s.id, name: s.name }],
                    services: services.map((sv: ServiceRow) => ({
                      id: sv.id,
                      name: sv.name,
                      durationMin: sv.durationMin,
                    })),
                  }}
                />
              ))}
        </div>
      </div>

      {/* Empty state */}
      {staff.length === 0 && (
        <div className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-zinc-600 mt-6">
          No staff yet. Add staff in{" "}
          <a className="text-indigo-600 underline" href="/settings">
            Settings
          </a>{" "}
          to see the calendar.
        </div>
      )}

      {/* Edit modal mount point (client island portals into body) */}
      <EditBookingPortal staff={staff} services={services} timezone={activeTZ} />
    </div>
  );
}
