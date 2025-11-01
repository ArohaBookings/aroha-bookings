"use server";

/**
 * Aroha Bookings – Calendar Actions (server)
 * -------------------------------------------------------------
 * - Zero external deps (keep edge-friendly).
 * - Prisma + NextAuth only.
 * - Opinionated safety rails + graceful failures.
 *
 * Key choices:
 *  1) Opening-hours are **advisory** by default (no hard block). Flip by org setting:
 *      OrgSettings.data = { "calendar": { "enforceHours": true } }
 *  2) Same-day invariant is enforced (no cross-day appts).
 *  3) All times snap to a 5-minute grid server-side.
 *  4) Overlap check excludes CANCELLED; unassigned staff can overlap.
 *  5) Customer auto-link by phone (create on first seen).
 *  6) Cancel captures actor email.
 *  7) Idempotent create via optional `clientToken`.
 *
 * Exposed server actions:
 *  - calendarBootstrap()
 *  - listEvents({start,end})
 *  - createBooking(FormData)
 *  - updateBooking(FormData)
 *  - cancelBooking(FormData)
 *  - updateBookingStatus(id, status)
 *  - deleteBooking(id)
 *  - duplicateBooking(id, daysOffset=7)
 *  - rescheduleBooking(id, patch)
 *
 * This file is deliberately verbose and future-proofed.
 * Keep it in sync with your Prisma schema.
 */

import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

/* ═══════════════════════════════════════════════════════════════
   Types, constants, and tiny utils
   ═══════════════════════════════════════════════════════════════ */

type Org = { id: string; name: string; timezone: string };
type BookingStatus = "SCHEDULED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
type ActionOk = { ok: true };
type ActionErr = { ok: false; error: string };
type ActionResult = ActionOk | ActionErr;

const MIN_DURATION = 10;     // never allow shorter than 10 minutes
const DEFAULT_DURATION = 30; // fallback if none provided
const SLOT_STEP_MIN = 5;     // snap to 5-min increments
const MAX_TITLE_LEN = 120;   // soft guard
const MAX_NOTES_LEN = 2000;  // soft guard

/** Domain-ish error helper */
function fail(msg: string): ActionErr {
  return { ok: false, error: msg };
}

/** Trim string safely */
function s(value: unknown): string {
  return String(value ?? "").trim();
}

/** Safe int */
function toInt(x: unknown, def = 0): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : def;
}

/* ═══════════════════════════════════════════════════════════════
   Auth + Org context
   ═══════════════════════════════════════════════════════════════ */

