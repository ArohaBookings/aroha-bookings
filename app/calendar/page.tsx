/* ==========================  AROHA BOOKINGS — CALENDAR  ==========================
   Phase 2+  (server component)
   -------------------------------------------------------------------------------
   Highlights:
   • Follows Opening Hours from Settings (no more 5am; day/week window derived).
   • Org-timezone-based vertical math keeps grid + blocks aligned.
   • Preserves customer phone/name for edit modal (exposed on block payload).
   • Extra UX polish: off-hours shading, "now" marker, week number, jump-to-date,
     filter chips, stats row, closed-day badges, safe empty states.
   • Future-proofed: helper URLs for online booking deep-links by day & staff.
   • Google Calendar sync:
       - Reads org’s chosen calendarId from OrgSettings.data.integrations.googleCalendar.
       - On render, pulls Google events for the visible range into appointments.
       - Connect chip POSTs /api/calendar/google/select (no more GET error).

   Notes:
   - This file only renders the server page. It ships serializable data to the
     ClientIslands: FiltersBar, NewBookingButton, GridColumn, EditBookingPortal.
   - A tiny follow-up in ClientIslands is needed to read two new block props
     (customerName/Phone) when opening the edit form (see bottom “ONE-LINER”).
   - TypeScript strict-safe. Next 15+ `searchParams` awaited. noStore() used.

   =============================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const dynamicParams = true;

import React from "react";
import Link from "next/link";
import { Badge } from "@/components/ui";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { unstable_noStore as noStore } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireOrgOrPurchase } from "@/lib/requireOrgOrPurchase";
import { getCalendarClient } from "@/lib/integrations/google/calendar";
import { readGoogleCalendarIntegration, writeGoogleCalendarIntegration } from "@/lib/orgSettings";
import { getOrgEntitlements } from "@/lib/entitlements";

import {
  FiltersBar,
  NewBookingButton,
  GridColumn,
  EditBookingPortal,
} from "./ClientIslands";
import { GoogleCalendarConnectChip } from "./GoogleCalendarConnectChip";

/* ───────────────────────────────────────────────────────────────
   Local Types (server-side view models)
   ─────────────────────────────────────────────────────────────── */

type ViewMode = "week" | "day";

/** DB → server VM: staff */
type StaffRow = {
  id: string;
  name: string;
  active: boolean;
};

/** DB → server VM: service */
type ServiceRow = {
  id: string;
  name: string;
  durationMin: number;
  priceCents: number;
};

/** Org (from session) */
type OrgRow = {
  id: string;
  name: string;
  timezone: string; // IANA TZ
};

/** DB → server VM: appointment row + minimal expands */
type ApptRow = {
  id: string;
  orgId: string;
  customerId: string | null;
  startsAt: Date;
  endsAt: Date;
  customerName: string;
  customerPhone: string;
  source?: string | null;
  staffId: string | null;
  serviceId: string | null;
  staff: { id: string; name: string } | null;
  service: { id: string; name: string; durationMin: number } | null;
  status?: "SCHEDULED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
  externalProvider?: string | null;
  externalCalendarId?: string | null;
  externalCalendarEventId?: string | null;
  syncedAt?: Date | null;
};

/** Rendered block for GridColumn (serialized) */
type Block = {
  id: string;
  top: number; // px
  height: number; // px
  title: string; // customerName
  subtitle: string; // service/staff string
  staffName: string;
  colorClass: string;
  startsAt: string; // ISO
  endsAt: string; // ISO
  staffId: string | null;
  serviceId: string | null;

  /** Pass through to editor so phone/name prefill survives */
  _customerPhone: string;
  _customerName: string;
  _originTag?: "Aroha booking" | "Google busy block" | "Manual";
};

/* ───────────────────────────────────────────────────────────────
   Constants / Palettes
   ─────────────────────────────────────────────────────────────── */

const DAY_LABEL = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Visual slot size + cell height (keep synced with ClientIslands.SLOT_PX = 64) */
const SLOT_MIN = 30; // logical grid size
const PX_PER_SLOT = 64; // px per SLOT_MIN => 60min = 2 slots => 128px
const ORG_MIN_OPEN = 8 * 60; // hard floor for salons — never show before 08:00

/** Pastel-ish color classes per staff name hash */
const PALETTE = [
  "bg-indigo-100 border-indigo-300 text-indigo-900",
  "bg-pink-100 border-pink-300 text-pink-900",
  "bg-emerald-100 border-emerald-300 text-emerald-900",
  "bg-amber-100 border-amber-300 text-amber-900",
  "bg-sky-100 border-sky-300 text-sky-900",
  "bg-violet-100 border-violet-300 text-violet-900",
  "bg-rose-100 border-rose-300 text-rose-900",
] as const;

/* Map staff name → palette class. */
function colorForName(name: string): (typeof PALETTE)[number] {
  const sum = name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return PALETTE[sum % PALETTE.length];
}

/* ───────────────────────────────────────────────────────────────
   Date & Time helpers (TZ-safe grid math)
   ─────────────────────────────────────────────────────────────── */

/** Format day label (e.g. "Apr 11") in target TZ for user display */
function fmtDay(d: Date, tz?: string): string {
  return d.toLocaleDateString([], { month: "short", day: "numeric", timeZone: tz });
}

/** Format time label (e.g. "9:00 AM") in target TZ for user display */
function fmtTime(d: Date, tz?: string): string {
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: tz });
}

/** Monday-first start-of-week in *local env* (Date has no TZ) */
function startOfWeekLocal(d: Date): Date {
  const x = new Date(d);
  const dow = x.getDay(); // Sun=0..Sat=6
  const diff = x.getDate() - dow + (dow === 0 ? -6 : 1); // Monday-first
  const s = new Date(x.setDate(diff));
  s.setHours(0, 0, 0, 0);
  return s;
}

