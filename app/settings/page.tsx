// app/settings/page.tsx
"use client";

import React, { useMemo, useState, useTransition, useRef, useEffect } from "react";
import { loadAllSettings, saveAllSettings } from "./actions";
import { Button } from "@/components/ui";
import { BOOKING_FIELDS, BOOKING_TEMPLATE_OPTIONS, type BookingPageConfig } from "@/lib/booking/templates";



/* ───────────────────────────────────────────────────────────────
   Types (client-side mirror of your server/schema models)
   ─────────────────────────────────────────────────────────────── */

type OpeningHoursRow = {
  weekday: number;   // 0=Sun..6=Sat
  openMin: number;   // minutes from midnight (0-1440)
  closeMin: number;  // minutes from midnight
  closed?: boolean;
};

type Staff = {
  id: string;
  name: string;
  email?: string;
  colorHex: string;     // calendar colour
  active: boolean;
  serviceIds: string[]; // <-- IMPORTANT: matches server/actions
};

type Service = {
  id: string;
  name: string;
  durationMin: number;
  priceCents: number;
  colorHex: string;
};

type RosterCell = {
  start: string; // "09:00"
  end: string;   // "17:00"
};

type Roster = {
  // staffId -> dayIndex(0=Mon..6=Sun) -> RosterCell
  [staffId: string]: RosterCell[];
};

type BookingRules = {
  slotMin: number;             // grid size (e.g. 5/10/15/30)
  minLeadMin: number;          // min lead time (minutes)
  maxAdvanceDays: number;      // how far ahead can book
  bufferBeforeMin: number;     // per-appointment buffer (before)
  bufferAfterMin: number;      // per-appointment buffer (after)
  allowOverlaps: boolean;      // allow overlaps (manual)
  cancelWindowHours: number;   // hours before start to allow cancel
  noShowFeeCents?: number;
};

type Notifications = {
  emailEnabled: boolean;
  smsEnabled: boolean;
  customerNewBookingEmail: string;  // template
  customerReminderEmail: string;    // template
  customerCancelEmail: string;      // template
};

type OnlineBooking = {
  enabled: boolean;
  requireDeposit: boolean;
  depositCents?: number;
  autoConfirm: boolean;
};

type CalendarPrefs = {
  weekStartsOn: 0 | 1;     // 0=Sun, 1=Mon
  defaultView: "week" | "day";
  workingStartMin: number; // default 9*60
  workingEndMin: number;   // default 17*60
};

type Business = {
  name: string;
  timezone: string; // IANA tz
  address?: string;
  phone?: string;
  email?: string;
  niche?: string;
};

type PlanLimits = {
  bookingsPerMonth: number | null;
  staffCount: number | null;
  automations: number | null;
};

type PlanFeatures = Record<string, boolean>;

const DAYS_MON_FIRST = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const NICHE_OPTIONS = [
  { value: "HAIR_BEAUTY", label: "Hair & Beauty" },
  { value: "TRADES", label: "Trades" },
  { value: "DENTAL", label: "Dental" },
  { value: "LAW", label: "Law" },
  { value: "AUTO", label: "Automotive" },
  { value: "MEDICAL", label: "Medical" },
] as const;

const NICHE_PRESETS: Record<string, { bookingRules?: Partial<BookingRules>; calendarPrefs?: Partial<CalendarPrefs> }> = {
  HAIR_BEAUTY: {
    bookingRules: { slotMin: 15, minLeadMin: 30, bufferBeforeMin: 5, bufferAfterMin: 5, maxAdvanceDays: 90 },
    calendarPrefs: { workingStartMin: 9 * 60, workingEndMin: 19 * 60 },
  },
  TRADES: {
    bookingRules: { slotMin: 30, minLeadMin: 120, bufferBeforeMin: 0, bufferAfterMin: 15, maxAdvanceDays: 60 },
    calendarPrefs: { workingStartMin: 7 * 60, workingEndMin: 17 * 60 },
  },
  DENTAL: {
    bookingRules: { slotMin: 30, minLeadMin: 60, bufferBeforeMin: 10, bufferAfterMin: 10, maxAdvanceDays: 120 },
    calendarPrefs: { workingStartMin: 8 * 60, workingEndMin: 17 * 60 },
  },
  LAW: {
    bookingRules: { slotMin: 60, minLeadMin: 120, bufferBeforeMin: 10, bufferAfterMin: 10, maxAdvanceDays: 90 },
    calendarPrefs: { workingStartMin: 9 * 60, workingEndMin: 18 * 60 },
  },
  AUTO: {
    bookingRules: { slotMin: 30, minLeadMin: 60, bufferBeforeMin: 5, bufferAfterMin: 10, maxAdvanceDays: 60 },
    calendarPrefs: { workingStartMin: 8 * 60, workingEndMin: 18 * 60 },
  },
  MEDICAL: {
    bookingRules: { slotMin: 15, minLeadMin: 60, bufferBeforeMin: 5, bufferAfterMin: 5, maxAdvanceDays: 120 },
    calendarPrefs: { workingStartMin: 8 * 60, workingEndMin: 17 * 60 },
  },
};

/* ───────────────────────────────────────────────────────────────
   Small helpers
   ─────────────────────────────────────────────────────────────── */