async function requireOrg(): Promise<Org> {
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

async function currentActorEmail(): Promise<string> {
  try {
    const session = await getServerSession(authOptions);
    return session?.user?.email || "system";
  } catch {
    return "system";
  }
}

/* ═══════════════════════════════════════════════════════════════
   Org preferences (from OrgSettings JSON)
   data = { calendar?: { enforceHours?: boolean } }
   ═══════════════════════════════════════════════════════════════ */

type OrgPrefs = {
  calendar?: {
    enforceHours?: boolean;
    // future flags can go here without breaking anything
  };
};

async function getOrgPrefs(orgId: string): Promise<OrgPrefs> {
  const row = await prisma.orgSettings.findUnique({
    where: { orgId },
    select: { data: true },
  });
  const data = (row?.data ?? {}) as any;
  // Defensive clone so callers don’t mutate prisma JSON accidentally
  return JSON.parse(JSON.stringify(data || {}));
}

/* ═══════════════════════════════════════════════════════════════
   Opening hours / calendar helpers
   ═══════════════════════════════════════════════════════════════ */

async function getOpeningHours(orgId: string) {
  const rows =
    (await prisma.openingHours.findMany({
      where: { orgId },
      orderBy: { weekday: "asc" },
      select: { weekday: true, openMin: true, closeMin: true },
    })) ?? [];
  if (rows.length) return rows;
  // Fallback Mon–Fri 9–18, weekend closed
  return [
    { weekday: 1, openMin: 9 * 60, closeMin: 18 * 60 },
    { weekday: 2, openMin: 9 * 60, closeMin: 18 * 60 },
    { weekday: 3, openMin: 9 * 60, closeMin: 18 * 60 },
    { weekday: 4, openMin: 9 * 60, closeMin: 18 * 60 },
    { weekday: 5, openMin: 9 * 60, closeMin: 18 * 60 },
    { weekday: 6, openMin: 0, closeMin: 0 },
    { weekday: 0, openMin: 0, closeMin: 0 },
  ];
}

function minutesFromMidnight(d: Date, tz: string): number {
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

function weekdayInTZ(d: Date, tz: string): number {
  const w = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short" })
    .format(d)
    .slice(0, 3)
    .toLowerCase();
  return w === "sun"
    ? 0
    : w === "mon"
    ? 1
    : w === "tue"
    ? 2
    : w === "wed"
    ? 3
    : w === "thu"
    ? 4
    : w === "fri"
    ? 5
    : 6;
}

function sameOrgDay(a: Date, b: Date, tz: string): boolean {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(a) === fmt.format(b);
}

/** Snap ms to N-minute grid */
function snapMinutes(ms: number, stepMin = SLOT_STEP_MIN): number {
  const step = stepMin * 60_000;
  return Math.round(ms / step) * step;
}

/* Opening-hours validator
   - By default only enforces "end after start".
   - If org setting calendar.enforceHours === true, enforce hours.
*/
function validateWithinOpeningHours(
  startsAt: Date,
  endsAt: Date,
  orgTZ: string,
  dayOpenMin: number,
  dayCloseMin: number,
  enforce: boolean
): string | null {
  if (endsAt.getTime() <= startsAt.getTime()) return "End time must be after start time.";
  if (!enforce) return null; // permissive by default

  if (dayCloseMin <= dayOpenMin) return "Selected day is closed in Opening Hours.";
  const startMin = minutesFromMidnight(startsAt, orgTZ);
  const endMin = minutesFromMidnight(endsAt, orgTZ);
  if (startMin < dayOpenMin || endMin > dayCloseMin) {
    return `Time is outside opening hours (${Math.floor(dayOpenMin / 60)}:${String(dayOpenMin % 60).padStart(2, "0")}–${Math.floor(dayCloseMin / 60)}:${String(dayCloseMin % 60).padStart(2, "0")} org time).`;
  }
  return null;
}

/* ═══════════════════════════════════════════════════════════════
   Parsing + normalization
   ═══════════════════════════════════════════════════════════════ */
   /** Accepts local naive "YYYY-MM-DDTHH:MM(:SS)?" OR full ISO with Z/offset */
function parseAnyDate(input: string): Date | null {
  if (!input) return null;

  // Full ISO (e.g. 2025-10-28T03:15:00.000Z or with timezone offset)
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+\-]\d{2}:\d{2})$/.test(input)) {
    const d = new Date(input);
    return isNaN(d.getTime()) ? null : d;
  }

  // Local naive "YYYY-MM-DDTHH:MM" or with seconds
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(input)) {
    const s = input.length === 16 ? `${input}:00` : input;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  return null;
}

/** Accepts "YYYY-MM-DDTHH:MM" or "YYYY-MM-DDTHH:MM:SS" */
function parseLocalDate(input: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(input)) return null;
  const s = input.length === 16 ? `${input}:00` : input;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** Light NZ-style normalizer: keep digits/+; ensure 0-prefix if none */
function normalizePhone(raw: string): string {
  const r = (raw || "").trim();
  if (!r) return "";
  let s = r.replace(/[^\d+]/g, "");
  if (s && s[0] !== "+" && s[0] !== "0") s = "0" + s;
  return s;
}

/* ═══════════════════════════════════════════════════════════════
   Ownership + existence checks
   ═══════════════════════════════════════════════════════════════ */

async function assertBelongsToOrg(orgId: string, staffId: string | null, serviceId: string | null) {
  if (staffId) {
    const s = await prisma.staffMember.count({ where: { id: staffId, orgId } });
    if (!s) throw new Error("Selected staff is not in this organisation.");
  }
  if (serviceId) {
    const s = await prisma.service.count({ where: { id: serviceId, orgId } });
    if (!s) throw new Error("Selected service is not in this organisation.");
  }
}

async function requireAppointmentOwned(orgId: string, id: string) {
  const row = await prisma.appointment.findUnique({ where: { id }, select: { orgId: true } });
  if (!row || row.orgId !== orgId) throw new Error("Booking not found.");
}

/* ═══════════════════════════════════════════════════════════════
   Overlap + duration resolution
   ═══════════════════════════════════════════════════════════════ */

