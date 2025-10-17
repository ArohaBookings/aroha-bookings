// app/settings/schemas.ts
import { z } from "zod";

/* ───────────────────────────────────────────────────────────────
   Reused primitives + coercers (robust for <form> submissions)
   ─────────────────────────────────────────────────────────────── */

/** Coerce boolean from form-ish values: "on", "true", "1", 1 → true */
export const boolish = z
  .union([z.boolean(), z.string(), z.number()])
  .transform((v) => {
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v !== 0;
    const s = v.trim().toLowerCase();
    return s === "on" || s === "true" || s === "1" || s === "yes";
  });

/** Empty string → undefined (useful for optional text fields) */
export const emptyToUndef = (schema = z.string()) =>
  z.union([schema, z.literal("")]).transform((v) => (v === "" ? undefined : v));

/** Hex color like #ABC or #AABBCC; empty string allowed → undefined */
export const hex = z
  .union([z.string().regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/), z.literal("")])
  .transform((v) => (v === "" ? undefined : v));

/** Money in cents (non-negative) */
export const cents = z.coerce.number().int().min(0);

/** Minutes-from-midnight [0..1440] */
export const minutes = z.coerce.number().int().min(0).max(24 * 60);

/** Time in "HH:MM" 24h or empty → "" */
export const hhmm = z
  .union([z.string().regex(/^\d{2}:\d{2}$/, "Expected HH:MM"), z.literal("")])
  .refine((s) => {
    if (s === "") return true;
    const [h, m] = s.split(":").map(Number);
    return h >= 0 && h <= 23 && m >= 0 && m <= 59;
  }, "Invalid time");

export const idSchema = z.string().min(1);

/* ───────────────────────────────────────────────────────────────
   Organization / Business
   ─────────────────────────────────────────────────────────────── */
export const orgSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1).max(120),
  timezone: z.string().min(2).max(64),
});

export const businessSchema = z.object({
  name: z.string().min(1).max(120),
  timezone: z.string().min(2).max(64).default("Pacific/Auckland"),
  address: emptyToUndef(),
  phone: emptyToUndef(),
  email: emptyToUndef(z.string().email()),
});

/* ───────────────────────────────────────────────────────────────
   Staff & Service  (ALIGNED with server actions)
   ─────────────────────────────────────────────────────────────── */
export const staffSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(80),
  email: emptyToUndef(z.string().email()),
  colorHex: hex.optional(),
  active: boolish.default(true),
  /** IMPORTANT: matches actions.ts which reads `serviceIds` */
  serviceIds: z.array(z.string()).optional().default([]),
});

export const serviceSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(80),
  durationMin: z.coerce.number().int().min(5).max(600),
  priceCents: cents.max(1_000_000),
  colorHex: hex.optional(),
});

/* ───────────────────────────────────────────────────────────────
   Opening Hours (0=Sun..6=Sat)
   ─────────────────────────────────────────────────────────────── */
export const openingHoursRowSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  openMin: minutes,
  closeMin: minutes,
  closed: boolish.optional().default(false),
});

export const openingHoursSchema = z
  .array(openingHoursRowSchema)
  // allow 7+ (some UIs ship partial and we patch later), but still guide for 7
  .min(1, "Provide opening hours rows");

/* ───────────────────────────────────────────────────────────────
   Weekly Roster (per staff → 7 cells with "HH:MM" or empty)
   ─────────────────────────────────────────────────────────────── */
export const rosterCellSchema = z.object({
  start: hhmm,
  end: hhmm,
});

/** Record<staffId, RosterCell[]> — we accept any length and trim/pad to 7 */
export const rosterSchema = z.record(z.string(), z.array(rosterCellSchema));

/* ───────────────────────────────────────────────────────────────
   Booking Rules / Notifications / Online Booking / Calendar
   ─────────────────────────────────────────────────────────────── */
