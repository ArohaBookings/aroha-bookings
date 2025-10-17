// app/settings/page.tsx
"use client";

import React, { useMemo, useState, useTransition, useRef, useEffect } from "react";
import { saveAllSettings } from "./actions";

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
};

const DAYS_MON_FIRST = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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

/* ───────────────────────────────────────────────────────────────
   Main Page
   ─────────────────────────────────────────────────────────────── */

export default function SettingsPage() {
  /* Business & base org props */
  const [business, setBusiness] = useState<Business>({
    name: "",
    timezone: "Pacific/Auckland",
    address: "",
    phone: "",
    email: "",
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
    // Normalize roster: UI is Mon..Sun (idx 0..6), server expects Sun..Sat.
    const rosterSunFirst: Roster = {};
    for (const [sid, cells] of Object.entries(roster)) {
      const seven = Array.from({ length: 7 }, (_, i) => cells[i] ?? { start: "", end: "" });
      // Move Sunday (UI idx 6) to front
      const sun = seven[6];
      rosterSunFirst[sid] = [sun, ...seven.slice(0, 6)];
    }

    return {
      business,
      openingHours,
      services,
      staff: staff.map((s) => ({
        ...s,
        serviceIds: Array.isArray(s.serviceIds) ? s.serviceIds : [],
      })),
      roster: rosterSunFirst,
      bookingRules: rules,
      notifications,
      onlineBooking: online,
      calendarPrefs,
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
        if (obj.roster && typeof obj.roster === "object") setRoster(obj.roster);
        if (obj.bookingRules) setRules(obj.bookingRules);
        if (obj.notifications) setNotifications(obj.notifications);
        if (obj.onlineBooking) setOnline(obj.onlineBooking);
        if (obj.calendarPrefs) setCalendarPrefs(obj.calendarPrefs);
        setLastSuccess("Imported JSON settings.");
        markDirty();
      } catch (e: any) {
        setLastError(`Failed to import: ${e?.message || "Invalid JSON"}`);
      }
    };
    reader.readAsText(file);
  }

  const activeStaff = useMemo(() => staff.filter((s) => s.active), [staff]);

  return (
    <div className="p-6 space-y-10 text-black">
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
          <button
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-50"
            onClick={exportJSON}
          >
            Export JSON
          </button>
          <button
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-50"
            onClick={() => fileRef.current?.click()}
          >
            Import JSON
          </button>
          <button
            className="rounded-md bg-black text-white px-4 py-2 text-sm hover:bg-black/90 transition disabled:opacity-60"
            disabled={isSaving}
            onClick={() => {
              setLastError(null);
              setLastSuccess(null);
              const payload = buildPayload();
              const errs = validateBeforeSave({
                business, openingHours, services, staff, roster, rules,
              });
              if (errs.length) {
                setLastError(errs.join("\n"));
                return;
              }
              startSaving(async () => {
                const res = await saveAllSettings(payload as any);
                if (res.ok) {
                  setLastSuccess("Settings saved ✅");
                  setDirtyCount(0);
                } else {
                  setLastError(res.error || "Failed to save settings");
                }
              });
            }}
          >
            {isSaving ? "Saving…" : (dirty ? "Save changes *" : "Save changes")}
          </button>
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

      {/* Business */}
      <BusinessCard
        business={business}
        onChange={(b) => { setBusiness(b); markDirty(); }}
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
            const next = { ...prev };
            const row = next[staffId] ?? Array.from({ length: 7 }, () => ({ start: "", end: "" }));
            const copy = deepClone(row);
            copy[dayIdx] = cell;
            next[staffId] = copy;
            return next;
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
      <OnlineBookingCard online={online} onChange={(o) => { setOnline(o); markDirty(); }} />

      {/* Calendar preferences */}
      <CalendarPrefsCard prefs={calendarPrefs} onChange={(c) => { setCalendarPrefs(c); markDirty(); }} />

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
}: {
  staff: Staff[];
  services: Service[];
  onAdd: (s: Staff) => void;
  onUpdate: (id: string, patch: Partial<Staff>) => void;
  onDelete: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [colorHex, setColorHex] = useState("#10B981");

  return (
    <section className="rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="px-5 py-3 border-b border-zinc-200 font-semibold">Staff</div>

      <div className="p-5">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-zinc-50 text-black">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Name</th>
                <th className="text-left px-4 py-2 font-medium">Email</th>
                <th className="text-left px-4 py-2 font-medium">Colour</th>
                <th className="text-left px-4 py-2 font-medium">Active</th>
                <th className="text-left px-4 py-2 font-medium">Services</th>
                <th className="text-right px-4 py-2 font-medium"></th>
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
                    <button
                      className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50"
                      onClick={() => onDelete(s.id)}
                    >
                      Delete
                    </button>
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
   Roster (UI Mon..Sun)
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
              const row = roster[s.id] ?? Array.from({ length: 7 }, () => ({ start: "", end: "" })); // Mon..Sun
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
                        <input
                          type="time"
                          className="h-9 w-28 rounded-md border border-zinc-300 px-2 outline-none focus:ring-2 focus:ring-black/10"
                          value={cell.start}
                          onChange={(e) => onChangeCell(s.id, i, { ...cell, start: e.target.value })}
                        />
                        <span className="text-zinc-500">–</span>
                        <input
                          type="time"
                          className="h-9 w-28 rounded-md border border-zinc-300 px-2 outline-none focus:ring-2 focus:ring-black/10"
                          value={cell.end}
                          onChange={(e) => onChangeCell(s.id, i, { ...cell, end: e.target.value })}
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
          onClick={() => alert("Soon: auto-fill roster from opening hours.")}
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
  onChange,
}: {
  online: OnlineBooking;
  onChange: (o: OnlineBooking) => void;
}) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="px-5 py-3 border-b border-zinc-200 font-semibold">Online booking</div>
      <div className="p-5 grid gap-4 sm:grid-cols-3">
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