async function hasOverlapForStaff(
  orgId: string,
  staffId: string | null,
  idToIgnore: string | null,
  startsAt: Date,
  endsAt: Date
) {
  if (!staffId) return false; // unassigned can overlap
  const count = await prisma.appointment.count({
  where: {
    orgId,
    staffId,
    status: { not: "CANCELLED" },
    ...(idToIgnore ? { id: { not: idToIgnore } } : {}),
    // overlap: a starts before b ends AND a ends after b starts
    startsAt: { lt: endsAt },   // <-- use the function param `endsAt`
    endsAt:   { gt: startsAt }, // <-- use the function param `startsAt`
  },
});
  return count > 0;
}

async function resolveDuration(
  orgId: string,
  serviceId: string | null,
  durationMin?: number | null
): Promise<number> {
  const explicit = Number(durationMin || 0);
  if (explicit >= MIN_DURATION) return explicit;
  if (!serviceId) return DEFAULT_DURATION;
  const svc = await prisma.service.findFirst({
    where: { id: serviceId, orgId },
    select: { durationMin: true },
  });
  return Math.max(MIN_DURATION, svc?.durationMin ?? DEFAULT_DURATION);
}

function existingEndsToDuration(a: { startsAt: Date; endsAt: Date }) {
  return Math.max(MIN_DURATION, Math.round((a.endsAt.getTime() - a.startsAt.getTime()) / 60_000));
}

/* ═══════════════════════════════════════════════════════════════
   Customer auto-link (by phone)
   ═══════════════════════════════════════════════════════════════ */

async function ensureCustomer(orgId: string, name: string, phoneRaw: string) {
  const phone = normalizePhone(phoneRaw);
  if (!phone) return null;
  const existing = await prisma.customer.findFirst({ where: { orgId, phone }, select: { id: true } });
  if (existing) return existing.id;
  const created = await prisma.customer.create({
    data: { orgId, name: name || "Customer", phone },
    select: { id: true },
  });
  return created.id;
}

/* ═══════════════════════════════════════════════════════════════
   Calendar bootstrap + list
   ═══════════════════════════════════════════════════════════════ */

export async function calendarBootstrap() {
  const org = await requireOrg();

  const [staff, services, openingHours, schedules, orgRow] = await Promise.all([
    prisma.staffMember.findMany({
      where: { orgId: org.id },
      orderBy: { name: "asc" },
      select: { id: true, name: true, active: true, colorHex: true, email: true },
    }),
    prisma.service.findMany({
      where: { orgId: org.id },
      orderBy: { name: "asc" },
      select: { id: true, name: true, durationMin: true, colorHex: true },
    }),
    prisma.openingHours.findMany({
      where: { orgId: org.id },
      orderBy: { weekday: "asc" },
      select: { weekday: true, openMin: true, closeMin: true },
    }),
    prisma.staffSchedule.findMany({
      where: { staff: { orgId: org.id } },
      orderBy: [{ staffId: "asc" }, { dayOfWeek: "asc" }],
      select: { staffId: true, dayOfWeek: true, startTime: true, endTime: true },
    }),
    prisma.organization.findUnique({
      where: { id: org.id },
      select: { timezone: true, dashboardConfig: true },
    }),
  ]);

  return {
    org: { id: org.id, name: org.name, timezone: orgRow?.timezone ?? "Pacific/Auckland" },
    staff,
    services,
    openingHours,
    schedules,
    calendarPrefs: (orgRow?.dashboardConfig as any)?.calendarPrefs ?? {},
  };
}

export async function listEvents(range: { start: string; end: string }) {
  const org = await requireOrg();
  const { start, end } = range;

  const rows = await prisma.appointment.findMany({
    where: {
      startsAt: { lt: end },
      endsAt: { gt: start },
      orgId: org.id,
    },
    orderBy: { startsAt: "asc" },
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      status: true,
      source: true,
      staffId: true,
      serviceId: true,
      customerName: true,
      customerPhone: true,
      staff: { select: { name: true, colorHex: true } },
      service: { select: { name: true, colorHex: true, durationMin: true } },
    },
  });

  const events = rows.map((r: typeof rows[number]) => ({
    id: r.id,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    status: r.status,
    source: r.source,
    staffId: r.staffId,
    staffName: r.staff?.name ?? "(Unassigned)",
    staffColor: r.staff?.colorHex ?? null,
    serviceId: r.serviceId,
    serviceName: r.service?.name ?? "(None)",
    serviceColor: r.service?.colorHex ?? null,
    serviceDurationMin: r.service?.durationMin ?? null,
    customerName: r.customerName,
    customerPhone: r.customerPhone,
  }));

  return { events };
}

