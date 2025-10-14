// app/settings/schemas.ts
import { z } from "zod";

/* ───────────────────────────────────────────────────────────────
   Reused primitives
   ─────────────────────────────────────────────────────────────── */
export const idSchema = z.string().min(1);

/* Hex color like #AABBCC (optional on several models) */
const hex = z.string().regex(/^#([0-9A-Fa-f]{6})$/);

/* Money in cents (non-negative) */
const cents = z.coerce.number().int().min(0);

/* Minutes-from-midnight [0..1440] */
const minutes = z.coerce.number().int().min(0).max(24 * 60);

/* Time in "HH:MM" 24h */
const hhmm = z
  .string()
  .regex(/^\d{2}:\d{2}$/, "Expected HH:MM")
  .refine((s) => {
    const [h, m] = s.split(":").map(Number);
    return h >= 0 && h <= 23 && m >= 0 && m <= 59;
  }, "Invalid time");

/* ───────────────────────────────────────────────────────────────
   Organization
   ─────────────────────────────────────────────────────────────── */
export const orgSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(2).max(120),
  timezone: z.string().min(2).max(64),
});

/* ───────────────────────────────────────────────────────────────
   Staff & Service (keeps your existing API)
   ─────────────────────────────────────────────────────────────── */
export const staffSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(2).max(80),
  email: z.string().email().nullable().optional(),
  colorHex: hex.optional().default("#6EE7B7"),
  active: z.boolean().default(true),
  // When saving “all settings” we also accept a list of service IDs:
  services: z.array(z.string()).optional().default([]),
});

export const serviceSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(2).max(80),
  durationMin: z.coerce.number().int().min(5).max(600),
  priceCents: cents.max(1_000_000),
  colorHex: hex.optional().default("#93C5FD"),
});

/* ───────────────────────────────────────────────────────────────
   Opening Hours (per org, 0=Sun..6=Sat)
   ─────────────────────────────────────────────────────────────── */
export const openingHoursRowSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  openMin: minutes,
  closeMin: minutes,
  closed: z.boolean().optional().default(false),
});
export const openingHoursSchema = z
  .array(openingHoursRowSchema)
  .length(7, "Provide exactly 7 rows (Sun..Sat)");

/* ───────────────────────────────────────────────────────────────
   Weekly Roster (per staff → 7 cells with "HH:MM")
   ─────────────────────────────────────────────────────────────── */
export const rosterCellSchema = z.object({
  start: hhmm.or(z.literal("")).default(""),
  end: hhmm.or(z.literal("")).default(""),
});

/** Record<staffId, RosterCell[7]> */
export const rosterSchema = z.record(
  z.string(),
  z.array(rosterCellSchema).length(7)
);

/* ───────────────────────────────────────────────────────────────
   Booking Rules
   ─────────────────────────────────────────────────────────────── */
export const bookingRulesSchema = z.object({
  slotMin: z.coerce.number().int().min(5).max(120).default(30),
  minLeadMin: z.coerce.number().int().min(0).max(7 * 24 * 60).default(60),
  maxAdvanceDays: z.coerce.number().int().min(0).max(365).default(60),
  bufferBeforeMin: z.coerce.number().int().min(0).max(240).default(0),
  bufferAfterMin: z.coerce.number().int().min(0).max(240).default(0),
  allowOverlaps: z.boolean().default(false),
  cancelWindowHours: z.coerce.number().int().min(0).max(14 * 24).default(24),
  noShowFeeCents: cents.optional().default(0),
});

/* ───────────────────────────────────────────────────────────────
   Notifications
   ─────────────────────────────────────────────────────────────── */
export const notificationsSchema = z.object({
  emailEnabled: z.boolean().default(true),
  smsEnabled: z.boolean().default(false),
  customerNewBookingEmail: z.string().min(1),
  customerReminderEmail: z.string().min(1),
  customerCancelEmail: z.string().min(1),
});

/* ───────────────────────────────────────────────────────────────
   Online Booking
   ─────────────────────────────────────────────────────────────── */
export const onlineBookingSchema = z.object({
  enabled: z.boolean().default(true),
  requireDeposit: z.boolean().default(false),
  depositCents: cents.optional().default(0),
  autoConfirm: z.boolean().default(true),
});

/* ───────────────────────────────────────────────────────────────
   Calendar Preferences
   ─────────────────────────────────────────────────────────────── */
export const calendarPrefsSchema = z.object({
  weekStartsOn: z.union([z.literal(0), z.literal(1)]).default(1),
  defaultView: z.union([z.literal("week"), z.literal("day")]).default("week"),
  workingStartMin: minutes.default(9 * 60),
  workingEndMin: minutes.default(17 * 60),
});

/* ───────────────────────────────────────────────────────────────
   Business basics (top section of Settings)
   ─────────────────────────────────────────────────────────────── */
export const businessSchema = z.object({
  name: z.string().min(0).max(120).default(""),
  timezone: z.string().min(2).max(64).default("Pacific/Auckland"),
  address: z.string().optional().default(""),
  phone: z.string().optional().default(""),
  email: z.string().email().optional().default(""),
});

/* ───────────────────────────────────────────────────────────────
   One big payload for “Save all”
   (Matches the UI state you’re building)
   ─────────────────────────────────────────────────────────────── */
export const settingsPayloadSchema = z.object({
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

/* Helpful types if you want them elsewhere */
export type OrgInput = z.infer<typeof orgSchema>;
export type StaffInput = z.infer<typeof staffSchema>;
export type ServiceInput = z.infer<typeof serviceSchema>;
export type OpeningHoursInput = z.infer<typeof openingHoursSchema>;
export type RosterInput = z.infer<typeof rosterSchema>;
export type BookingRulesInput = z.infer<typeof bookingRulesSchema>;
export type NotificationsInput = z.infer<typeof notificationsSchema>;
export type OnlineBookingInput = z.infer<typeof onlineBookingSchema>;
export type CalendarPrefsInput = z.infer<typeof calendarPrefsSchema>;
export type BusinessInput = z.infer<typeof businessSchema>;
export type SettingsPayload = z.infer<typeof settingsPayloadSchema>;