export const bookingRulesSchema = z.object({
  slotMin: z.coerce.number().int().min(5).max(120).default(30),
  minLeadMin: z.coerce.number().int().min(0).max(7 * 24 * 60).default(60),
  maxAdvanceDays: z.coerce.number().int().min(0).max(365).default(60),
  bufferBeforeMin: z.coerce.number().int().min(0).max(240).default(0),
  bufferAfterMin: z.coerce.number().int().min(0).max(240).default(0),
  allowOverlaps: boolish.default(false),
  cancelWindowHours: z.coerce.number().int().min(0).max(14 * 24).default(24),
  noShowFeeCents: cents.optional().default(0),
});

export const notificationsSchema = z.object({
  emailEnabled: boolish.default(true),
  smsEnabled: boolish.default(false),
  customerNewBookingEmail: z.string().min(1),
  customerReminderEmail: z.string().min(1),
  customerCancelEmail: z.string().min(1),
});

export const onlineBookingSchema = z.object({
  enabled: boolish.default(true),
  requireDeposit: boolish.default(false),
  depositCents: cents.optional().default(0),
  autoConfirm: boolish.default(true),
});

export const calendarPrefsSchema = z.object({
  weekStartsOn: z.union([z.literal(0), z.literal(1)]).default(1),
  defaultView: z.union([z.literal("week"), z.literal("day")]).default("week"),
  workingStartMin: minutes.default(9 * 60),
  workingEndMin: minutes.default(17 * 60),
});

/* ───────────────────────────────────────────────────────────────
   Payloads
   ─────────────────────────────────────────────────────────────── */

/** Strict version (everything present) */
export const settingsPayloadStrict = z.object({
  business: businessSchema,
  openingHours: openingHoursSchema,
  services: z.array(serviceSchema),
  staff: z.array(staffSchema),
  roster: rosterSchema,
  bookingRules: bookingRulesSchema,
  notifications: notificationsSchema,
  onlineBooking: onlineBookingSchema,
  calendarPrefs: calendarPrefsSchema,
});

/** Lenient version (sections optional) – better for partial saves */
export const settingsPayloadLenient = z.object({
  business: businessSchema.optional(),
  openingHours: openingHoursSchema.optional(),
  services: z.array(serviceSchema).optional(),
  staff: z.array(staffSchema).optional(),
  roster: rosterSchema.optional(),
  bookingRules: bookingRulesSchema.optional(),
  notifications: notificationsSchema.optional(),
  onlineBooking: onlineBookingSchema.optional(),
  calendarPrefs: calendarPrefsSchema.optional(),
});

export type SettingsPayload = z.infer<typeof settingsPayloadStrict>;
export type SettingsPayloadLenient = z.infer<typeof settingsPayloadLenient>;

/* ───────────────────────────────────────────────────────────────
   Normalizer: make lenient payload safe for actions.ts
   - pads roster rows to 7
   - collapses empty strings to undefined
   - ensures numbers/booleans are coerced
   ─────────────────────────────────────────────────────────────── */
export function normalizeSettingsPayload(raw: unknown) {
  // validate against lenient shape first
  const parsed = settingsPayloadLenient.safeParse(raw);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.flatten() };
  }

  const v = parsed.data;

  // Opening hours: if provided and not 7 rows, fix to 7 using last known state
  const fixedHours =
    v.openingHours &&
    (v.openingHours.length === 7
      ? v.openingHours
      : Array.from({ length: 7 }).map((_, i) => {
          const row = v.openingHours!.find((r) => r.weekday === i);
          return (
            row ?? {
              weekday: i,
              openMin: 9 * 60,
              closeMin: 17 * 60,
              closed: false,
            }
          );
        }));

  // Roster: trim/pad each staff’s cells to 7
  const fixedRoster =
    v.roster &&
    Object.fromEntries(
      Object.entries(v.roster).map(([staffId, cells]) => {
        const seven = Array.from({ length: 7 }).map((_, i) => cells[i] ?? { start: "", end: "" });
        return [staffId, seven];
      })
    );

  // Everything else already coerced by zod
  const result: SettingsPayloadLenient = {
    ...v,
    openingHours: fixedHours ?? v.openingHours,
    roster: fixedRoster ?? v.roster,
  };

  return { ok: true as const, data: result };
}