/* ═══════════════════════════════════════════════════════════════
   CREATE
   ═══════════════════════════════════════════════════════════════ */

export async function createBooking(formData: FormData): Promise<ActionResult> {
  const org = await requireOrg();

  try {
    // Required fields
    const rawStart = s(formData.get("startsAt"));
    const staffId = (s(formData.get("staffId")) || null) as string | null;
    const serviceId = (s(formData.get("serviceId")) || null) as string | null;

    // Optional/derived
    const rawDur = toInt(formData.get("durationMin"), 0);
    const customerName = s(formData.get("customerName") || "Client").slice(0, MAX_TITLE_LEN);
    const customerPhone = normalizePhone(s(formData.get("customerPhone")));
    const notes = s(formData.get("notes")).slice(0, MAX_NOTES_LEN);
    const clientToken = s(formData.get("clientToken")); // optional idempotency token

    if (!rawStart) return fail("Missing start time.");
    if (!customerName) return fail("Customer name is required.");

    // Idempotency: if clientToken provided, bail if already used to create a row with same token
    // (Implementation: we piggy-back on CheckoutToken table if desired, but we’ll stay no-op here;
    // leave hook for future by storing token in appointment.source like "manual:token:{...}".)
    if (clientToken) {
      const existing = await prisma.appointment.findFirst({
        where: { orgId: org.id, source: `manual:token:${clientToken}` },
        select: { id: true },
      });
      if (existing) return { ok: true }; // treat as success
    }

    // Parse time + compute end
    const startParsed = parseAnyDate(rawStart);
    if (!startParsed) return fail("Invalid start time.");
    const durationMin = await resolveDuration(org.id, serviceId, rawDur);
    const end = new Date(startParsed.getTime() + durationMin * 60_000);

    // Snap + same-day
    let snappedStart = new Date(snapMinutes(startParsed.getTime()));
    let snappedEnd = new Date(snapMinutes(end.getTime()));
    if (snappedEnd.getTime() - snappedStart.getTime() < MIN_DURATION * 60_000) {
      snappedEnd = new Date(snappedStart.getTime() + MIN_DURATION * 60_000);
    }
    if (!sameOrgDay(snappedStart, snappedEnd, org.timezone)) {
      return fail("Bookings can’t span multiple days.");
    }

    // Enforce ownership of related entities
    await assertBelongsToOrg(org.id, staffId, serviceId);

    // Optional hours enforcement
    const prefs = await getOrgPrefs(org.id);
    const enforce = !!prefs?.calendar?.enforceHours;
    if (enforce) {
      const hours = await getOpeningHours(org.id);
      const wday = weekdayInTZ(snappedStart, org.timezone);
      const day = hours.find((h: { weekday: number; openMin: number; closeMin: number }) => h.weekday === wday);
      const openMin = Number(day?.openMin ?? 9 * 60);
      const closeMin = Number(day?.closeMin ?? 18 * 60);
      const hoursErr = validateWithinOpeningHours(snappedStart, snappedEnd, org.timezone, openMin, closeMin, true);
      if (hoursErr) return fail(hoursErr);
    } else {
      // Still enforce end > start
      const hoursErr = validateWithinOpeningHours(snappedStart, snappedEnd, org.timezone, 0, 24 * 60, false);
      if (hoursErr) return fail(hoursErr);
    }

    // Overlap guard
    if (await hasOverlapForStaff(org.id, staffId, null, snappedStart, snappedEnd)) {
      return fail("Overlaps an existing booking for the selected staff.");
    }

    // Customer linkage
    const customerId = await ensureCustomer(org.id, customerName, customerPhone);

    await prisma.appointment.create({
      data: {
        orgId: org.id,
        staffId,
        serviceId,
        customerId,
        customerName,
        customerPhone,
        startsAt: snappedStart,
        endsAt: snappedEnd,
        source: clientToken ? `manual:token:${clientToken}` : "manual",
        status: "SCHEDULED",
        ...(notes ? { notes } : {}),
      },
    });

    return { ok: true };
  } catch (err: any) {
    console.error("Create booking failed:", err);
    return fail(err?.message ?? "Create booking failed.");
  }
}