function startOfDayLocal(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDayLocal(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function addDaysLocal(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function orgDayBoundsUTC(d: Date, tz: string) {
  // Find wall-clock minutes into the day at instant `d` in TZ `tz`,
  // back up that many minutes to get 00:00 in that TZ, then add 24h-1ms for the end.
  const mins = tzMath.minutesFromMidnight(d, tz);
  const start = new Date(d.getTime() - mins * 60000);
  const end = new Date(start.getTime() + 24 * 60 * 60000 - 1);
  return { start, end };
}

/** Useful ISO renderers */
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

/* ───────────────────────────────────────────────────────────────
   tzMath: wall-clock minutes in org timezone
   ---------------------------------------------------------------- */

const tzMath = {
  /** Minutes from 00:00 (in tz) for a specific Date */
  minutesFromMidnight(date: Date, tz: string): number {
    const p = new Intl.DateTimeFormat("en-GB", {
      hour12: false,
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(date);

    const h = Number(p.find((x) => x.type === "hour")?.value ?? "0");
    const m = Number(p.find((x) => x.type === "minute")?.value ?? "0");
    return h * 60 + m;
  },

  /** Weekday index in tz (0=Sun..6=Sat) for a specific Date */
  weekday(date: Date, tz: string): number {
    const p = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      weekday: "short",
    }).format(date); // e.g. "Mon"
    switch (p.slice(0, 3).toLowerCase()) {
      case "sun":
        return 0;
      case "mon":
        return 1;
      case "tue":
        return 2;
      case "wed":
        return 3;
      case "thu":
        return 4;
      case "fri":
        return 5;
      case "sat":
        return 6;
      default:
        return new Date(date).getDay();
    }
  },

  /** Mins diff (b - a) in tz (approx via absolute minutes-from-midnight + day delta) */
  diffMinutesInTZ(a: Date, b: Date, tz: string): number {
    const dayA = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
    const dayB = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
    const dayDelta = Math.round((dayB - dayA) / (24 * 3600 * 1000));
    const minsA = tzMath.minutesFromMidnight(a, tz);
    const minsB = tzMath.minutesFromMidnight(b, tz);
    return dayDelta * 24 * 60 + (minsB - minsA);
  },

  /** Add minutes in real UTC time, but intended as "advance wall-clock" (safe for slots) */
  addMinutes(d: Date, mins: number): Date {
    return new Date(d.getTime() + mins * 60000);
  },
};

/* ───────────────────────────────────────────────────────────────
   Opening Hours helpers
   ─────────────────────────────────────────────────────────────── */

type OpeningHoursRow = {
  weekday: number; // 0=Sun..6=Sat
  openMin: number;
  closeMin: number;
};

function defaultHours(): OpeningHoursRow[] {
  return [
    { weekday: 1, openMin: 9 * 60, closeMin: 18 * 60 }, // Mon
    { weekday: 2, openMin: 9 * 60, closeMin: 18 * 60 }, // Tue
    { weekday: 3, openMin: 9 * 60, closeMin: 18 * 60 }, // Wed
    { weekday: 4, openMin: 9 * 60, closeMin: 18 * 60 }, // Thu
    { weekday: 5, openMin: 9 * 60, closeMin: 18 * 60 }, // Fri
    { weekday: 6, openMin: 0, closeMin: 0 }, // Sat closed
    { weekday: 0, openMin: 0, closeMin: 0 }, // Sun closed
  ];
}

/** Lookup opening hours for a tz-correct weekday (0=Sun..6=Sat) */
function getHoursForDay(
  hours: OpeningHoursRow[],
  weekday: number,
): { openMin: number; closeMin: number } {
  const row = hours.find((h) => h.weekday === weekday);
  return {
    openMin: Number(row?.openMin ?? 9 * 60),
    closeMin: Number(row?.closeMin ?? 18 * 60),
  };
}

/** WEEK view: min open across Mon..Sun; max close across Mon..Sun (ignore fully-closed days) */
function computeWeekWindow(hours: OpeningHoursRow[], weekStartLocal: Date, tz: string) {
  let startMin = Number.POSITIVE_INFINITY;
  let endMin = 0;

  for (let i = 0; i < 7; i++) {
    const d = addDaysLocal(weekStartLocal, i);
    const weekdayInTZ = tzMath.weekday(d, tz);
    const { openMin, closeMin } = getHoursForDay(hours, weekdayInTZ);
    if (closeMin > openMin) {
      startMin = Math.min(startMin, openMin);
      endMin = Math.max(endMin, closeMin);
    }
  }
  if (!isFinite(startMin) || endMin <= startMin) {
    return { startMin: 9 * 60, endMin: 17 * 60, weeklyAllClosed: true as const };
  }
  return { startMin, endMin, weeklyAllClosed: false as const };
}

/* ───────────────────────────────────────────────────────────────
   Auth/Org helper (server action inside this file)
   ─────────────────────────────────────────────────────────────── */

// currently unused but left here as a helper if you need a pure-org-gated variant
async function requireOrg(): Promise<OrgRow> {
  "use server";
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/api/auth/signin");

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    include: { memberships: { include: { org: true } } },
  });

  const org = user?.memberships?.[0]?.org;
  if (!org) redirect("/onboarding");

  return { id: org.id, name: org.name, timezone: org.timezone };
}

/* ───────────────────────────────────────────────────────────────
   Online booking deep-link helpers (future-proof)
   ─────────────────────────────────────────────────────────────── */

function mkOnlineBookingLink(base: string, d: Date, staffId?: string | null) {
  const params = new URLSearchParams({
    date: isoDateOnlyLocal(d),
    ...(staffId ? { staff: staffId } : {}),
  }).toString();
  return `${base}?${params}`;
}

/* ───────────────────────────────────────────────────────────────
   Google Calendar inbound sync (Google → Aroha)
   ─────────────────────────────────────────────────────────────── */

/**
 * For a given org + calendar + time range, pull Google events into Aroha
 * appointments so they appear in the grid.
 *
 * - Only creates rows for events we haven’t seen before (by event.id).
 * - Marks them with source = "google-sync:<eventId>".
 * - Leaves staff/service unassigned; user can adjust in UI as needed.
 */
async function syncGoogleToArohaRange(
  orgId: string,
  calendarId: string,
  rangeStartUTC: Date,
  rangeEndUTC: Date,
): Promise<void> {
  try {
    const gcal = await getCalendarClient(orgId);
    if (!gcal) {
      // No usable Google tokens on this request – just skip quietly.
      return;
    }

    const res = await gcal.events.list({
      calendarId,
      timeMin: rangeStartUTC.toISOString(),
      timeMax: rangeEndUTC.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
    });

    const items = res.data.items || [];
    if (!items.length) return;

    const existingBusy = await prisma.appointment.findMany({
      where: { orgId, source: { startsWith: "google-busy:" } },
      select: { id: true, source: true, startsAt: true, endsAt: true },
    });
    const busyByEventId = new Map<string, { id: string; startsAt: Date; endsAt: Date }>();
    existingBusy.forEach((b) => {
      const match = (b.source || "").match(/^google-busy:(.+)$/);
      if (match?.[1]) busyByEventId.set(match[1], { id: b.id, startsAt: b.startsAt, endsAt: b.endsAt });
    });

    for (const ev of items) {
      if (ev.status === "cancelled") continue;
      const eventId = ev.id;
      if (!eventId) continue;

      const startIso = ev.start?.dateTime || ev.start?.date;
      const endIso = ev.end?.dateTime || ev.end?.date;
      if (!startIso || !endIso) continue;

      const startsAt = new Date(startIso);
      const endsAt = new Date(endIso);
      if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) continue;

      const isAllDay = !ev.start?.dateTime && !!ev.start?.date;
      if (isAllDay) {
        startsAt.setHours(9, 0, 0, 0);
        endsAt.setHours(17, 0, 0, 0);
      }

      const sourceFlag = (ev.extendedProperties?.private as Record<string, string> | undefined)?.source;
      const bookingId = (ev.extendedProperties?.private as Record<string, string> | undefined)?.bookingId;

      if (sourceFlag === "arohabookings" && bookingId) {
        const appt = await prisma.appointment.findUnique({
          where: { id: bookingId },
          select: { id: true, startsAt: true, endsAt: true, externalCalendarEventId: true },
        });
        if (appt) {
          const needsTimeUpdate =
            appt.startsAt.getTime() !== startsAt.getTime() || appt.endsAt.getTime() !== endsAt.getTime();
          await prisma.appointment.update({
            where: { id: appt.id },
            data: {
              ...(needsTimeUpdate ? { startsAt, endsAt } : {}),
              externalProvider: "google",
              externalCalendarEventId: eventId,
              externalCalendarId: calendarId,
              syncedAt: new Date(),
            },
          });
        }
        continue;
      }

      const existing = busyByEventId.get(eventId);
      if (existing) {
        if (existing.startsAt.getTime() !== startsAt.getTime() || existing.endsAt.getTime() !== endsAt.getTime()) {
          await prisma.appointment.update({
            where: { id: existing.id },
            data: {
              startsAt,
              endsAt,
              customerName: ev.summary || "Google busy",
              customerPhone: "",
              source: `google-busy:${eventId}`,
            },
          });
        }
        continue;
      }

      await prisma.appointment.create({
        data: {
          orgId,
          startsAt,
          endsAt,
          customerName: ev.summary || "Google busy",
          customerPhone: "",
          status: "SCHEDULED",
          source: `google-busy:${eventId}`,
        },
      });
    }

    const os = await prisma.orgSettings.findUnique({ where: { orgId }, select: { data: true } });
    const next = writeGoogleCalendarIntegration(
      (os?.data as Record<string, unknown>) || {},
      { lastSyncAt: new Date().toISOString(), lastSyncError: null }
    );
    await prisma.orgSettings.upsert({
      where: { orgId },
      create: { orgId, data: next as any },
      update: { data: next as any },
    });
  } catch (err) {
    console.error("Error in Google → Aroha calendar sync:", err);
    try {
      const existing = await prisma.orgSettings.findUnique({ where: { orgId }, select: { data: true } });
      const data = (existing?.data as Record<string, unknown>) || {};
      const next = writeGoogleCalendarIntegration(data, {
        lastSyncError: err instanceof Error ? err.message : "Google sync failed",
        lastSyncAt: new Date().toISOString(),
      });
      await prisma.orgSettings.update({ where: { orgId }, data: { data: next as any } });
    } catch {}
  }
}