function uid(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function nzd(cents: number) {
  return new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" })
    .format((cents || 0) / 100);
}

function timeToMin(t: string): number {
  if (!t) return 0;
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function minToTime(min: number): string {
  const h = Math.floor((min || 0) / 60);
  const m = (min || 0) % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function deepClone<T>(x: T): T { return JSON.parse(JSON.stringify(x)); }

function mergeDefaults<T extends Record<string, any>>(target: T, defaults: Partial<T>): T {
  const out = { ...target };
  Object.entries(defaults).forEach(([key, value]) => {
    const current = out[key as keyof T];
    if (current === undefined || current === null) {
      out[key as keyof T] = value as T[keyof T];
    }
  });
  return out;
}

/** shallow sanity checks (client-side) */
function validateBeforeSave(opts: {
  business: Business;
  openingHours: OpeningHoursRow[];
  services: Service[];
  staff: Staff[];
  roster: Roster;
  rules: BookingRules;
}) {
  const errors: string[] = [];

  if (!opts.business.name.trim()) errors.push("Business name is required.");
  if (!opts.business.timezone.trim()) errors.push("Timezone is required.");

  if (opts.openingHours.length !== 7) errors.push("Opening hours must have exactly 7 rows.");
  for (const r of opts.openingHours) {
    if (!r.closed && r.openMin >= r.closeMin) {
      errors.push(`Opening hours invalid for weekday ${r.weekday}: open must be before close.`);
      break;
    }
  }

  const svcNames = new Set<string>();
  for (const s of opts.services) {
    if (!s.name.trim()) errors.push("Service name cannot be empty.");
    if (svcNames.has(s.name.trim().toLowerCase())) {
      errors.push(`Duplicate service name: “${s.name}”.`);
    }
    svcNames.add(s.name.trim().toLowerCase());
    if (s.durationMin <= 0) errors.push(`Service "${s.name}" must have a positive duration.`);
    if (s.priceCents < 0) errors.push(`Service "${s.name}" has negative price.`);
  }

  for (const st of opts.staff) {
    if (!st.name.trim()) errors.push("Staff name cannot be empty.");
    if (!/^#[0-9a-fA-F]{3,6}$/.test(st.colorHex)) {
      errors.push(`Staff "${st.name}" has invalid color.`);
    }
  }

  if (opts.rules.slotMin < 5 || opts.rules.slotMin > 120) {
    errors.push("Calendar grid must be between 5 and 120 minutes.");
  }

  return errors;
}

/** Confirm discard helper */
function useConfirmDiscard(dirty: boolean) {
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);
}

function useToast() {
  const [toast, setToast] = useState<{ message: string; variant: "info" | "success" | "error" } | null>(
    null
  );
  const timerRef = useRef<number | null>(null);

  const show = (message: string, variant: "info" | "success" | "error" = "info") => {
    setToast({ message, variant });
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setToast(null), 2400);
  };

  const node = toast ? (
    <div className="fixed right-6 top-6 z-[80]">
      <div
        className={`rounded-md px-3 py-2 text-xs shadow ${
          toast.variant === "success"
            ? "bg-emerald-600 text-white"
            : toast.variant === "error"
            ? "bg-red-600 text-white"
            : "bg-zinc-900 text-white"
        }`}
      >
        {toast.message}
      </div>
    </div>
  ) : null;

  return { show, node };
}

/* ───────────────────────────────────────────────────────────────
   Main Page
   ─────────────────────────────────────────────────────────────── */

export default function SettingsPage() {
  const toast = useToast();
  /* Business & base org props */
  const [business, setBusiness] = useState<Business>({
    name: "",
    timezone: "Pacific/Auckland",
    address: "",
    phone: "",
    email: "",
    niche: undefined,
  });
  const [orgSlug, setOrgSlug] = useState("");
  const [planName, setPlanName] = useState("PROFESSIONAL");
  const [planLimits, setPlanLimits] = useState<PlanLimits>({
    bookingsPerMonth: null,
    staffCount: null,
    automations: null,
  });
  const [planFeatures, setPlanFeatures] = useState<PlanFeatures>({});
  const [billing, setBilling] = useState<{ managePlanUrl?: string }>({
    managePlanUrl: "",
  });

  /* Opening hours (start closed; user opens the days they want) */
  const [openingHours, setOpeningHours] = useState<OpeningHoursRow[]>(
    Array.from({ length: 7 }, (_, i) => ({
      weekday: i, // 0..6 (Sun..Sat)
      openMin: 9 * 60,
      closeMin: 17 * 60,
      closed: true,
    }))
  );

  /* Services & Staff */
  const [services, setServices] = useState<Service[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [resettingStaffId, setResettingStaffId] = useState<string | null>(null);

  /* Roster (per staff) — UI uses Mon..Sun order */
  const [roster, setRoster] = useState<Roster>({});

  /* Booking Rules */
  const [rules, setRules] = useState<BookingRules>({
    slotMin: 30,
    minLeadMin: 60,
    maxAdvanceDays: 60,
    bufferBeforeMin: 0,
    bufferAfterMin: 0,
    allowOverlaps: false,
    cancelWindowHours: 24,
    noShowFeeCents: 0,
  });

  /* Notifications */
  const [notifications, setNotifications] = useState<Notifications>({
    emailEnabled: true,
    smsEnabled: false,
    customerNewBookingEmail:
      "Kia ora {{name}}, your booking is confirmed for {{datetime}} with {{staff}}. See you soon!",
    customerReminderEmail:
      "Reminder: {{name}}, you have a booking on {{datetime}} with {{staff}}.",
    customerCancelEmail:
      "Kia ora {{name}}, your booking for {{datetime}} has been cancelled.",
  });

  /* Online booking */
  const [online, setOnline] = useState<OnlineBooking>({
    enabled: true,
    requireDeposit: false,
    depositCents: 0,
    autoConfirm: true,
  });

  /* Calendar preferences */
  const [calendarPrefs, setCalendarPrefs] = useState<CalendarPrefs>({
    weekStartsOn: 1,
    defaultView: "week",
    workingStartMin: 9 * 60,
    workingEndMin: 17 * 60,
  });

  function applyNicheTemplate() {
    if (!business.niche) return;
    const preset = NICHE_PRESETS[business.niche];
    if (!preset) return;
    setRules((prev) => mergeDefaults(prev, preset.bookingRules ?? {}));
    setCalendarPrefs((prev) => mergeDefaults(prev, preset.calendarPrefs ?? {}));
    markDirty();
  }

  async function resetAgentProfile(staffId: string) {
    if (!confirm("Reset AI receptionist profile data for this staff member? This cannot be undone.")) return;
    setResettingStaffId(staffId);
    try {
      const res = await fetch("/api/org/staff/agent-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staffId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Reset failed");
      }
      toast.show("AI receptionist profile reset.", "success");
    } catch (e: any) {
      toast.show(e?.message || "Reset failed", "error");
    } finally {
      setResettingStaffId(null);
    }
  }

// --- hydrate Settings from DB on first render ---
const [isLoading, setIsLoading] = useState(true);

useEffect(() => {
  let alive = true;

  (async () => {
    try {
      const data = await loadAllSettings();
      if (!alive) return;

      // Business
      setBusiness({
        name: data.business.name ?? "",
        timezone: data.business.timezone ?? "Pacific/Auckland",
        address: data.business.address ?? "",
        phone: data.business.phone ?? "",
        email: data.business.email ?? "",
        niche: data.business.niche ?? undefined,
      });
      setOrgSlug(data.orgSlug || "");
      setPlanName(data.plan || "PROFESSIONAL");
      setPlanLimits(data.planLimits || { bookingsPerMonth: null, staffCount: null, automations: null });
      setPlanFeatures(data.planFeatures || {});
      setBilling({
        managePlanUrl: data.billing?.managePlanUrl || "",
      });
      setBilling({
        managePlanUrl: data.billing?.managePlanUrl || "",
      });

    
     // Opening hours (ensure all 7 days exist)
      setOpeningHours(
      Array.from({ length: 7 }, (_, i) => {
      const h = data.openingHours.find((x) => x.weekday === i);
      return h
      ? {
          weekday: h.weekday,
          openMin: h.openMin ?? 540,
          closeMin: h.closeMin ?? 1020,
          closed: !!h.closed,
        }
      : {
          weekday: i,
          openMin: 540,
          closeMin: 1020,
          closed: true,
        };
       })
      );

      // Services
      setServices(
        data.services.map((s) => ({
          id: s.id,
          name: s.name,
          durationMin: s.durationMin,
          priceCents: s.priceCents,
          colorHex: s.colorHex ?? "#DBEAFE",
        }))
      );

      // Staff
      setStaff(
        data.staff.map((s) => ({
          id: s.id,
          name: s.name,
          email: s.email ?? undefined,
          active: s.active,
          colorHex: s.colorHex ?? "#10B981",
          serviceIds: Array.isArray(s.serviceIds) ? s.serviceIds : [],
        }))
      );

// Roster: server Sun..Sat -> UI Mon..Sun (keep blanks + allow partial edits)
const rosterMonFirst: Roster = {};
Object.entries(data.roster || {}).forEach(([staffId, week]) => {
  const seven = (week as (RosterCell | undefined)[]) ?? [];

  // Keep whatever the server gives — don't auto-wipe partially typed values
  const norm = (c?: RosterCell): RosterCell => ({
    start: typeof c?.start === "string" ? c.start : "",
    end: typeof c?.end === "string" ? c.end : "",
  });

  // Move Sunday (index 0) to end so UI shows Mon..Sun
  const sun = norm(seven[0]);
  rosterMonFirst[staffId] = [...seven.slice(1).map(norm), sun];
});

setRoster(rosterMonFirst);


      // JSON config bits
      setRules((data.bookingRules as any) ?? {
        slotMin: 30, minLeadMin: 60, maxAdvanceDays: 60,
        bufferBeforeMin: 0, bufferAfterMin: 0, allowOverlaps: false,
        cancelWindowHours: 24, noShowFeeCents: 0,
      });
      setNotifications((data.notifications as any) ?? {
        emailEnabled: true, smsEnabled: false,
        customerNewBookingEmail: "", customerReminderEmail: "", customerCancelEmail: "",
      });
      setOnline((data.onlineBooking as any) ?? {
        enabled: true, requireDeposit: false, depositCents: 0, autoConfirm: true
      });
      setCalendarPrefs((data.calendarPrefs as any) ?? {
        weekStartsOn: 1, defaultView: "week", workingStartMin: 540, workingEndMin: 1020
      });
    } catch (e) {
      console.error("loadAllSettings failed", e);
      setLastError("Failed to load settings.");
    } finally {
      if (alive) setIsLoading(false);
    }
  })();

  return () => { alive = false; };
}, []);


  const [isSaving, startSaving] = useTransition();
  const [dirtyCount, setDirtyCount] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastSuccess, setLastSuccess] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);


  const dirty = dirtyCount > 0;
  useConfirmDiscard(dirty);

  // bump dirty on any state change (coarse; simple & effective)
  const markDirty = () => setDirtyCount((n) => n + 1);

  /* Aggregate payload (rotate roster & normalize staff.serviceIds) */
  function buildPayload() {
   // Normalize roster for server: UI is Mon..Sun (0..6), server expects Sun..Sat.
// Convert blank cells ("", "") to `undefined` so the server treats them as "no shift".
const rosterSunFirst: Record<string, (RosterCell | undefined)[]> = {};
for (const [sid, cells] of Object.entries(roster)) {
  const sevenRaw = Array.from({ length: 7 }, (_, i) => cells[i] ?? { start: "", end: "" });
  const sevenClean = sevenRaw.map((c) => (c.start && c.end ? c : undefined));
  const sun = sevenClean[6]; // Sunday from UI index 6 -> move to front
  rosterSunFirst[sid] = [sun, ...sevenClean.slice(0, 6)];
}

    return {
      business,
      openingHours,
      services,
      staff: staff.map((s) => ({
        ...s,
        serviceIds: Array.isArray(s.serviceIds) ? s.serviceIds : [],
      })),
      roster: rosterSunFirst as any, // server expects undefined for no-shift
      bookingRules: rules,
      notifications,
      onlineBooking: online,
      calendarPrefs,
      billing,
    };
  }

  function exportJSON() {
    const blob = new Blob([JSON.stringify(buildPayload(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `settings-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function importJSON(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(String(reader.result || "{}"));
        // very light shape guarding
        if (obj.business) setBusiness(obj.business);
        if (Array.isArray(obj.openingHours)) setOpeningHours(obj.openingHours);
        if (Array.isArray(obj.services)) setServices(obj.services);
        if (Array.isArray(obj.staff)) setStaff(obj.staff);
        if (obj.roster && typeof obj.roster === "object") {
  const r: Roster = {};
  const norm = (c?: RosterCell): RosterCell =>
    c && c.start && c.end ? c : { start: "", end: "" };
  Object.entries(obj.roster).forEach(([sid, week]) => {
    const seven = (week as (RosterCell | undefined)[]) ?? [];
    r[sid] = Array.from({ length: 7 }, (_, i) => norm(seven[i]));
  });
  setRoster(r);
}
        if (obj.bookingRules) setRules(obj.bookingRules);
        if (obj.notifications) setNotifications(obj.notifications);
        if (obj.onlineBooking) setOnline(obj.onlineBooking);
        if (obj.calendarPrefs) setCalendarPrefs(obj.calendarPrefs);
        if (obj.billing) setBilling(obj.billing);
        setLastSuccess("Imported JSON settings.");
        markDirty();
      } catch (e: any) {
        setLastError(`Failed to import: ${e?.message || "Invalid JSON"}`);
      }
    };
    reader.readAsText(file);
  }

  const activeStaff = useMemo(() => staff.filter((s) => s.active), [staff]);
  const staffLimitReached =
    planLimits.staffCount !== null && activeStaff.length >= planLimits.staffCount;
  const displayPlanName =
    planFeatures.calls === false ? "Aroha Bookings (No AI receptionist)" : planName;

  return (
    <div className="p-6 space-y-10 text-black">
      {toast.node}
      {/* Header */}
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-zinc-800">
            Configure your business, hours, staff, roster, services, booking rules, notifications,
            online bookings and calendar preferences.
          </p>
        </div>

        <div className="flex gap-2 items-center">
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importJSON(f);
              if (fileRef.current) fileRef.current.value = "";
            }}
          />
          <Button variant="secondary" onClick={exportJSON}>
            Export JSON
          </Button>
          <Button variant="secondary" onClick={() => fileRef.current?.click()}>
            Import JSON
          </Button>
          <Button
            variant="primary"
            disabled={isSaving}
            onClick={() => {
  setLastError(null);
  setLastSuccess(null);

  const payload = buildPayload();
  const errs = validateBeforeSave({ business, openingHours, services, staff, roster, rules });
  if (errs.length) {
    setLastError(errs.join("\n"));
    return;
  }

  startSaving(async () => {
    const res = await saveAllSettings(payload as any);
    if (!res.ok) {
      setLastError(res.error || "Failed to save settings");
      return;
    }

    // 🔁 Reload canonical data so temp IDs are replaced with real DB IDs
    try {
      const data = await loadAllSettings();

      // Business
      setBusiness({
        name: data.business.name ?? "",
        timezone: data.business.timezone ?? "Pacific/Auckland",
        address: data.business.address ?? "",
        phone: data.business.phone ?? "",
        email: data.business.email ?? "",
        niche: data.business.niche ?? undefined,
      });
      setOrgSlug(data.orgSlug || "");
      setPlanName(data.plan || "PROFESSIONAL");
      setPlanLimits(data.planLimits || { bookingsPerMonth: null, staffCount: null, automations: null });
      setPlanFeatures(data.planFeatures || {});

      // Opening hours (0..6 Sun..Sat)
      setOpeningHours(
        Array.from({ length: 7 }, (_, i) => {
          const h = data.openingHours.find((x) => x.weekday === i);
          return h
            ? { weekday: h.weekday, openMin: h.openMin ?? 540, closeMin: h.closeMin ?? 1020, closed: !!h.closed }
            : { weekday: i, openMin: 540, closeMin: 1020, closed: true };
        })
      );

      // Services
      setServices(
        data.services.map((s) => ({
          id: s.id,
          name: s.name,
          durationMin: s.durationMin,
          priceCents: s.priceCents,
          colorHex: s.colorHex ?? "#DBEAFE",
        }))
      );

      // Staff
      setStaff(
        data.staff.map((s) => ({
          id: s.id,
          name: s.name,
          email: s.email ?? undefined,
          active: s.active,
          colorHex: s.colorHex ?? "#10B981",
          serviceIds: Array.isArray(s.serviceIds) ? s.serviceIds : [],
        }))
      );

// Roster: server Sun..Sat -> UI Mon..Sun (keep partials)
const rosterMonFirst: Roster = {};
Object.entries(data.roster || {}).forEach(([staffId, week]) => {
  const seven = (week as (RosterCell | undefined)[]) ?? [];
  const norm = (c?: RosterCell): RosterCell => ({
    start: typeof c?.start === "string" ? c.start : "",
    end:  typeof c?.end   === "string" ? c.end   : "",
  });
  const sun = norm(seven[0]); // server Sunday
  rosterMonFirst[staffId] = [...seven.slice(1).map(norm), sun];
});
setRoster(rosterMonFirst);

      setRules((data.bookingRules as any) ?? rules);
      setNotifications((data.notifications as any) ?? notifications);
      setOnline((data.onlineBooking as any) ?? online);
      setCalendarPrefs((data.calendarPrefs as any) ?? calendarPrefs);

      setLastSuccess("Settings saved ✅");
      setDirtyCount(0);
    } catch (e) {
      console.error("reload after save failed", e);
      setLastError("Saved, but failed to reload fresh data.");
    }
  });
}}
          >
            {isSaving ? "Saving…" : (dirty ? "Save changes *" : "Save changes")}
          </Button>
        </div>
      </header>

      {/* surface any last result */}
      {(lastError || lastSuccess) && (
        <div
          className={`rounded-md border px-4 py-3 text-sm ${
            lastError
              ? "border-red-300 bg-red-50 text-red-800 whitespace-pre-wrap"
              : "border-emerald-300 bg-emerald-50 text-emerald-800"
          }`}
        >
          {lastError || lastSuccess}
        </div>
      )}

      <OnboardingResumeCard />
      <BrandingCard />
      <EmailIdentityCard />

      {/* Business */}
      <BusinessCard
        business={business}
        onChange={(b) => { setBusiness(b); markDirty(); }}
      />

      <PlanCard
        planName={displayPlanName}
        planLimits={planLimits}
        planFeatures={planFeatures}
        staffCount={activeStaff.length}
        managePlanUrl={billing.managePlanUrl || "https://arohacalls.com"}
      />

      <BillingCard
        billing={billing}
        onChange={(next) => {
          setBilling(next);
          markDirty();
        }}
      />

      <NicheTemplateCard
        business={business}
        onChange={(b) => { setBusiness(b); markDirty(); }}
        onApply={applyNicheTemplate}
      />

      {/* Opening Hours */}
      <OpeningHoursCard
        hours={openingHours}
        onChange={(next) => { setOpeningHours(next); markDirty(); }}
      />

      {/* Staff */}
      <StaffCard
        staff={staff}
        services={services}
        planLimit={planLimits.staffCount}
        limitReached={staffLimitReached}
        planFeatures={planFeatures}
        onResetAgent={resetAgentProfile}
        resettingId={resettingStaffId}
        onAdd={(s) => {
          setStaff((prev) => [...prev, s]);
          setRoster((prev) => {
            if (prev[s.id]) return prev;
            return {
              ...prev,
              [s.id]: Array.from({ length: 7 }, () => ({ start: "", end: "" })), // Mon..Sun
            };
          });
          markDirty();
        }}
        onUpdate={(id, patch) => {
          setStaff((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
          markDirty();
        }}
        onDelete={(id) => {
          setStaff((prev) => prev.filter((s) => s.id !== id));
          setRoster((prev) => {
            const { [id]: _drop, ...rest } = prev;
            return rest;
          });
          markDirty();
        }}
      />

    {/* Weekly Roster */}
<RosterCard
  staff={staff}
  roster={roster}
  onChangeCell={(staffId, dayIdx, cell) => {
    setRoster((prev) => {
      const norm = (c?: RosterCell): RosterCell => ({
        start: typeof c?.start === "string" ? c.start : "",
        end:   typeof c?.end   === "string" ? c.end   : "",
      });

      // Build the current row for this staff member (Mon..Sun)
      const existing = prev[staffId] ?? [];
      const row: RosterCell[] = Array.from({ length: 7 }, (_, i) =>
        norm(existing[i])
      );

      // Update the edited cell
      const copy = [...row];
      copy[dayIdx] = norm(cell);

      // Write back
      return { ...prev, [staffId]: copy };
    });
    markDirty();
  }}
/>

      {/* Services */}
      <ServicesCard
        services={services}
        onAdd={(svc) => { setServices((prev) => [...prev, svc]); markDirty(); }}
        onUpdate={(id, patch) => {
          setServices((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
          markDirty();
        }}
        onDelete={(id) => {
          setServices((prev) => prev.filter((s) => s.id !== id));
          // also strip from staff
          setStaff((prev) =>
            prev.map((st) => ({ ...st, serviceIds: st.serviceIds.filter((sid) => sid !== id) }))
          );
          markDirty();
        }}
      />

      {/* Booking rules */}
      <BookingRulesCard rules={rules} onChange={(r) => { setRules(r); markDirty(); }} />

      {/* Notifications */}
      <NotificationsCard notif={notifications} onChange={(n) => { setNotifications(n); markDirty(); }} />

      {/* Online booking */}
      <OnlineBookingCard
        online={online}
        rules={rules}
        orgSlug={orgSlug}
        onChange={(o) => { setOnline(o); markDirty(); }}
        onRulesChange={(next) => { setRules(next); markDirty(); }}
      />

      <BookingPageCard orgSlug={orgSlug} />

      {/* Calendar preferences */}
      <CalendarPrefsCard prefs={calendarPrefs} onChange={(c) => { setCalendarPrefs(c); markDirty(); }} />

      <DataExportCard />

      {/* Sticky Save (mobile) */}
      <div className="sm:hidden fixed bottom-4 right-4">
        <button
          className="rounded-full bg-black text-white px-5 py-3 text-sm shadow-lg"
          onClick={() => {
            const payload = buildPayload();
            console.log("Settings payload:", payload);
            alert("Settings ready to save — press the main Save button to persist.");
          }}
        >
          Save changes
        </button>
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────
   Business
   ─────────────────────────────────────────────────────────────── */
function BusinessCard({
  business,
  onChange,
}: {
  business: Business;
  onChange: (b: Business) => void;
}) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="px-5 py-3 border-b border-zinc-200 font-semibold">Business</div>
      <div className="p-5 grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1">
          <span className="text-xs text-zinc-700">Business name</span>
          <input
            className="h-10 rounded-md border border-zinc-300 px-3 outline-none focus:ring-2 focus:ring-black/10"
            value={business.name}
            onChange={(e) => onChange({ ...business, name: e.target.value })}
            placeholder="Your business name"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-zinc-700">Timezone</span>
          <input
            className="h-10 rounded-md border border-zinc-300 px-3 outline-none focus:ring-2 focus:ring-black/10"
            value={business.timezone}
            onChange={(e) => onChange({ ...business, timezone: e.target.value })}
            placeholder="Pacific/Auckland"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-zinc-700">Address</span>
          <input
            className="h-10 rounded-md border border-zinc-300 px-3 outline-none focus:ring-2 focus:ring-black/10"
            value={business.address ?? ""}
            onChange={(e) => onChange({ ...business, address: e.target.value })}
            placeholder="Street, City, Postcode"
          />
        </label>
        <div className="grid grid-cols-2 gap-4">
          <label className="grid gap-1">
            <span className="text-xs text-zinc-700">Phone</span>
            <input
              className="h-10 rounded-md border border-zinc-300 px-3 outline-none focus:ring-2 focus:ring-black/10"
              value={business.phone ?? ""}
              onChange={(e) => onChange({ ...business, phone: e.target.value })}
              placeholder="+64 ..."
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs text-zinc-700">Email</span>
            <input
              className="h-10 rounded-md border border-zinc-300 px-3 outline-none focus:ring-2 focus:ring-black/10"
              value={business.email ?? ""}
              onChange={(e) => onChange({ ...business, email: e.target.value })}
              placeholder="hello@example.com"
            />
          </label>
        </div>
      </div>
    </section>
  );
}

function PlanCard({
  planName,
  planLimits,
  planFeatures,
  staffCount,
  managePlanUrl,
}: {
  planName: string;
  planLimits: PlanLimits;
  planFeatures: PlanFeatures;
  staffCount: number;
  managePlanUrl: string;
}) {
  const featureList = [
    { key: "booking", label: "Online booking", benefit: "Let clients book themselves 24/7." },
    { key: "clientSelfService", label: "Client self-service", benefit: "Reschedule/cancel without staff calls." },
    { key: "googleSync", label: "Google Calendar sync", benefit: "Keep external calendars in lockstep." },
    { key: "automations", label: "Automations", benefit: "Reduce no-shows with smart rules." },
    { key: "emailAI", label: "Email AI", benefit: "Auto-replies with confidence controls." },
    { key: "calls", label: "AI receptionist", benefit: "Automated voice receptionist for inbound calls." },
    { key: "staffPortal", label: "Staff portal", benefit: "Self-serve schedules for staff." },
    { key: "analytics", label: "Analytics dashboards", benefit: "Insights across bookings and ops." },
  ];

  const locked = featureList.filter((f) => planFeatures[f.key] === false);

  return (
    <section className="rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="px-5 py-3 border-b border-zinc-200 font-semibold">Plan & limits</div>
      <div className="p-5 grid gap-4 md:grid-cols-[1.2fr_1fr]">
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
          <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Current plan</div>
          <div className="mt-2 text-lg font-semibold text-zinc-900">{planName}</div>
          <div className="mt-3 grid gap-2 text-xs text-zinc-600">
            <div>
              Bookings/month:{" "}
              <span className="font-medium text-zinc-800">
                {planLimits.bookingsPerMonth ?? "Unlimited"}
              </span>
            </div>
            <div>
              Staff limit:{" "}
              <span className="font-medium text-zinc-800">
                {planLimits.staffCount ?? "Unlimited"} ({staffCount} active)
              </span>
            </div>
            <div>
              Automations:{" "}
              <span className="font-medium text-zinc-800">
                {planLimits.automations ?? "Unlimited"}
              </span>
            </div>
          </div>
          <p className="mt-3 text-xs text-zinc-500">
            Limits are soft; exceeded usage is highlighted so you can upgrade at the right time.
          </p>
          <a
            href={managePlanUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 shadow-sm hover:border-emerald-200 hover:bg-emerald-50"
          >
            Manage plan
          </a>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Locked features</div>
          <div className="mt-3 space-y-2 text-xs text-zinc-600">
            {locked.length === 0 && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-700">
                All features are unlocked on this plan.
              </div>
            )}
            {locked.map((f) => (
              <div key={f.key} className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
                <div className="font-medium text-zinc-800">{f.label}</div>
                <div className="text-zinc-500">{f.benefit}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function BillingCard({
  billing,
  onChange,
}: {
  billing: { managePlanUrl?: string };
  onChange: (next: { managePlanUrl?: string }) => void;
}) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="px-5 py-3 border-b border-zinc-200 font-semibold">Billing</div>
      <div className="p-5 grid gap-3 sm:grid-cols-[1fr_auto] items-end">
        <label className="grid gap-1 text-sm">
          <span className="text-xs text-zinc-700">Manage plan URL</span>
          <input
            className="h-10 rounded-md border border-zinc-300 px-3 outline-none focus:ring-2 focus:ring-black/10"
            value={billing.managePlanUrl || ""}
            onChange={(e) => onChange({ ...billing, managePlanUrl: e.target.value })}
            placeholder="https://arohacalls.com"
          />
        </label>
        <a
          href={billing.managePlanUrl || "https://arohacalls.com"}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-200 bg-white px-4 text-xs font-semibold text-zinc-700 shadow-sm hover:border-emerald-200 hover:bg-emerald-50"
        >
          Open manage plan
        </a>
      </div>
    </section>
  );
}

function NicheTemplateCard({
  business,
  onChange,
  onApply,
}: {
  business: Business;
  onChange: (b: Business) => void;
  onApply: () => void;
}) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="px-5 py-3 border-b border-zinc-200 font-semibold">Business type</div>
      <div className="p-5 grid gap-4 md:grid-cols-[1fr_auto] items-end">
        <label className="grid gap-1 text-sm">
          <span className="text-xs text-zinc-700">Niche / Industry</span>
          <select
            value={business.niche ?? ""}
            onChange={(e) => onChange({ ...business, niche: e.target.value || undefined })}
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
          >
            <option value="">Select business type</option>
            {NICHE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-zinc-500">
            Apply a template to set sensible defaults without overwriting your custom settings.
          </p>
        </label>
        <button
          type="button"
          onClick={onApply}
          disabled={!business.niche}
          className="h-10 rounded-lg border border-zinc-300 px-4 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Apply template
        </button>
      </div>
    </section>
  );
}

function DataExportCard() {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="px-5 py-3 border-b border-zinc-200 font-semibold">Data export</div>
      <div className="p-5 grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm">
          <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Appointments</div>
          <p className="mt-2 text-xs text-zinc-500">
            Download a CSV of all appointments for your organisation.
          </p>
          <Button
            variant="secondary"
            onClick={() => window.location.assign("/api/org/export/appointments")}
            className="mt-3"
          >
            Export appointments
          </Button>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm">
          <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Calls</div>
          <p className="mt-2 text-xs text-zinc-500">
            Download a CSV of call logs, transcripts, and outcomes.
          </p>
          <Button
            variant="secondary"
            onClick={() => window.location.assign("/api/org/export/calls")}
            className="mt-3"
          >
            Export calls
          </Button>
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────────────────────────────────────────────
   Opening Hours
   ─────────────────────────────────────────────────────────────── */
function OpeningHoursCard({
  hours,
  onChange,
}: {
  hours: OpeningHoursRow[];
  onChange: (rows: OpeningHoursRow[]) => void;
}) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="px-5 py-3 border-b border-zinc-200 font-semibold">Opening hours</div>
      <div className="p-5 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-zinc-50 text-black">
            <tr>
              <th className="text-left px-4 py-2 font-medium w-40">Day</th>
              <th className="text-left px-4 py-2 font-medium">Open</th>
              <th className="text-left px-4 py-2 font-medium">Close</th>
              <th className="text-left px-4 py-2 font-medium">Closed</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 7 }, (_, idx) => {
              const row = hours.find((h) => h.weekday === idx)!;
              const label = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][idx];
              return (
                <tr key={idx} className="border-t border-zinc-200">
                  <td className="px-4 py-2">{label}</td>
                  <td className="px-4 py-2">
                    <input
                      type="time"
                      disabled={row.closed}
                      className="h-9 w-28 rounded-md border border-zinc-300 px-2 outline-none focus:ring-2 focus:ring-black/10"
                      value={minToTime(row.openMin)}
                      onChange={(e) =>
                        onChange(
                          hours.map((h) =>
                            h.weekday === idx ? { ...h, openMin: timeToMin(e.target.value) } : h
                          )
                        )
                      }
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="time"
                      disabled={row.closed}
                      className="h-9 w-28 rounded-md border border-zinc-300 px-2 outline-none focus:ring-2 focus:ring-black/10"
                      value={minToTime(row.closeMin)}
                      onChange={(e) =>
                        onChange(
                          hours.map((h) =>
                            h.weekday === idx ? { ...h, closeMin: timeToMin(e.target.value) } : h
                          )
                        )
                      }
                    />
                  </td>
                  <td className="px-4 py-2">
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={!!row.closed}
                        onChange={(e) =>
                          onChange(
                            hours.map((h) =>
                              h.weekday === idx ? { ...h, closed: e.target.checked } : h
                            )
                          )
                        }
                      />
                      <span className="text-black">Closed</span>
                    </label>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ───────────────────────────────────────────────────────────────
   Staff (with service linking)
   ─────────────────────────────────────────────────────────────── */
function StaffCard({
  staff,
  services,
  onAdd,
  onUpdate,
  onDelete,
  onResetAgent,
  resettingId,
  planLimit,
  limitReached,
  planFeatures,
}: {
  staff: Staff[];
  services: Service[];
  onAdd: (s: Staff) => void;
  onUpdate: (id: string, patch: Partial<Staff>) => void;
  onDelete: (id: string) => void;
  onResetAgent: (id: string) => void;
  resettingId: string | null;
  planLimit: number | null;
  limitReached: boolean;
  planFeatures: PlanFeatures;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [colorHex, setColorHex] = useState("#10B981");

  return (
    <section className="rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="px-5 py-3 border-b border-zinc-200 font-semibold flex items-center justify-between">
        <span>Staff</span>
        {planLimit !== null ? (
          <span className="text-xs font-medium text-zinc-500">
            {staff.length} / {planLimit} staff
          </span>
        ) : null}
      </div>

      <div className="p-5">
        {!planFeatures.staffPortal && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Staff portal is locked on your current plan. Upgrade to unlock staff self-serve tools.
          </div>
        )}
        {limitReached && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            You are at your staff limit. You can still add staff, but advanced scheduling features may
            be capped until you upgrade.
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-zinc-50 text-black">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Name</th>
                <th className="text-left px-4 py-2 font-medium">Email</th>
                <th className="text-left px-4 py-2 font-medium">Colour</th>
                <th className="text-left px-4 py-2 font-medium">Active</th>
                <th className="text-left px-4 py-2 font-medium">Services</th>
                <th className="text-right px-4 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.id} className="border-t border-zinc-200">
                  <td className="px-4 py-2">
                    <input
                      className="h-9 w-full rounded-md border border-zinc-300 px-3 outline-none focus:ring-2 focus:ring-black/10"
                      value={s.name}
                      onChange={(e) => onUpdate(s.id, { name: e.target.value })}
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      className="h-9 w-full rounded-md border border-zinc-300 px-3 outline-none focus:ring-2 focus:ring-black/10"
                      value={s.email ?? ""}
                      onChange={(e) => onUpdate(s.id, { email: e.target.value })}
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="color"
                      className="h-9 w-12 rounded-md border border-zinc-300"
                      value={s.colorHex}
                      onChange={(e) => onUpdate(s.id, { colorHex: e.target.value })}
                      aria-label="Staff color"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={s.active}
                        onChange={(e) => onUpdate(s.id, { active: e.target.checked })}
                      />
                      <span className="text-black">Active</span>
                    </label>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap gap-2">
                      {services.map((svc) => {
                        const checked = s.serviceIds.includes(svc.id);
                        return (
                          <label
                            key={svc.id}
                            className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 cursor-pointer ${
                              checked
                                ? "border-black bg-black text-white"
                                : "border-zinc-300 text-black hover:border-zinc-400"
                            }`}
                          >
                            <input
                              type="checkbox"
                              className="hidden"
                              checked={checked}
                              onChange={(e) => {
                                const next = new Set(s.serviceIds);
                                if (e.target.checked) next.add(svc.id);
                                else next.delete(svc.id);
                                onUpdate(s.id, { serviceIds: Array.from(next) });
                              }}
                            />
                            {svc.name}
                          </label>
                        );
                      })}
                      {services.length === 0 && (
                        <span className="text-xs text-zinc-600">Add services below to link.</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex flex-col items-end gap-2">
                      <button
                        className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs hover:bg-zinc-50"
                        onClick={() => onResetAgent(s.id)}
                        disabled={resettingId === s.id}
                      >
                        {resettingId === s.id ? "Resetting..." : "Reset AI profile"}
                      </button>
                      <button
                        className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50"
                        onClick={() => onDelete(s.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {staff.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-zinc-700" colSpan={6}>
                    No staff yet — add your first staff member below.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Add staff */}
        <div className="mt-6 grid gap-4 sm:grid-cols-4">
          <input
            className="h-10 rounded-md border border-zinc-300 px-3 outline-none focus:ring-2 focus:ring-black/10"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="h-10 rounded-md border border-zinc-300 px-3 outline-none focus:ring-2 focus:ring-black/10"
            placeholder="Email (optional)"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <label className="grid gap-1">
            <span className="text-xs text-zinc-600">Colour</span>
            <input
              type="color"
              className="h-10 w-16 rounded-md border border-zinc-300"
              value={colorHex}
              onChange={(e) => setColorHex(e.target.value)}
            />
          </label>
          <div className="flex items-end justify-end">
            <button
              className="h-10 rounded-md bg-black px-4 text-white text-sm hover:bg-gray-900"
              onClick={() => {
                if (!name.trim()) return;
                onAdd({
                  id: uid("stf"),
                  name: name.trim(),
                  email: email.trim() || undefined,
                  colorHex,
                  active: true,
                  serviceIds: [],
                });
                setName("");
                setEmail("");
                setColorHex("#10B981");
              }}
            >
              Add staff
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────────────────────────────────────────────
   Roster (UI Mon..Sun) – with per-cell drafts to avoid reset
   ─────────────────────────────────────────────────────────────── */
function RosterCard({
  staff,
  roster,
  onChangeCell,
}: {
  staff: Staff[];
  roster: Roster;
  onChangeCell: (staffId: string, dayIdx: number, cell: RosterCell) => void;
}) {
  // Keep local draft values so typing (partial/AM-PM) doesn't get blown away
  const [draft, setDraft] = React.useState<Record<string, string>>({});

  // helpers to read/write drafts for a field
  const keyFor = (staffId: string, dayIdx: number, field: "start" | "end") =>
    `${staffId}:${dayIdx}:${field}`;

  const getVal = (staffId: string, dayIdx: number, field: "start" | "end", actual: string) => {
    const k = keyFor(staffId, dayIdx, field);
    return draft[k] ?? actual; // prefer draft while editing
  };

  const setVal = (
    staffId: string,
    dayIdx: number,
    field: "start" | "end",
    value: string,
  ) => {
    const k = keyFor(staffId, dayIdx, field);
    setDraft((d) => ({ ...d, [k]: value }));
  };

  const commit = (staffId: string, dayIdx: number, field: "start" | "end") => {
    const row = roster[staffId] ?? Array.from({ length: 7 }, () => ({ start: "", end: "" }));
    const cell = row[dayIdx] ?? { start: "", end: "" };

    const k = keyFor(staffId, dayIdx, field);
    const nextValue = draft[k] ?? cell[field];

    // write to parent state
    onChangeCell(staffId, dayIdx, { ...cell, [field]: nextValue });

    // clear the draft for this field
    setDraft((d) => {
      const { [k]: _drop, ...rest } = d;
      return rest;
    });
  };

  return (
    <section className="rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="px-5 py-3 border-b border-zinc-200 font-semibold">Weekly roster</div>
      <div className="p-5 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-zinc-50 text-black">
            <tr>
              <th className="text-left px-4 py-2 font-medium w-48">Staff</th>
              {DAYS_MON_FIRST.map((d) => (
                <th key={d} className="text-left px-4 py-2 font-medium">
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => {
              const row =
                roster[s.id] ?? Array.from({ length: 7 }, () => ({ start: "", end: "" })); // Mon..Sun
              return (
                <tr key={s.id} className="border-t border-zinc-200">
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block h-3 w-3 rounded-full"
                        style={{ backgroundColor: s.colorHex }}
                        aria-hidden
                      />
                      <span className="font-medium">{s.name}</span>
                      {!s.active && <span className="text-xs text-zinc-700">(inactive)</span>}
                    </div>
                  </td>

                  {row.map((cell, i) => (
                    <td key={`${s.id}-${i}`} className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        {/* START time */}
                        <input
                          type="time"
                          step={60} // minutes
                          className="h-9 w-28 rounded-md border border-zinc-300 px-2 outline-none focus:ring-2 focus:ring-black/10"
                          value={getVal(s.id, i, "start", cell.start)}
                          onChange={(e) => setVal(s.id, i, "start", e.currentTarget.value)}
                          onBlur={() => commit(s.id, i, "start")}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commit(s.id, i, "start");
                          }}
                        />
                        <span className="text-zinc-500">–</span>

                        {/* END time */}
                        <input
                          type="time"
                          step={60}
                          className="h-9 w-28 rounded-md border border-zinc-300 px-2 outline-none focus:ring-2 focus:ring-black/10"
                          value={getVal(s.id, i, "end", cell.end)}
                          onChange={(e) => setVal(s.id, i, "end", e.currentTarget.value)}
                          onBlur={() => commit(s.id, i, "end")}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commit(s.id, i, "end");
                          }}
                        />
                      </div>
                    </td>
                  ))}
                </tr>
              );
            })}
            {staff.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-zinc-700" colSpan={8}>
                  No staff yet — add staff above to set roster.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="px-5 pb-5">
        <button
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50"
          onClick={() => alert("Soon: auto-fill from opening hours.")}
        >
          Auto-fill from opening hours (soon)
        </button>
      </div>
    </section>
  );
}

/* ───────────────────────────────────────────────────────────────
   Services
   ─────────────────────────────────────────────────────────────── */
function ServicesCard({
  services,
  onAdd,
  onUpdate,
  onDelete,
}: {
  services: Service[];
  onAdd: (svc: Service) => void;
  onUpdate: (id: string, patch: Partial<Service>) => void;
  onDelete: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [durationMin, setDurationMin] = useState<number>(45);
  const [price, setPrice] = useState<number>(0);
  const [colorHex, setColorHex] = useState("#DBEAFE");

  return (
    <section className="rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="px-5 py-3 border-b border-zinc-200 font-semibold">Services</div>

      <div className="p-5">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-zinc-50 text-black">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Service</th>
                <th className="text-left px-4 py-2 font-medium">Duration</th>
                <th className="text-left px-4 py-2 font-medium">Price</th>
                <th className="text-left px-4 py-2 font-medium">Colour</th>
                <th className="text-right px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {services.map((s) => (
                <tr key={s.id} className="border-t border-zinc-200">
                  <td className="px-4 py-2">
                    <input
                      className="h-9 w-full rounded-md border border-zinc-300 px-3 outline-none focus:ring-2 focus:ring-black/10"
                      value={s.name}
                      onChange={(e) => onUpdate(s.id, { name: e.target.value })}
                    />
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={5}
                        step={5}
                        className="h-9 w-28 rounded-md border border-zinc-300 px-3 outline-none focus:ring-2 focus:ring-black/10"
                        value={s.durationMin}
                        onChange={(e) => onUpdate(s.id, { durationMin: Number(e.target.value || 0) })}
                      />
                      <span className="text-zinc-700">min</span>
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className="h-9 w-32 rounded-md border border-zinc-300 px-3 outline-none focus:ring-2 focus:ring-black/10"
                      value={s.priceCents / 100}
                      onChange={(e) =>
                        onUpdate(s.id, { priceCents: Math.round(Number(e.target.value || 0) * 100) })
                      }
                    />
                    <div className="text-xs text-zinc-500 mt-1">{nzd(s.priceCents)}</div>
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="color"
                      className="h-9 w-12 rounded-md border border-zinc-300"
                      value={s.colorHex}
                      onChange={(e) => onUpdate(s.id, { colorHex: e.target.value })}
                    />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50"
                      onClick={() => onDelete(s.id)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {services.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-zinc-700" colSpan={5}>
                    No services yet — add your first service below.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Add service */}
        <div className="mt-6 grid gap-4 sm:grid-cols-5">
          <input
            className="h-10 rounded-md border border-zinc-300 px-3 outline-none focus:ring-2 focus:ring-black/10"
            placeholder="Service name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            type="number"
            min={5}
            step={5}
            className="h-10 rounded-md border border-zinc-300 px-3 outline-none focus:ring-2 focus:ring-black/10"
            placeholder="Duration (min)"
            value={durationMin}
            onChange={(e) => setDurationMin(Number(e.target.value || 0))}
          />
          <input
            type="number"
            min={0}
            step="0.01"
            className="h-10 rounded-md border border-zinc-300 px-3 outline-none focus:ring-2 focus:ring-black/10"
            placeholder="Price (NZD)"
            value={price}
            onChange={(e) => setPrice(Number(e.target.value || 0))}
          />
          <label className="grid gap-1">
            <span className="text-xs text-zinc-600">Colour</span>
            <input
              type="color"
              className="h-10 w-16 rounded-md border border-zinc-300"
              value={colorHex}
              onChange={(e) => setColorHex(e.target.value)}
            />
          </label>
          <div className="flex items-end justify-end">
            <button
              className="h-10 rounded-md bg-black px-4 text-white text-sm hover:bg-gray-900"
              onClick={() => {
                if (!name.trim()) return;
                onAdd({
                  id: uid("svc"),
                  name: name.trim(),
                  durationMin,
                  priceCents: Math.round(price * 100),
                  colorHex,
                });
                setName("");
                setDurationMin(45);
                setPrice(0);
                setColorHex("#DBEAFE");
              }}
            >
              Add service
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────────────────────────────────────────────
   Booking Rules
   ─────────────────────────────────────────────────────────────── */
function BookingRulesCard({
  rules,
  onChange,
}: {
  rules: BookingRules;
  onChange: (r: BookingRules) => void;
}) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="px-5 py-3 border-b border-zinc-200 font-semibold">Booking rules</div>
      <div className="p-5 grid gap-4 sm:grid-cols-3">
        <NumberField
          label="Calendar grid (min)"
          value={rules.slotMin}
          min={5}
          step={5}
          onChange={(v) => onChange({ ...rules, slotMin: v })}
        />
        <NumberField
          label="Minimum lead time (min)"
          value={rules.minLeadMin}
          min={0}
          step={15}
          onChange={(v) => onChange({ ...rules, minLeadMin: v })}
        />
        <NumberField
          label="Max advance (days)"
          value={rules.maxAdvanceDays}
          min={0}
          step={1}
          onChange={(v) => onChange({ ...rules, maxAdvanceDays: v })}
        />
        <NumberField
          label="Buffer before (min)"
          value={rules.bufferBeforeMin}
          min={0}
          step={5}
          onChange={(v) => onChange({ ...rules, bufferBeforeMin: v })}
        />
        <NumberField
          label="Buffer after (min)"
          value={rules.bufferAfterMin}
          min={0}
          step={5}
          onChange={(v) => onChange({ ...rules, bufferAfterMin: v })}
        />
        <div className="grid gap-1">
          <span className="text-xs text-zinc-700">Allow overlaps (manual only)</span>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={rules.allowOverlaps}
              onChange={(e) => onChange({ ...rules, allowOverlaps: e.target.checked })}
            />
            <span className="text-black">Allow</span>
          </label>
        </div>
        <NumberField
          label="Cancellation window (hours)"
          value={rules.cancelWindowHours}
          min={0}
          step={1}
          onChange={(v) => onChange({ ...rules, cancelWindowHours: v })}
        />
        <NumberField
          label="No-show fee (NZD)"
          value={(rules.noShowFeeCents || 0) / 100}
          min={0}
          step={1}
          onChange={(v) => onChange({ ...rules, noShowFeeCents: Math.round(v * 100) })}
          money
        />
      </div>
    </section>
  );
}

/* ───────────────────────────────────────────────────────────────
   Notifications
   ─────────────────────────────────────────────────────────────── */
function NotificationsCard({
  notif,
  onChange,
}: {
  notif: Notifications;
  onChange: (n: Notifications) => void;
}) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="px-5 py-3 border-b border-zinc-200 font-semibold">Notifications</div>
      <div className="p-5 grid gap-6">
        <div className="grid grid-cols-2 gap-6">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={notif.emailEnabled}
              onChange={(e) => onChange({ ...notif, emailEnabled: e.target.checked })}
            />
            <span className="text-black">Email enabled</span>
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={notif.smsEnabled}
              onChange={(e) => onChange({ ...notif, smsEnabled: e.target.checked })}
            />
            <span className="text-black">SMS enabled</span>
          </label>
        </div>

        <TemplateField
          label="New booking (email)"
          value={notif.customerNewBookingEmail}
          onChange={(v) => onChange({ ...notif, customerNewBookingEmail: v })}
        />
        <TemplateField
          label="Reminder (email)"
          value={notif.customerReminderEmail}
          onChange={(v) => onChange({ ...notif, customerReminderEmail: v })}
        />
        <TemplateField
          label="Cancellation (email)"
          value={notif.customerCancelEmail}
          onChange={(v) => onChange({ ...notif, customerCancelEmail: v })}
        />
      </div>
    </section>
  );
}

/* ───────────────────────────────────────────────────────────────
   Online Booking
   ─────────────────────────────────────────────────────────────── */
function OnlineBookingCard({
  online,
  rules,
  orgSlug,
  onChange,
  onRulesChange,
}: {
  online: OnlineBooking;
  rules: BookingRules;
  orgSlug: string;
  onChange: (o: OnlineBooking) => void;
  onRulesChange: (r: BookingRules) => void;
}) {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "").trim();
  const bookingUrl = appUrl && orgSlug ? `${appUrl.replace(/\/$/, "")}/book/${orgSlug}` : "";
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    if (!bookingUrl) return;
    try {
      await navigator.clipboard.writeText(bookingUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="px-5 py-3 border-b border-zinc-200 font-semibold">Online booking</div>
      <div className="p-5 grid gap-6">
        <div className="grid gap-4 sm:grid-cols-3">
        <div className="grid gap-1">
          <span className="text-xs text-zinc-700">Enabled</span>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={online.enabled}
              onChange={(e) => onChange({ ...online, enabled: e.target.checked })}
            />
            <span className="text-black">Allow online bookings</span>
          </label>
        </div>
        <div className="grid gap-1">
          <span className="text-xs text-zinc-700">Auto confirm</span>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={online.autoConfirm}
              onChange={(e) => onChange({ ...online, autoConfirm: e.target.checked })}
            />
            <span className="text-black">Instant confirmation</span>
          </label>
        </div>
        <div className="grid gap-1">
          <span className="text-xs text-zinc-700">Require deposit</span>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={online.requireDeposit}
              onChange={(e) => onChange({ ...online, requireDeposit: e.target.checked })}
            />
            <span className="text-black">Deposit required</span>
          </label>
        </div>
        <div className="grid gap-1 sm:col-span-3">
          <NumberField
            label="Deposit amount (NZD)"
            value={(online.depositCents || 0) / 100}
            min={0}
            step={1}
            onChange={(v) => onChange({ ...online, depositCents: Math.round(v * 100) })}
            money
          />
        </div>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Booking link</div>
            <span className="ml-auto text-xs text-zinc-500">
              {appUrl ? "" : "Set NEXT_PUBLIC_APP_URL"}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-white px-3 py-2 text-xs text-zinc-700 border border-zinc-200">
              {bookingUrl || "Configure NEXT_PUBLIC_APP_URL to enable the link"}
            </span>
            <button
              type="button"
              onClick={copyLink}
              disabled={!bookingUrl}
              className="rounded-md border border-zinc-300 px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
            >
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-4">
          <NumberField
            label="Slot interval (min)"
            value={rules.slotMin}
            min={5}
            step={5}
            onChange={(v) => onRulesChange({ ...rules, slotMin: Math.round(v) })}
          />
          <NumberField
            label="Lead time (min)"
            value={rules.minLeadMin}
            min={0}
            step={15}
            onChange={(v) => onRulesChange({ ...rules, minLeadMin: Math.round(v) })}
          />
          <NumberField
            label="Buffer before (min)"
            value={rules.bufferBeforeMin}
            min={0}
            step={5}
            onChange={(v) => onRulesChange({ ...rules, bufferBeforeMin: Math.round(v) })}
          />
          <NumberField
            label="Buffer after (min)"
            value={rules.bufferAfterMin}
            min={0}
            step={5}
            onChange={(v) => onRulesChange({ ...rules, bufferAfterMin: Math.round(v) })}
          />
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────────────────────────────────────────────
   Booking Page (Public)
   ─────────────────────────────────────────────────────────────── */
function BookingPageCard({ orgSlug }: { orgSlug: string }) {
  const [config, setConfig] = useState<BookingPageConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/org/booking-page", { cache: "no-store" });
        const j = await res.json();
        if (!res.ok || !j?.ok) throw new Error(j?.error || "Failed to load booking page settings");
        if (alive) setConfig(j.config as BookingPageConfig);
      } catch (e: any) {
        if (alive) setError(e?.message || "Failed to load booking page settings");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const previewUrl = orgSlug
    ? `${(process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "")}/book/${orgSlug}`
    : "";

  if (!config) {
    return (
      <section className="rounded-xl border border-zinc-200 bg-white shadow-sm">
        <div className="px-5 py-3 border-b border-zinc-200 font-semibold">Public booking page</div>
        <div className="p-5 text-sm text-zinc-600">Loading booking page settings…</div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="px-5 py-3 border-b border-zinc-200 font-semibold flex items-center justify-between">
        <span>Public booking page</span>
        <div className="flex items-center gap-2">
          {previewUrl ? (
            <a className="text-sm underline" href={previewUrl} target="_blank" rel="noreferrer">
              Preview
            </a>
          ) : null}
          <Button
            variant={dirty ? "primary" : "secondary"}
            onClick={async () => {
              setSaving(true);
              setError(null);
              try {
                const res = await fetch("/api/org/booking-page", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(config),
                });
                const j = await res.json();
                if (!res.ok || !j?.ok) throw new Error(j?.error || "Save failed");
                setConfig(j.config as BookingPageConfig);
                setDirty(false);
              } catch (e: any) {
                setError(e?.message || "Save failed");
              } finally {
                setSaving(false);
              }
            }}
            disabled={saving || !dirty}
          >
            {saving ? "Saving…" : "Save booking page"}
          </Button>
        </div>
      </div>

      <div className="p-5 grid gap-5">
        {error && <div className="text-sm text-rose-600">{error}</div>}

        <div className="grid gap-2">
          <label className="text-xs text-zinc-600">Template</label>
          <select
            className="border rounded px-3 py-2"
            value={config.template}
            onChange={(e) => {
              setConfig({ ...config, template: e.target.value as BookingPageConfig["template"] });
              setDirty(true);
            }}
          >
            {BOOKING_TEMPLATE_OPTIONS.map((opt) => (
              <option key={opt.key} value={opt.key}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-2">
          <label className="text-xs text-zinc-600">Headline</label>
          <input
            className="border rounded px-3 py-2"
            value={config.content.headline}
            onChange={(e) => {
              setConfig({ ...config, content: { ...config.content, headline: e.target.value } });
              setDirty(true);
            }}
          />
        </div>

        <div className="grid gap-2">
          <label className="text-xs text-zinc-600">Subheadline</label>
          <textarea
            className="border rounded px-3 py-2 min-h-[90px]"
            value={config.content.subheadline}
            onChange={(e) => {
              setConfig({ ...config, content: { ...config.content, subheadline: e.target.value } });
              setDirty(true);
            }}
          />
        </div>
        <div className="grid gap-2">
          <label className="text-xs text-zinc-600">Helpful tips (one per line)</label>
          <textarea
            className="border rounded px-3 py-2 min-h-[90px]"
            value={config.content.tips.join("\n")}
            onChange={(e) => {
              const tips = e.target.value
                .split("\n")
                .map((t) => t.trim())
                .filter(Boolean);
              setConfig({ ...config, content: { ...config.content, tips } });
              setDirty(true);
            }}
          />
        </div>

        <div className="grid gap-2">
          <label className="text-xs text-zinc-600">Trust badges (one per line)</label>
          <textarea
            className="border rounded px-3 py-2 min-h-[90px]"
            value={config.content.trustBadges.join("\n")}
            onChange={(e) => {
              const trustBadges = e.target.value
                .split("\n")
                .map((t) => t.trim())
                .filter(Boolean);
              setConfig({ ...config, content: { ...config.content, trustBadges } });
              setDirty(true);
            }}
          />
        </div>

        <div className="grid gap-3">
          <div className="text-sm font-medium text-zinc-800">Extra fields (optional)</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {Object.entries(BOOKING_FIELDS).map(([key, field]) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={config.fields[key as keyof typeof BOOKING_FIELDS]}
                  onChange={(e) => {
                    setConfig({
                      ...config,
                      fields: {
                        ...config.fields,
                        [key]: e.target.checked,
                      },
                    });
                    setDirty(true);
                  }}
                />
                {field.label}
              </label>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function OnboardingResumeCard() {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="px-5 py-3 border-b border-zinc-200 font-semibold">Onboarding</div>
      <div className="p-5 flex flex-wrap items-center gap-3">
        <div className="text-sm text-zinc-600">
          Re-open the guided onboarding flow to connect Google, tune inbox automation, and share your booking page.
        </div>
        <div className="ml-auto">
          <Button variant="secondary" onClick={() => (window.location.href = "/onboarding")}>
            Open onboarding
          </Button>
        </div>
      </div>
    </section>
  );
}

function BrandingCard() {
  const [branding, setBranding] = useState<{
    logoUrl?: string;
    logoDarkUrl?: string;
    faviconUrl?: string;
    primaryColor?: string;
    wordmark?: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/org/branding", { cache: "no-store" });
        const j = await res.json();
        if (!res.ok || !j?.ok) throw new Error(j?.error || "Failed to load branding");
        if (alive) setBranding(j.branding || {});
      } catch (e: any) {
        if (alive) setError(e?.message || "Failed to load branding");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!branding) {
    return (
      <section className="rounded-xl border border-zinc-200 bg-white shadow-sm">
        <div className="px-5 py-3 border-b border-zinc-200 font-semibold">Branding</div>
        <div className="p-5 text-sm text-zinc-600">Loading branding…</div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="px-5 py-3 border-b border-zinc-200 font-semibold flex items-center justify-between">
        <span>Branding</span>
        <Button
          variant={dirty ? "primary" : "secondary"}
          disabled={!dirty || saving}
          onClick={async () => {
            setSaving(true);
            setError(null);
            try {
              const res = await fetch("/api/org/branding", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(branding),
              });
              const j = await res.json();
              if (!res.ok || !j?.ok) throw new Error(j?.error || "Save failed");
              setBranding(j.branding || branding);
              setDirty(false);
            } catch (e: any) {
              setError(e?.message || "Save failed");
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? "Saving…" : "Save branding"}
        </Button>
      </div>
      <div className="p-5 grid gap-4 sm:grid-cols-2">
        {error && <div className="text-sm text-rose-600 sm:col-span-2">{error}</div>}
        <label className="grid gap-1">
          <span className="text-xs text-zinc-700">Wordmark</span>
          <input
            className="h-10 rounded-md border border-zinc-300 px-3"
            value={branding.wordmark || ""}
            onChange={(e) => {
              setBranding({ ...branding, wordmark: e.target.value });
              setDirty(true);
            }}
            placeholder="Aroha Bookings"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-zinc-700">Primary color</span>
          <input
            className="h-10 rounded-md border border-zinc-300 px-3"
            value={branding.primaryColor || ""}
            onChange={(e) => {
              setBranding({ ...branding, primaryColor: e.target.value });
              setDirty(true);
            }}
            placeholder="#10B981"
          />
        </label>
        <label className="grid gap-1 sm:col-span-2">
          <span className="text-xs text-zinc-700">Logo URL (light)</span>
          <input
            className="h-10 rounded-md border border-zinc-300 px-3"
            value={branding.logoUrl || ""}
            onChange={(e) => {
              setBranding({ ...branding, logoUrl: e.target.value });
              setDirty(true);
            }}
            placeholder="https://…/logo-light.png"
          />
        </label>
        <label className="grid gap-1 sm:col-span-2">
          <span className="text-xs text-zinc-700">Logo URL (dark)</span>
          <input
            className="h-10 rounded-md border border-zinc-300 px-3"
            value={branding.logoDarkUrl || ""}
            onChange={(e) => {
              setBranding({ ...branding, logoDarkUrl: e.target.value });
              setDirty(true);
            }}
            placeholder="https://…/logo-dark.png"
          />
        </label>
        <label className="grid gap-1 sm:col-span-2">
          <span className="text-xs text-zinc-700">Favicon URL</span>
          <input
            className="h-10 rounded-md border border-zinc-300 px-3"
            value={branding.faviconUrl || ""}
            onChange={(e) => {
              setBranding({ ...branding, faviconUrl: e.target.value });
              setDirty(true);
            }}
            placeholder="https://…/favicon.png"
          />
        </label>
      </div>
    </section>
  );
}

function EmailIdentityCard() {
  const [identity, setIdentity] = useState<{
    fromName?: string;
    replyTo?: string;
    supportEmail?: string;
    footerText?: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/org/email-identity", { cache: "no-store" });
        const j = await res.json();
        if (!res.ok || !j?.ok) throw new Error(j?.error || "Failed to load email identity");
        if (alive) setIdentity(j.identity || {});
      } catch (e: any) {
        if (alive) setError(e?.message || "Failed to load email identity");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!identity) {
    return (
      <section className="rounded-xl border border-zinc-200 bg-white shadow-sm">
        <div className="px-5 py-3 border-b border-zinc-200 font-semibold">Email identity</div>
        <div className="p-5 text-sm text-zinc-600">Loading email identity…</div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="px-5 py-3 border-b border-zinc-200 font-semibold flex items-center justify-between">
        <span>Email identity</span>
        <Button
          variant={dirty ? "primary" : "secondary"}
          disabled={!dirty || saving}
          onClick={async () => {
            setSaving(true);
            setError(null);
            try {
              const res = await fetch("/api/org/email-identity", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(identity),
              });
              const j = await res.json();
              if (!res.ok || !j?.ok) throw new Error(j?.error || "Save failed");
              setIdentity(j.identity || identity);
              setDirty(false);
            } catch (e: any) {
              setError(e?.message || "Save failed");
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? "Saving…" : "Save identity"}
        </Button>
      </div>
      <div className="p-5 grid gap-4 sm:grid-cols-2">
        {error && <div className="text-sm text-rose-600 sm:col-span-2">{error}</div>}
        <label className="grid gap-1 sm:col-span-2">
          <span className="text-xs text-zinc-700">From name</span>
          <input
            className="h-10 rounded-md border border-zinc-300 px-3"
            value={identity.fromName || ""}
            onChange={(e) => {
              setIdentity({ ...identity, fromName: e.target.value });
              setDirty(true);
            }}
            placeholder="Aroha Bookings via Aroha"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-zinc-700">Reply-to email</span>
          <input
            className="h-10 rounded-md border border-zinc-300 px-3"
            value={identity.replyTo || ""}
            onChange={(e) => {
              setIdentity({ ...identity, replyTo: e.target.value });
              setDirty(true);
            }}
            placeholder="hello@yourdomain.com"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-zinc-700">Support email</span>
          <input
            className="h-10 rounded-md border border-zinc-300 px-3"
            value={identity.supportEmail || ""}
            onChange={(e) => {
              setIdentity({ ...identity, supportEmail: e.target.value });
              setDirty(true);
            }}
            placeholder="support@yourdomain.com"
          />
        </label>
        <label className="grid gap-1 sm:col-span-2">
          <span className="text-xs text-zinc-700">Footer text</span>
          <textarea
            className="h-20 rounded-md border border-zinc-300 px-3 py-2"
            value={identity.footerText || ""}
            onChange={(e) => {
              setIdentity({ ...identity, footerText: e.target.value });
              setDirty(true);
            }}
            placeholder="You’re receiving this message because you booked with us."
          />
        </label>
      </div>
    </section>
  );
}

/* ───────────────────────────────────────────────────────────────
   Calendar Preferences
   ─────────────────────────────────────────────────────────────── */
function CalendarPrefsCard({
  prefs,
  onChange,
}: {
  prefs: CalendarPrefs;
  onChange: (c: CalendarPrefs) => void;
}) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="px-5 py-3 border-b border-zinc-200 font-semibold">Calendar preferences</div>
      <div className="p-5 grid gap-4 sm:grid-cols-4">
        <div className="grid gap-1">
          <span className="text-xs text-zinc-700">Default view</span>
          <select
            className="h-10 rounded-md border border-zinc-300 px-3 outline-none focus:ring-2 focus:ring-black/10"
            value={prefs.defaultView}
            onChange={(e) => onChange({ ...prefs, defaultView: e.target.value as "week" | "day" })}
          >
            <option value="week">Week</option>
            <option value="day">Day</option>
          </select>
        </div>
        <div className="grid gap-1">
          <span className="text-xs text-zinc-700">Week starts on</span>
          <select
            className="h-10 rounded-md border border-zinc-300 px-3 outline-none focus:ring-2 focus:ring-black/10"
            value={prefs.weekStartsOn}
            onChange={(e) => onChange({ ...prefs, weekStartsOn: Number(e.target.value) as 0 | 1 })}
          >
            <option value={1}>Monday</option>
            <option value={0}>Sunday</option>
          </select>
        </div>
        <TimeMinField
          label="Working day start"
          minutes={prefs.workingStartMin}
          onChange={(m) => onChange({ ...prefs, workingStartMin: m })}
        />
        <TimeMinField
          label="Working day end"
          minutes={prefs.workingEndMin}
          onChange={(m) => onChange({ ...prefs, workingEndMin: m })}
        />
      </div>
    </section>
  );
}

/* ───────────────────────────────────────────────────────────────
   Small Reusable Inputs
   ─────────────────────────────────────────────────────────────── */
function NumberField({
  label,
  value,
  min = 0,
  step = 1,
  money = false,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  step?: number;
  money?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-xs text-zinc-700">{label}</span>
      <div className="relative">
        {money && (
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400 text-sm">
            $
          </span>
        )}
        <input
          type="number"
          min={min}
          step={step}
          className={`h-10 w-full rounded-md border border-zinc-300 px-3 ${
            money ? "pl-6" : ""
          } outline-none focus:ring-2 focus:ring-black/10`}
          value={value}
          onChange={(e) => onChange(Number(e.target.value || 0))}
        />
      </div>
    </label>
  );
}

function TimeMinField({
  label,
  minutes,
  onChange,
}: {
  label: string;
  minutes: number;
  onChange: (m: number) => void;
}) {
  const toTime = (min: number) => {
    const h = Math.floor((min || 0) / 60);
    const m = (min || 0) % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  };
  const toMin = (t: string) => {
    if (!t) return 0;
    const [h, m] = t.split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  };

  return (
    <label className="grid gap-1">
      <span className="text-xs text-zinc-700">{label}</span>
      <input
        type="time"
        className="h-10 rounded-md border border-zinc-300 px-3 outline-none focus:ring-2 focus:ring-black/10"
        value={toTime(minutes)}
        onChange={(e) => onChange(toMin(e.target.value))}
      />
    </label>
  );
}

function TemplateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-xs text-zinc-700">{label}</span>
      <textarea
        className="min-h-[88px] rounded-md border border-zinc-300 px-3 py-2 outline-none focus:ring-2 focus:ring-black/10"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Use {{name}}, {{datetime}}, {{staff}} etc."
      />
      <span className="text-[11px] text-zinc-500">
        Variables: <code className="font-mono">{"{{name}}"}</code>,{" "}
        <code className="font-mono">{"{{datetime}}"}</code>,{" "}
        <code className="font-mono">{"{{staff}}"}</code>
      </span>
    </label>
  );
}