/* ═══════════════════════════════════════════════════════════════
   UPDATE
   ═══════════════════════════════════════════════════════════════ */

export async function updateBooking(formData: FormData): Promise<ActionResult> {
  const org = await requireOrg();

  try {
    const id = s(formData.get("id"));
    if (!id) return fail("Missing booking id.");
    await requireAppointmentOwned(org.id, id);

    const rawStart = s(formData.get("startsAt"));
    if (!rawStart) return fail("Missing start time.");

    const staffId = (s(formData.get("staffId")) || null) as string | null;
    const serviceId = (s(formData.get("serviceId")) || null) as string | null;
    const customerName = s(formData.get("customerName") || "Client").slice(0, MAX_TITLE_LEN);
    const customerPhone = normalizePhone(s(formData.get("customerPhone")));
    const notes = s(formData.get("notes")).slice(0, MAX_NOTES_LEN);
    const rawDur = toInt(formData.get("durationMin"), 0);

    const startParsed = parseAnyDate(rawStart);
    if (!startParsed) return fail("Invalid start time.");

    const durationMin = await resolveDuration(org.id, serviceId, rawDur);
    const end = new Date(startParsed.getTime() + durationMin * 60_000);

    let snappedStart = new Date(snapMinutes(startParsed.getTime()));
    let snappedEnd = new Date(snapMinutes(end.getTime()));
    if (snappedEnd.getTime() - snappedStart.getTime() < MIN_DURATION * 60_000) {
      snappedEnd = new Date(snappedStart.getTime() + MIN_DURATION * 60_000);
    }
    if (!sameOrgDay(snappedStart, snappedEnd, org.timezone)) {
      return fail("Bookings can’t span multiple days.");
    }

    await assertBelongsToOrg(org.id, staffId, serviceId);

    const prefs = await getOrgPrefs(org.id);
    const enforce = !!prefs?.calendar?.enforceHours;
    if (enforce) {
      const hours = await getOpeningHours(org.id);
      const wday = weekdayInTZ(snappedStart, org.timezone);
      const day = hours.find((h: { weekday: number; openMin: number; closeMin: number }) => h.weekday === wday);
      const openMin = Number(day?.openMin ?? 9 * 60);
      const closeMin = Number(day?.closeMin ?? 18 * 60);
      const hoursErr = validateWithinOpeningHours(snappedStart, snappedEnd, org.timezone, openMin, closeMin, true);
      if (hoursErr) return fail(hoursErr);
    } else {
      const hoursErr = validateWithinOpeningHours(snappedStart, snappedEnd, org.timezone, 0, 24 * 60, false);
      if (hoursErr) return fail(hoursErr);
    }

    if (await hasOverlapForStaff(org.id, staffId, id, snappedStart, snappedEnd)) {
      return fail("Overlaps an existing booking for the same staff.");
    }

    const customerId = await ensureCustomer(org.id, customerName, customerPhone);

    await prisma.appointment.update({
      where: { id },
      data: {
        startsAt: snappedStart,
        endsAt: snappedEnd,
        staffId,
        serviceId,
        customerId,
        customerName,
        customerPhone,
        ...(notes ? { notes } : { notes: null }),
      },
    });

    return { ok: true };
  } catch (err: any) {
    console.error("Update booking failed:", err);
    return fail(err?.message ?? "Update booking failed.");
  }
}

/* ═══════════════════════════════════════════════════════════════
   CANCEL (soft)
   ═══════════════════════════════════════════════════════════════ */

export async function cancelBooking(formData: FormData): Promise<ActionResult> {
  const org = await requireOrg();
  try {
    const id = s(formData.get("id"));
    if (!id) return fail("Missing booking id.");
    await requireAppointmentOwned(org.id, id);

    const actor = await currentActorEmail();

    await prisma.appointment.update({
      where: { id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelledBy: actor,
      },
    });

    return { ok: true };
  } catch (err: any) {
    console.error("Cancel booking failed:", err);
    return fail(err?.message ?? "Cancel failed.");
  }
}

/* ═══════════════════════════════════════════════════════════════
   STATUS UPDATE
   ═══════════════════════════════════════════════════════════════ */

export async function updateBookingStatus(id: string, status: BookingStatus): Promise<ActionResult> {
  const org = await requireOrg();
  try {
    if (!id) return fail("Missing booking id.");
    await requireAppointmentOwned(org.id, id);

    await prisma.appointment.update({
      where: { id },
      data: { status },
    });

    return { ok: true };
  } catch (err: any) {
    console.error("Update status failed:", err);
    return fail(err?.message ?? "Update status failed.");
  }
}