/* ───────────────────────────────────────────────────────────────
   Page (server component)
   ─────────────────────────────────────────────────────────────── */

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: ViewMode;
    date?: string;
    q?: string;
    staff?: string;
    tz?: "org" | "local";
  }>;
}) {
  const sp = (await searchParams) ?? {};

  noStore();

  // Gating (purchase or org)
  const gate = await requireOrgOrPurchase();
  const isSuperAdmin = !!gate.isSuperAdmin;
  const org = (gate.org as OrgRow | null) ?? null;

  // --- Google Calendar connection status (OrgSettings -> data.integrations.googleCalendar) ---
  let googleCalendarId: string | null = null;
  let googleAccountEmail: string | null = null;
  let calendarSyncErrors: Array<{ appointmentId?: string; error?: string; ts?: string }> = [];
  let calendarLastSyncAt: string | null = null;
  let needsReconnect = false;
  let googleConnectedFlag = false;

  if (org) {
    try {
      const [os, connection] = await Promise.all([
        prisma.orgSettings.findUnique({
          where: { orgId: org.id },
          select: { data: true },
        }),
        prisma.calendarConnection.findFirst({
          where: { orgId: org.id, provider: "google" },
          orderBy: { updatedAt: "desc" },
          select: { accountEmail: true, expiresAt: true },
        }),
      ]);
      const data = (os?.data as any) ?? {};
      const google = readGoogleCalendarIntegration(data);
      googleCalendarId = google.calendarId;
      googleAccountEmail = google.accountEmail ?? connection?.accountEmail ?? null;
      googleConnectedFlag = google.connected && google.syncEnabled;
      calendarSyncErrors = Array.isArray(data.calendarSyncErrors) ? data.calendarSyncErrors : [];
      calendarLastSyncAt = google.lastSyncAt;
      needsReconnect = connection?.expiresAt
        ? connection.expiresAt.getTime() < Date.now() - 2 * 60 * 1000
        : false;
    } catch {
      // swallow; render as "not connected"
      googleCalendarId = null;
      googleAccountEmail = null;
      calendarSyncErrors = [];
      calendarLastSyncAt = null;
      needsReconnect = false;
      googleConnectedFlag = false;
    }
  }

  const isGoogleConnected = Boolean(googleCalendarId) && googleConnectedFlag;

  // Paywall: either org exists OR they still have a valid purchase token
  const hasPurchase = Boolean(org || gate.purchaseToken);
  if (!isSuperAdmin && !hasPurchase) {
    redirect("/?purchase=required");
  }

  if (!org) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Thanks for purchasing Aroha Bookings. Finish setup on{" "}
          <a className="underline" href="/onboarding">
            the onboarding page
          </a>{" "}
          to create your organisation.
        </p>
      </div>
    );
  }

  const entitlements = await getOrgEntitlements(org.id);
  if (!entitlements.features.calendar) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Calendar access is disabled for this plan.{" "}
          <a className="underline" href="/settings">
            Upgrade to enable
          </a>
          .
        </p>
      </div>
    );
  }

  /* ─────────────────────────────────────────────────────────────
     Resolve user intent: view/date/tz + filters
     ──────────────────────────────────────────────────────────── */
  const view: ViewMode = sp.view === "day" ? "day" : "week";
  const baseDateLocal = parseDateParam(sp.date);

  const tzPref: "org" | "local" = sp.tz === "local" ? "local" : "org";
  const displayTZ = tzPref === "org" ? org.timezone : undefined; // undefined = viewer's local

  const normalizedQuery = (sp?.q || "").trim().toLowerCase();
  const staffFilter = (sp?.staff || "").trim();

  /* ─────────────────────────────────────────────────────────────
     Opening Hours (from DB) with safe fallback
     ──────────────────────────────────────────────────────────── */
  let hoursRows: OpeningHoursRow[] | null = null;
  try {
    hoursRows = await prisma.openingHours.findMany({
      where: { orgId: org.id },
      orderBy: { weekday: "asc" },
      select: { weekday: true, openMin: true, closeMin: true },
    });
  } catch {
    hoursRows = null;
  }
  const hours = (hoursRows && hoursRows.length ? hoursRows : defaultHours()) as OpeningHoursRow[];

  /* ─────────────────────────────────────────────────────────────
     Compute calendar windows (org-TZ based)
     ──────────────────────────────────────────────────────────── */

  const weekStartLocal = startOfWeekLocal(baseDateLocal);
  const weekEndLocal = addDaysLocal(weekStartLocal, 7);

  const weekdayInOrgTZ = tzMath.weekday(baseDateLocal, org.timezone);
  const dayHoursInOrgTZ = getHoursForDay(hours, weekdayInOrgTZ);
  const dayStartMin = dayHoursInOrgTZ.openMin;
  const dayEndMin = dayHoursInOrgTZ.closeMin;

  const {
    startMin: weekStartMin,
    endMin: weekEndMin,
    weeklyAllClosed,
  } = computeWeekWindow(hours, weekStartLocal, org.timezone);

  const windowStartMin = view === "day" ? dayStartMin : weekStartMin;
  const windowEndMin = view === "day" ? dayEndMin : weekEndMin;

  const normalizedWindowStartMin =
    !isFinite(windowStartMin) || windowEndMin <= windowStartMin
      ? 9 * 60
      : Math.max(windowStartMin, ORG_MIN_OPEN); // clamp to ≥ 08:00

  const normalizedWindowEndMin =
    !isFinite(windowEndMin) || windowEndMin <= windowStartMin ? 17 * 60 : windowEndMin;

  const gutterTimes: Date[] = [];
  {
    const labelBase = startOfDayLocal(baseDateLocal);
    const minutesRange = normalizedWindowEndMin - normalizedWindowStartMin;
    const slots = Math.max(1, Math.ceil(minutesRange / SLOT_MIN));
    let t = tzMath.addMinutes(labelBase, normalizedWindowStartMin);
    for (let i = 0; i < slots; i++) {
      gutterTimes.push(t);
      t = tzMath.addMinutes(t, SLOT_MIN);
    }
  }

  /* ─────────────────────────────────────────────────────────────
     Date range for DB query + Google sync range
     ──────────────────────────────────────────────────────────── */

  const dayStart = orgDayBoundsUTC(baseDateLocal, org.timezone).start;
  const dayEnd = orgDayBoundsUTC(baseDateLocal, org.timezone).end;

  const weekStartOrg = orgDayBoundsUTC(weekStartLocal, org.timezone).start;
  const weekEndOrg = orgDayBoundsUTC(addDaysLocal(weekStartLocal, 6), org.timezone).end;

  const rangeStartUTC = view === "day" ? dayStart : weekStartOrg;
  const rangeEndUTC = view === "day" ? dayEnd : weekEndOrg;

  // If Google is connected, pull Google events for this range into Prisma
  if (isGoogleConnected && googleCalendarId) {
    await syncGoogleToArohaRange(org.id, googleCalendarId, rangeStartUTC, rangeEndUTC);
  }

  /* ─────────────────────────────────────────────────────────────
     Query data (scoped by org) — resilient on empty DBs
     ──────────────────────────────────────────────────────────── */
  let staff: StaffRow[] = [];
  let services: ServiceRow[] = [];
  let apptsRaw: ApptRow[] = [];

  try {
    [staff, services, apptsRaw] = (await Promise.all([
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
          // Any overlap with [rangeStartUTC, rangeEndUTC]
          startsAt: { lt: rangeEndUTC },
          endsAt: { gt: rangeStartUTC },
          ...(normalizedQuery
            ? {
                OR: [
                  { customerName: { contains: normalizedQuery, mode: "insensitive" } },
                  { customerPhone: { contains: normalizedQuery, mode: "insensitive" } },
                ],
              }
            : {}),
          ...(staffFilter ? { staffId: staffFilter } : {}),
          status: { not: "CANCELLED" },
        },
        orderBy: { startsAt: "asc" },
        select: {
          id: true,
          orgId: true,
          customerId: true,
          startsAt: true,
          endsAt: true,
          customerName: true,
          customerPhone: true,
          source: true,
          staffId: true,
          serviceId: true,
          status: true,
          externalProvider: true,
          externalCalendarId: true,
          externalCalendarEventId: true,
          syncedAt: true,
          staff: { select: { id: true, name: true } },
          service: { select: { id: true, name: true, durationMin: true } },
        },
      }),
    ])) as [StaffRow[], ServiceRow[], ApptRow[]];
  } catch {
    staff = [];
    services = [];
    apptsRaw = [];
  }

  /* ─────────────────────────────────────────────────────────────
     Convert appts into blocks (org-tz aware vertical math)
     ──────────────────────────────────────────────────────────── */

  function minutesSinceMidnightInTZ(d: Date, tz: string): number {
    const parts = new Intl.DateTimeFormat("en-GB", {
      hour12: false,
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(d);

    const hh = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
    const mm = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    return hh * 60 + mm;
  }

  function diffMinutesInTZLocal(a: Date, b: Date, tz: string): number {
    const dayA = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
    const dayB = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
    const dayDelta = Math.round((dayB - dayA) / (24 * 60 * 60 * 1000));

    const minsA = minutesSinceMidnightInTZ(a, tz);
    const minsB = minutesSinceMidnightInTZ(b, tz);
    return dayDelta * 24 * 60 + (minsB - minsA);
  }

  const syncErrorByAppt = new Map<string, { message: string; ts?: string }>();
  for (const err of calendarSyncErrors) {
    const id = String(err?.appointmentId || "").trim();
    const message = String(err?.error || "").trim();
    if (id && message) syncErrorByAppt.set(id, { message, ts: err?.ts });
  }

  function resolveOriginTag(a: ApptRow): Block["_originTag"] {
    const source = (a.source || "").toLowerCase();
    if (source.startsWith("google-busy:")) return "Google busy block";
    if (source.startsWith("manual")) return "Manual";
    return "Aroha booking";
  }

  function computeBlockLayoutForDay(
    _dayDateLocal: Date,
    openMin: number,
    aStart: Date,
    aEnd: Date,
  ) {
    const timezone = org?.timezone ?? "Pacific/Auckland";
    const minsStart = minutesSinceMidnightInTZ(aStart, timezone);
    const topMin = Math.max(0, minsStart - openMin);
    const durMin = Math.max(10, diffMinutesInTZLocal(aStart, aEnd, timezone));

    const topPx = (topMin / SLOT_MIN) * PX_PER_SLOT;
    const heightPx = Math.max(32, (durMin / SLOT_MIN) * PX_PER_SLOT);

    return { top: topPx, height: heightPx };
  }

// WEEK blocks — 7 columns Mon..Sun
const weekBlocks: Block[][] = Array.from({ length: 7 }, () => []);

const getSyncFields = (a: (typeof apptsRaw)[number]) => {
  return {
    _syncProvider: a.externalProvider ?? null,
    _syncCalendarId: a.externalCalendarId ?? null,
    _syncEventId: a.externalCalendarEventId ?? null,
    _syncedAt: a.syncedAt ? a.syncedAt.toISOString() : null,
    _syncErrorMessage: syncErrorByAppt.get(a.id)?.message ?? null,
    _syncErrorAt: syncErrorByAppt.get(a.id)?.ts ?? null,
  } satisfies Record<string, unknown>;
};

if (view === "week") {
  for (const a of apptsRaw) {
    const wdayOrg = tzMath.weekday(a.startsAt, org.timezone); // 0..6 (Sun..Sat)
    const dIdx = (wdayOrg + 6) % 7; // Mon=0 .. Sun=6

    const dayLocal = addDaysLocal(weekStartLocal, dIdx);
    const hoursForDay = getHoursForDay(hours, wdayOrg);
    const { top, height } = computeBlockLayoutForDay(
      dayLocal,
      hoursForDay.openMin,
      a.startsAt,
      a.endsAt,
    );

    const base: Block = {
      id: a.id,
      top,
      height,
      title: a.customerName,
      subtitle: `${a.service?.name ?? "Service"} • ${a.staff?.name ?? "Staff"}`,
      staffName: a.staff?.name ?? "Staff",
      colorClass: colorForName(a.staff?.name ?? "Staff"),
      startsAt: a.startsAt.toISOString(),
      endsAt: a.endsAt.toISOString(),
      staffId: a.staffId ?? null,
      serviceId: a.serviceId ?? null,
      _customerPhone: a.customerPhone ?? "",
      _customerName: a.customerName ?? "",
      _originTag: resolveOriginTag(a),
      // _customerId removed from Block-typed object (was causing TS2353)
    };

    weekBlocks[dIdx].push({
      ...base,
      ...(getSyncFields(a) as Partial<Block>),
      ...({ _customerId: a.customerId ?? null } as Partial<Block> & { _customerId?: string | null }),
    });
  }
}

// DAY blocks — one column per *active* staff (+ optional “Unassigned”)
const dayBlocksByStaff: Record<string, Block[]> = {};

if (view === "day") {
  for (const s of staff) {
    if (s.active) dayBlocksByStaff[s.id] = [];
  }

  let hasUnassigned = false;

  for (const a of apptsRaw) {
    const wdayOrg = tzMath.weekday(a.startsAt, org.timezone);
    if (wdayOrg !== weekdayInOrgTZ) continue;

    const hoursForDay = dayHoursInOrgTZ;
    const { top, height } = computeBlockLayoutForDay(
      baseDateLocal,
      hoursForDay.openMin,
      a.startsAt,
      a.endsAt,
    );

    const base: Block = {
      id: a.id,
      top,
      height,
      title: a.customerName,
      subtitle: a.service?.name ?? "Service",
      staffName: a.staff?.name ?? "Unassigned",
      colorClass: colorForName(a.staff?.name ?? "Unassigned"),
      startsAt: a.startsAt.toISOString(),
      endsAt: a.endsAt.toISOString(),
      staffId: a.staffId ?? null,
      serviceId: a.serviceId ?? null,
      _customerPhone: a.customerPhone ?? "",
      _customerName: a.customerName ?? "",
      _originTag: resolveOriginTag(a),
      // _customerId removed from Block-typed object (was causing TS2353)
    };

    const block: Block = {
      ...base,
      ...(getSyncFields(a) as Partial<Block>),
      ...({ _customerId: a.customerId ?? null } as Partial<Block> & { _customerId?: string | null }),
    };

    if (a.staffId && dayBlocksByStaff[a.staffId]) {
      dayBlocksByStaff[a.staffId].push(block);
    } else {
      hasUnassigned = true;
      if (!dayBlocksByStaff["_unassigned"]) dayBlocksByStaff["_unassigned"] = [];
      dayBlocksByStaff["_unassigned"].push(block);
    }
  }

  if (!hasUnassigned && dayBlocksByStaff["_unassigned"]) {
    delete dayBlocksByStaff["_unassigned"];
  }
}

  /* ─────────────────────────────────────────────────────────────
     Navigation (prev/next/today) + URL builder
     ──────────────────────────────────────────────────────────── */

  const prevDateLocal = addDaysLocal(baseDateLocal, view === "day" ? -1 : -7);
  const nextDateLocal = addDaysLocal(baseDateLocal, view === "day" ? 1 : 7);
  const todayLocal = new Date();

  const mkHref = (d: Date, v: ViewMode, extra?: Record<string, string>) => {
    const params = new URLSearchParams({
      view: v,
      date: isoDateOnlyLocal(d),
      ...(normalizedQuery ? { q: normalizedQuery } : {}),
      ...(staffFilter ? { staff: staffFilter } : {}),
      tz: tzPref,
      ...(extra || {}),
    }).toString();
    return `/calendar?${params}`;
  };

  /* ─────────────────────────────────────────────────────────────
     Quick stats, chips, little helpers
     ──────────────────────────────────────────────────────────── */

  const totalAppts = apptsRaw.length;
  const activeStaffCount = staff.filter((s) => s.active).length;
  const openSpanHours = Math.max(0, (normalizedWindowEndMin - normalizedWindowStartMin) / 60);

  const showNowMarker: boolean = (() => {
    const todayWdayOrg = tzMath.weekday(todayLocal, org.timezone);
    if (view === "day") {
      return todayWdayOrg === weekdayInOrgTZ;
    }
    const todayIndex = (todayWdayOrg + 6) % 7; // Mon=0..Sun=6
    return todayIndex >= 0 && todayIndex < 7;
  })();

  const nowTopPx: number | null = showNowMarker
    ? (() => {
        const nowMin = tzMath.minutesFromMidnight(todayLocal, org.timezone);
        const relMin = Math.max(0, nowMin - normalizedWindowStartMin);
        return (relMin / SLOT_MIN) * PX_PER_SLOT;
      })()
    : null;

  const headerLabel: string =
    view === "week"
      ? `Week of ${fmtDay(weekStartLocal, displayTZ)} – ${fmtDay(
          addDaysLocal(weekStartLocal, 6),
          displayTZ,
        )}`
      : `${DAY_LABEL[(weekdayInOrgTZ + 6) % 7]} • ${fmtDay(baseDateLocal, displayTZ)}`;

  function weekNumber(d: Date): number {
    const temp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    temp.setUTCDate(temp.getUTCDate() + 4 - ((temp.getUTCDay() + 6) % 7));
    const yearStart = new Date(Date.UTC(temp.getUTCFullYear(), 0, 1));
    return Math.ceil(((+temp - +yearStart) / 86400000 + 1) / 7);
  }
  const weekNum = weekNumber(weekStartLocal);

  /* ─────────────────────────────────────────────────────────────
     Render
     ──────────────────────────────────────────────────────────── */

  return (
    <div className="p-6 md:p-8 bg-zinc-50 min-h-screen text-zinc-900">
      {/* Top bar */}
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-6">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">Calendar</h1>
          <p className="text-sm text-zinc-500">
            {headerLabel} • <span title="ISO Week Number">Wk {weekNum}</span>
            {displayTZ ? (
              <span className="ml-2">
                · TZ: <span className="font-medium">{displayTZ}</span>
              </span>
            ) : (
              <span className="ml-2">
                · TZ: <span className="font-medium">Local</span>
              </span>
            )}
          </p>
          <p className="text-xs text-zinc-500">
            Open window: {Math.floor(normalizedWindowStartMin / 60)}:
            {String(normalizedWindowStartMin % 60).padStart(2, "0")}–
            {Math.floor(normalizedWindowEndMin / 60)}:
            {String(normalizedWindowEndMin % 60).padStart(2, "0")} ({openSpanHours}h)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Nav buttons */}
          <Link
            className="rounded-full border border-zinc-200 bg-white px-4 py-1.5 text-sm font-medium text-zinc-700 shadow-sm hover:border-emerald-200 hover:bg-emerald-50"
            href={mkHref(prevDateLocal, view)}
          >
            ← Prev
          </Link>
          <Link
            className="rounded-full border border-zinc-200 bg-white px-4 py-1.5 text-sm font-medium text-zinc-700 shadow-sm hover:border-emerald-200 hover:bg-emerald-50"
            href={mkHref(todayLocal, view)}
          >
            Today
          </Link>
          <Link
            className="rounded-full border border-zinc-200 bg-white px-4 py-1.5 text-sm font-medium text-zinc-700 shadow-sm hover:border-emerald-200 hover:bg-emerald-50"
            href={mkHref(nextDateLocal, view)}
          >
            Next →
          </Link>

          <div className="w-px h-6 bg-zinc-200 mx-1" />

          {/* view switch */}
          <Link
            href={mkHref(baseDateLocal, "week")}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold border ${
              view === "week"
                ? "bg-[color:var(--brand-primary)] text-white border-transparent shadow-sm"
                : "bg-white border-zinc-200 text-zinc-700 hover:border-emerald-200 hover:bg-emerald-50"
            }`}
          >
            Week
          </Link>
          <Link
            href={mkHref(baseDateLocal, "day")}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold border ${
              view === "day"
                ? "bg-[color:var(--brand-primary)] text-white border-transparent shadow-sm"
                : "bg-white border-zinc-200 text-zinc-700 hover:border-emerald-200 hover:bg-emerald-50"
            }`}
          >
            Day
          </Link>

          <div className="w-px h-6 bg-zinc-200 mx-1" />

          {/* Google Calendar connect/sync (client chip doing POST) */}
          <GoogleCalendarConnectChip
            isGoogleConnected={isGoogleConnected}
            googleAccountEmail={googleAccountEmail}
            orgId={org.id}
            lastSyncAt={calendarLastSyncAt}
            lastError={calendarSyncErrors[0]?.error ? String(calendarSyncErrors[0].error) : null}
            needsReconnect={needsReconnect}
          />

          {/* filters/search — client island */}
          <FiltersBar
            orgTZ={org.timezone}
            activeTZ={tzPref}
            staff={staff}
            services={services}
            searchQuery={normalizedQuery}
            staffFilter={staffFilter}
            appts={apptsRaw.map((a) => ({
              startsAt: a.startsAt,
              endsAt: a.endsAt,
              customerName: a.customerName,
              customerPhone: a.customerPhone,
              staffId: a.staffId,
              serviceId: a.serviceId,
            }))}
          />

          <NewBookingButton
            staff={staff}
            services={services}
            defaultDate={view === "day" ? baseDateLocal : weekStartLocal}
          />
        </div>
      </header>

      {/* Filter chips + quick clear */}
      {(normalizedQuery || staffFilter) && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {normalizedQuery && (
            <Badge variant="neutral" className="gap-2">
              Search: <span className="font-medium">{normalizedQuery}</span>
              <Link
                className="ml-1 underline text-zinc-600"
                href={mkHref(baseDateLocal, view, { q: "" })}
              >
                clear
              </Link>
            </Badge>
          )}
          {staffFilter && (
            <Badge variant="neutral" className="gap-2">
              Staff:{" "}
              <span className="font-medium">
                {staff.find((s) => s.id === staffFilter)?.name ?? "Unknown"}
              </span>
              <Link
                className="ml-1 underline text-zinc-600"
                href={mkHref(baseDateLocal, view, { staff: "" })}
              >
                clear
              </Link>
            </Badge>
          )}
        </div>
      )}

      {/* Tiny stats */}
      <div className="mb-4 text-xs text-zinc-600">
        <span className="mr-4">
          Appointments:{" "}
          <span className="font-medium text-zinc-900">{totalAppts}</span>
        </span>
        <span className="mr-4">
          Active staff:{" "}
          <span className="font-medium text-zinc-900">{activeStaffCount}</span>
        </span>
        <span>
          Window: <span className="font-medium text-zinc-900">{openSpanHours}h</span>
        </span>
      </div>

      {/* Overlap warning (same staff) */}
      {(() => {
        function overlaps(
          a: { startsAt: Date; endsAt: Date; staffId: string | null },
          b: { startsAt: Date; endsAt: Date; staffId: string | null },
        ) {
          return (
            a.staffId &&
            b.staffId &&
            a.staffId === b.staffId &&
            a.startsAt < b.endsAt &&
            b.startsAt < a.endsAt
          );
        }
        const warnings: Array<{ idA: string; idB: string }> = [];
        for (let i = 0; i < apptsRaw.length; i++) {
          for (let j = i + 1; j < apptsRaw.length; j++) {
            if (overlaps(apptsRaw[i], apptsRaw[j])) warnings.push({ idA: apptsRaw[i].id, idB: apptsRaw[j].id });
          }
        }
        return warnings.length > 0 ? (
          <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 text-amber-900 px-4 py-2 text-sm">
            ⚠️ Potential double-bookings detected ({warnings.length}). Check staff allocations.
          </div>
        ) : null;
      })()}

      {/* Calendar shell */}
      <div
        className="relative border border-zinc-200 rounded-xl bg-white shadow-sm overflow-auto"
        data-cal-body
      >
        {/* Sticky header row */}
        <div
          className="sticky top-0 z-10 grid border-b border-zinc-200 bg-white"
          style={{
            gridTemplateColumns:
              view === "week"
                ? `140px repeat(7, minmax(200px, 1fr))`
                : `140px repeat(${Math.max(
                    1,
                    Object.keys(dayBlocksByStaff).length || staff.length,
                  )}, minmax(220px, 1fr))`,
          }}
        >
          {/* time label cell */}
          <div className="h-12 flex items-center justify-end pr-3 text-sm font-medium text-zinc-500">
            Time
          </div>

          {view === "week"
            ? DAY_LABEL.map((label, i) => {
                const dayLocal = addDaysLocal(weekStartLocal, i);
                const weekdayOrg = tzMath.weekday(dayLocal, org.timezone);
                const h = getHoursForDay(hours, weekdayOrg);
                const closed = h.closeMin <= h.openMin;

                return (
                  <div
                    key={i}
                    className="h-12 border-l border-zinc-200 bg-white/80 flex items-center justify-center gap-2 text-sm"
                  >
                    <span className="font-semibold text-zinc-700">{label}</span>
                    <span className="text-xs text-zinc-400">{dayLocal.getDate()}</span>
                    {closed && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-100 border border-zinc-200 text-zinc-600">
                        closed
                      </span>
                    )}
                  </div>
                );
              })
            : (() => {
                const keys = Object.keys(dayBlocksByStaff);
                const renderOrder =
                  keys.length > 0
                    ? keys
                    : staff.filter((s) => s.active).map((s) => s.id);

                return renderOrder.map((sid) => {
                  const s = staff.find((x) => x.id === sid);
                  const isUnassigned = sid === "_unassigned";
                  const name = isUnassigned ? "Unassigned" : s?.name ?? "Staff";
                  return (
                    <div
                      key={sid}
                      className="h-12 border-l border-zinc-200 flex items-center justify-center gap-2"
                    >
                      <div
                        className={`w-2 h-2 rounded-full ${
                          colorForName(name).split(" ")[0]
                        }`}
                        aria-hidden
                      />
                      <span className="font-semibold text-zinc-700">{name}</span>
                    </div>
                  );
                });
              })()}
        </div>

        {/* Main scrollable grid */}
        <div
          className="grid"
          data-cal-grid
          style={{
            gridTemplateColumns:
              view === "week"
                ? `140px repeat(7, minmax(200px, 1fr))`
                : `140px repeat(${Math.max(
                    1,
                    Object.keys(dayBlocksByStaff).length || staff.length,
                  )}, minmax(220px, 1fr))`,
          }}
        >
          {/* Left time gutter */}
          <div className="bg-white border-r border-zinc-200">
            {gutterTimes.map((tm: Date, i: number) => (
              <div
                key={i}
                className="h-16 border-b border-zinc-100/80 text-xs text-zinc-500 flex items-start justify-end pr-3 pt-1"
              >
                {fmtTime(tm, displayTZ)}
              </div>
            ))}
          </div>

          {/* Columns */}
          {view === "week"
            ? DAY_LABEL.map((_, dIdx: number) => {
                const dayLocal = addDaysLocal(weekStartLocal, dIdx);
                const weekdayOrg = tzMath.weekday(dayLocal, org.timezone);
                const h = getHoursForDay(hours, weekdayOrg);
                const closed = h.closeMin <= h.openMin;

                const offTopPx = Math.max(
                  0,
                  ((h.openMin - normalizedWindowStartMin) / SLOT_MIN) * PX_PER_SLOT,
                );
                const offBottomPx = Math.max(
                  0,
                  ((normalizedWindowEndMin - h.closeMin) / SLOT_MIN) * PX_PER_SLOT,
                );
                const gutterSlotsCount = Math.max(
                  1,
                  Math.ceil(
                    (normalizedWindowEndMin - normalizedWindowStartMin) / SLOT_MIN,
                  ),
                );

                return (
                  <div key={dIdx} className="relative">
                    {/* off-hours shading (top) */}
                    {offTopPx > 0 && (
                      <div
                        className="absolute left-0 right-0 bg-zinc-100/60 pointer-events-none"
                        style={{ top: 0, height: offTopPx }}
                        aria-hidden
                      />
                    )}
                    {/* off-hours shading (bottom) */}
                    {offBottomPx > 0 && (
                      <div
                        className="absolute left-0 right-0 bg-zinc-100/60 pointer-events-none"
                        style={{ bottom: 0, height: offBottomPx }}
                        aria-hidden
                      />
                    )}

                    <GridColumn
                      gutterSlots={gutterSlotsCount}
                      blocks={weekBlocks[dIdx]}
                      create={{
                        dateISO: isoDateOnlyLocal(dayLocal),
                        slotMin: SLOT_MIN,
                        staff: staff.map((s) => ({ id: s.id, name: s.name })),
                        services: services.map((sv) => ({
                          id: sv.id,
                          name: sv.name,
                          durationMin: sv.durationMin,
                        })),
                      }}
                    />

                    {/* "Now" line in this day column (org tz) */}
                    {showNowMarker &&
                      (() => {
                        const todayIdx = (tzMath.weekday(todayLocal, org.timezone) + 6) % 7;
                        return todayIdx === dIdx ? (
                          <div
                            className="absolute left-0 right-0 h-[2px] bg-rose-500"
                            style={{ top: nowTopPx ?? 0 }}
                            aria-label="Now"
                          />
                        ) : null;
                      })()}

                    {/* Closed overlay */}
                    {closed && (
                      <div className="absolute inset-x-0 top-0 bottom-0 flex items-center justify-center pointer-events-none">
                        <span className="text-[11px] text-zinc-500 bg-white/80 px-2 py-1 rounded border">
                          Closed
                        </span>
                      </div>
                    )}
                  </div>
                );
              })
            : (() => {
                const keys = Object.keys(dayBlocksByStaff);
                const renderOrder =
                  keys.length > 0
                    ? keys
                    : staff.filter((s) => s.active).map((s) => s.id);

                const gutterSlotsCount = Math.max(
                  1,
                  Math.ceil(
                    (normalizedWindowEndMin - normalizedWindowStartMin) / SLOT_MIN,
                  ),
                );

                return renderOrder.map((sid) => {
                  const isUnassigned = sid === "_unassigned";
                  const colName = isUnassigned
                    ? "Unassigned"
                    : staff.find((s) => s.id === sid)?.name ?? "Staff";
                  const h = dayHoursInOrgTZ;

                  const offTopPx = Math.max(
                    0,
                    ((h.openMin - normalizedWindowStartMin) / SLOT_MIN) * PX_PER_SLOT,
                  );
                  const offBottomPx = Math.max(
                    0,
                    ((normalizedWindowEndMin - h.closeMin) / SLOT_MIN) * PX_PER_SLOT,
                  );

                  return (
                    <div key={sid} className="relative">
                      {/* off-hours shading */}
                      {offTopPx > 0 && (
                        <div
                          className="absolute left-0 right-0 bg-zinc-100/60 pointer-events-none"
                          style={{ top: 0, height: offTopPx }}
                        />
                      )}
                      {offBottomPx > 0 && (
                        <div
                          className="absolute left-0 right-0 bg-zinc-100/60 pointer-events-none"
                          style={{ bottom: 0, height: offBottomPx }}
                        />
                      )}

                      <GridColumn
                        gutterSlots={gutterSlotsCount}
                        blocks={dayBlocksByStaff[sid] ?? []}
                        create={{
                          dateISO: isoDateOnlyLocal(baseDateLocal),
                          slotMin: SLOT_MIN,
                          staff: isUnassigned
                            ? staff.map((s) => ({ id: s.id, name: s.name }))
                            : [{ id: sid, name: colName }],
                          services: services.map((sv) => ({
                            id: sv.id,
                            name: sv.name,
                            durationMin: sv.durationMin,
                          })),
                        }}
                      />

                      {/* "Now" line (org tz) — only show if this column is today */}
                      {showNowMarker && (
                        <div
                          className="absolute left-0 right-0 h-[2px] bg-rose-500"
                          style={{ top: nowTopPx ?? 0 }}
                          aria-label="Now"
                        />
                      )}
                    </div>
                  );
                });
              })()}
        </div>
      </div>

      {/* If there are truly no staff, nudge to settings */}
      {staff.length === 0 && (
        <div className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-zinc-600 mt-6">
          No staff yet. Add staff in{" "}
          <a className="text-indigo-600 underline" href="/settings">
            Settings
          </a>{" "}
          to see the calendar.
        </div>
      )}

      {/* Gentle weekly-all-closed state */}
      {view === "week" && weeklyAllClosed && (
        <div className="mt-4 rounded-md border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
          Your opening hours for this week are set to closed on all days. Update them in{" "}
          <a className="text-indigo-600 underline" href="/settings">
            Settings → Opening Hours
          </a>
          .
        </div>
      )}

      {/* Footer helpers: deep links to public booking (future-proof) */}
      <footer className="mt-8 flex flex-col gap-2 text-xs text-zinc-600">
        <div>
          Public booking preview (example):{" "}
          <a
            className="text-indigo-600 underline"
            href={mkOnlineBookingLink("/book", baseDateLocal, staffFilter || undefined)}
          >
            /book?date={isoDateOnlyLocal(baseDateLocal)}
            {staffFilter ? `&staff=${staffFilter}` : ""}
          </a>
        </div>
        <div className="text-zinc-500">
          Tip: Double-click a grid cell to create a booking starting at that slot.
        </div>
      </footer>

      {/* Edit modal mount point (client island portals into body) */}
      <EditBookingPortal
        staff={staff}
        services={services}
        timezone={displayTZ ?? org.timezone}
      />
    </div>
  );
}