/* ═══════════════════════════════════════════════════════════════
   DELETE (hard)
   ═══════════════════════════════════════════════════════════════ */

export async function deleteBooking(id: string): Promise<ActionResult> {
  const org = await requireOrg();
  try {
    if (!id) return fail("Missing booking id.");
    await requireAppointmentOwned(org.id, id);

    await prisma.appointment.delete({
      where: { id },
    });

    return { ok: true };
  } catch (err: any) {
    console.error("Delete failed:", err);
    return fail(err?.message ?? "Delete failed.");
  }
}

/* ═══════════════════════════════════════════════════════════════
   DUPLICATE (+7 days default)
   ═══════════════════════════════════════════════════════════════ */

export async function duplicateBooking(id: string, daysOffset = 7): Promise<ActionResult> {
  const org = await requireOrg();
  try {
    if (!id) return fail("Missing booking id.");
    await requireAppointmentOwned(org.id, id);

    const src = await prisma.appointment.findFirst({ where: { id, orgId: org.id } });
    if (!src) return fail("Booking not found.");

    const delta = daysOffset * 24 * 60 * 60 * 1000;
    const newStart = new Date(src.startsAt.getTime() + delta);
    let newEnd = new Date(src.endsAt.getTime() + delta);

    if (newEnd.getTime() - newStart.getTime() < MIN_DURATION * 60_000) {
      newEnd = new Date(newStart.getTime() + MIN_DURATION * 60_000);
    }
    if (!sameOrgDay(newStart, newEnd, org.timezone)) {
      return fail("Bookings can’t span multiple days.");
    }

    // Optional hours enforcement
    const prefs = await getOrgPrefs(org.id);
    const enforce = !!prefs?.calendar?.enforceHours;
    if (enforce) {
      const hours = await getOpeningHours(org.id);
      const wday = weekdayInTZ(newStart, org.timezone);
      const day = hours.find((h: { weekday: number; openMin: number; closeMin: number }) => h.weekday === wday);
      const openMin = Number(day?.openMin ?? 9 * 60);
      const closeMin = Number(day?.closeMin ?? 18 * 60);
      const hoursErr = validateWithinOpeningHours(newStart, newEnd, org.timezone, openMin, closeMin, true);
      if (hoursErr) return fail(hoursErr);
    } else {
      const hoursErr = validateWithinOpeningHours(newStart, newEnd, org.timezone, 0, 24 * 60, false);
      if (hoursErr) return fail(hoursErr);
    }

    if (await hasOverlapForStaff(org.id, src.staffId ?? null, null, newStart, newEnd)) {
      return fail("Duplicate overlaps another booking for the same staff.");
    }

    await prisma.appointment.create({
      data: {
        orgId: src.orgId,
        staffId: src.staffId ?? null,
        serviceId: src.serviceId ?? null,
        customerId: src.customerId ?? null,
        customerName: src.customerName,
        customerPhone: src.customerPhone,
        startsAt: newStart,
        endsAt: newEnd,
        status: "SCHEDULED",
        source: src.source ?? "duplicate",
        notes: src.notes ?? null,
      },
    });

    return { ok: true };
  } catch (err: any) {
    console.error("Duplicate failed:", err);
    return fail(err?.message ?? "Duplicate failed.");
  }
}

/* ═══════════════════════════════════════════════════════════════
   RESCHEDULE helper (used by drag/move or pills)
   ═══════════════════════════════════════════════════════════════ */

export async function rescheduleBooking(
  id: string,
  patch: { startsAtISO: string; durationMin?: number; staffId?: string | null; serviceId?: string | null }
): Promise<ActionResult> {
  const org = await requireOrg();
  try {
    if (!id) return fail("Missing booking id.");
    await requireAppointmentOwned(org.id, id);

    const existing = await prisma.appointment.findFirst({ where: { id, orgId: org.id } });
    if (!existing) return fail("Booking not found.");

    const newStarts = parseAnyDate(patch.startsAtISO);
    if (!newStarts) return fail("Invalid start time.");

    const newDuration = await resolveDuration(
      org.id,
      patch.serviceId ?? existing.serviceId,
      patch.durationMin ?? existingEndsToDuration(existing)
    );

    let newEnds = new Date(newStarts.getTime() + newDuration * 60_000);

    if (newEnds.getTime() - newStarts.getTime() < MIN_DURATION * 60_000) {
      newEnds = new Date(newStarts.getTime() + MIN_DURATION * 60_000);
    }
    if (!sameOrgDay(newStarts, newEnds, org.timezone)) {
      return fail("Bookings can’t span multiple days.");
    }

    const targetStaff = (patch.staffId ?? existing.staffId) || null;
    await assertBelongsToOrg(org.id, targetStaff, (patch.serviceId ?? existing.serviceId) || null);

    const prefs = await getOrgPrefs(org.id);
    const enforce = !!prefs?.calendar?.enforceHours;
    if (enforce) {
      const hours = await getOpeningHours(org.id);
      const wday = weekdayInTZ(newStarts, org.timezone);
      const day = hours.find((h: { weekday: number; openMin: number; closeMin: number }) => h.weekday === wday);
      const openMin = Number(day?.openMin ?? 9 * 60);
      const closeMin = Number(day?.closeMin ?? 18 * 60);
      const hoursErr = validateWithinOpeningHours(newStarts, newEnds, org.timezone, openMin, closeMin, true);
      if (hoursErr) return fail(hoursErr);
    } else {
      const hoursErr = validateWithinOpeningHours(newStarts, newEnds, org.timezone, 0, 24 * 60, false);
      if (hoursErr) return fail(hoursErr);
    }

    if (await hasOverlapForStaff(org.id, targetStaff, id, newStarts, newEnds)) {
      return fail("Reschedule overlaps another booking for the same staff.");
    }

    await prisma.appointment.update({
      where: { id },
      data: {
        startsAt: newStarts,
        endsAt: newEnds,
        staffId: targetStaff,
        serviceId: (patch.serviceId ?? existing.serviceId) || null,
      },
    });

    return { ok: true };
  } catch (err: any) {
    console.error("Reschedule failed:", err);
    return fail(err?.message ?? "Reschedule failed.");
  }
}

/* ═══════════════════════════════════════════════════════════════
   Bulk utilities (optional, future use)
   ═══════════════════════════════════════════════════════════════ */

export async function bulkCancelByStaff(
  staffId: string,
  range: { start: string; end: string }
): Promise<ActionResult> {
  const org = await requireOrg();
  try {
    if (!staffId) return fail("Missing staff id.");
    await assertBelongsToOrg(org.id, staffId, null);

    const actor = await currentActorEmail();
    await prisma.appointment.updateMany({
      where: {
        orgId: org.id,
        staffId,
        status: { not: "CANCELLED" },
        startsAt: { gte: new Date(range.start) },
        endsAt: { lte: new Date(range.end) },
      },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelledBy: actor },
    });
    return { ok: true };
  } catch (err: any) {
    console.error("Bulk cancel failed:", err);
    return fail(err?.message ?? "Bulk cancel failed.");
  }
}

export async function bulkMoveByMinutes(
  staffId: string | null,
  range: { start: string; end: string },
  minutes: number
): Promise<ActionResult> {
  const org = await requireOrg();
  try {
    const filter: any = {
      orgId: org.id,
      startsAt: { gte: new Date(range.start) },
      endsAt: { lte: new Date(range.end) },
      status: { not: "CANCELLED" },
    };
    if (staffId) filter.staffId = staffId;

    const rows = await prisma.appointment.findMany({
      where: filter,
      select: { id: true, startsAt: true, endsAt: true, staffId: true },
    });

    // Move each with same-day check
    for (const r of rows) {
      const ns = new Date(r.startsAt.getTime() + minutes * 60_000);
      const ne = new Date(r.endsAt.getTime() + minutes * 60_000);
      if (!sameOrgDay(ns, ne, org.timezone)) continue; // skip if crosses day
      if (await hasOverlapForStaff(org.id, r.staffId, r.id, ns, ne)) continue; // skip overlaps
      await prisma.appointment.update({ where: { id: r.id }, data: { startsAt: ns, endsAt: ne } });
    }

    return { ok: true };
  } catch (err: any) {
    console.error("Bulk move failed:", err);
    return fail(err?.message ?? "Bulk move failed.");
  }
}

/* ═══════════════════════════════════════════════════════════════
   End
   ═══════════════════════════════════════════════════════════════ */