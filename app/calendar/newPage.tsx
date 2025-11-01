// app/calendar/newPage.tsx
"use client";

import * as React from "react";
import {
  FiltersBar,
  NewBookingButton,
  GridColumn,
  EditBookingPortal,
  type StaffRow,
  type ServiceRow,
  type Block,
} from "./ClientIslands";
import { calendarBootstrap, listEvents } from "./actions";


/* ───────────────────────────────────────────────────────────────
   Local helpers (mirror ClientIslands where needed)
   ─────────────────────────────────────────────────────────────── */
const SLOT_PX = 64; // must match ClientIslands
const DEFAULT_SLOT_MIN = 30;

function pad(n: number) {
  return n < 10 ? `0${n}` : String(n);
}
function isoDateOnly(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function todayISO(): string {
  return isoDateOnly(new Date());
}
function minutesFromMidnight(d: Date) {
  return d.getHours() * 60 + d.getMinutes();
}
function weekdayIndexFromISO(dateISO: string) {
  // 0=Sun..6=Sat
  return new Date(`${dateISO}T00:00:00`).getDay();
}

/** Map server events -> Block[] for a single-day column */
function mapEventsToBlocks(
  events: Array<{
    id: string;
    startsAt: string | Date;
    endsAt: string | Date;
    customerName: string;
    customerPhone: string;
    staffId: string | null;
    serviceId: string | null;
    staffColor?: string | null;
    serviceColor?: string | null;
  }>,
  dayOpenMin: number,
  slotMin: number,
  staff: StaffRow[],
  services: ServiceRow[]
): Block[] {
  const staffBy = Object.fromEntries(staff.map((s) => [s.id, s]));
  const svcBy = Object.fromEntries(services.map((s) => [s.id, s]));

  return events.map((e) => {
    const starts = new Date(e.startsAt);
    const ends = new Date(e.endsAt);

    const startM = Math.max(0, minutesFromMidnight(starts) - dayOpenMin);
    const endM = Math.max(0, minutesFromMidnight(ends) - dayOpenMin);
    const durationM = Math.max(5, endM - startM);

    const top = Math.round(startM / slotMin) * SLOT_PX;
    const height = Math.max(SLOT_PX, Math.round(durationM / slotMin) * SLOT_PX);

    const staffName = e.staffId ? (staffBy[e.staffId]?.name ?? "(Unassigned)") : "(Unassigned)";
    const svcName = e.serviceId ? (svcBy[e.serviceId]?.name ?? "") : "";

    const subtitle =
      `${pad(starts.getHours())}:${pad(starts.getMinutes())}` +
      `–${pad(ends.getHours())}:${pad(ends.getMinutes())}` +
      (svcName ? ` • ${svcName}` : "");

    const block: Block = {
      id: e.id,
      top,
      height,
      title: e.customerName || "Client",
      subtitle,
      staffName,
      colorClass: "bg-indigo-50 ring-indigo-200",
      bgHex: e.staffColor ?? e.serviceColor ?? undefined,
      startsAt: e.startsAt,
      endsAt: e.endsAt,
      staffId: e.staffId ?? null,
      serviceId: e.serviceId ?? null,
      _customerName: e.customerName ?? "",
      _customerPhone: e.customerPhone ?? "",
    };

    return block;
  });
}

/* ───────────────────────────────────────────────────────────────
   Component
   ─────────────────────────────────────────────────────────────── */

export default function CalendarNewPage() {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [orgTZ, setOrgTZ] = React.useState<string>("Pacific/Auckland");
  const [tzMode, setTzMode] = React.useState<"org" | "local">("org");

  const [staff, setStaff] = React.useState<StaffRow[]>([]);
  const [services, setServices] = React.useState<ServiceRow[]>([]);
  const [openingHours, setOpeningHours] = React.useState<
    Array<{ weekday: number; openMin: number; closeMin: number }>
  >([]);

  const [selectedDate, setSelectedDate] = React.useState<string>(todayISO());
  const [searchQuery, setSearchQuery] = React.useState("");
  const [staffFilter, setStaffFilter] = React.useState("");

  const [blocks, setBlocks] = React.useState<Block[]>([]);
  const [gutterSlots, setGutterSlots] = React.useState<number>(((18 - 9) * 60) / DEFAULT_SLOT_MIN); // 9–18 default

  // Helpers: date range for selected day
  function dayRangeISO(dateISO: string) {
    const start = new Date(`${dateISO}T00:00:00`);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return { startISO: start.toISOString(), endISO: end.toISOString() };
  }

  // Load bootstrap + events
  React.useEffect(() => {
    let cancelled = false;

    async function init() {
      setLoading(true);
      setError(null);
      try {
        const settings = await calendarBootstrap();
        if (cancelled) return;

        setOrgTZ(settings?.org?.timezone ?? "Pacific/Auckland");
        setStaff(settings?.staff ?? []);
        setServices(settings?.services ?? []);
        setOpeningHours(settings?.openingHours ?? []);

        const wday = weekdayIndexFromISO(selectedDate); // 0..6
        const day = (settings?.openingHours ?? []).find(
          (h: { weekday: number; openMin: number; closeMin: number }) => h.weekday === wday
        );
        const openMin = Number(day?.openMin ?? 9 * 60);
        const closeMin = Number(day?.closeMin ?? 18 * 60);
        const slotMin = DEFAULT_SLOT_MIN;

        const totalSlots = Math.max(1, Math.ceil((closeMin - openMin) / slotMin));
        setGutterSlots(totalSlots);

        const { startISO, endISO } = dayRangeISO(selectedDate);
        const { events } = await listEvents({ start: startISO, end: endISO });
        if (cancelled) return;

        const mapped = mapEventsToBlocks(
          events ?? [],
          openMin,
          slotMin,
          settings?.staff ?? [],
          settings?.services ?? []
        );
        setBlocks(mapped);
      } catch (err) {
        console.error("Calendar load failed:", err);
        if (!cancelled) setError("Failed to load calendar data. Check console for details.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [selectedDate]);

  // Client-side filter
  const visibleBlocks = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const sid = staffFilter.trim();
    return blocks.filter((b) => {
      if (sid && (b.staffId ?? "") !== sid) return false;
      if (!q) return true;
      const hay = `${(b as any)._customerName ?? b.title} ${b.subtitle}`.toLowerCase();
      return hay.includes(q);
    });
  }, [blocks, searchQuery, staffFilter]);

  /* ────────────────────────────────────────────────────────────
     UI
     ──────────────────────────────────────────────────────────── */
  return (
    <div className="p-4 space-y-4">
      {/* Header row */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">Calendar (New)</h1>
          <span className="text-sm text-zinc-500">
            TZ: {tzMode === "org" ? orgTZ : "Local"}
          </span>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2">
          <button
            className="rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm hover:bg-zinc-50"
            onClick={() => {
              const d = new Date(`${selectedDate}T00:00:00`);
              d.setDate(d.getDate() - 1);
              setSelectedDate(isoDateOnly(d));
            }}
            aria-label="Previous day"
          >
            ◀
          </button>

          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm"
            aria-label="Selected date"
          />

          <button
            className="rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm hover:bg-zinc-50"
            onClick={() => {
              const d = new Date(`${selectedDate}T00:00:00`);
              d.setDate(d.getDate() + 1);
              setSelectedDate(isoDateOnly(d));
            }}
            aria-label="Next day"
          >
            ▶
          </button>

          <NewBookingButton
            staff={staff}
            services={services}
            defaultDate={new Date(`${selectedDate}T00:00:00`)}
          />
        </div>
      </div>

      {/* Filters row */}
      <div className="flex flex-wrap items-center gap-2">
        <FiltersBar
          orgTZ={orgTZ}
          activeTZ={tzMode}
          staff={staff}
          services={services}
          searchQuery={searchQuery}
          staffFilter={staffFilter}
          onExportCSV={undefined} // use ClientIslands fallback
          appts={visibleBlocks.map((b) => ({
            startsAt: b.startsAt,
            endsAt: b.endsAt,
            customerName: (b as any)._customerName ?? b.title,
            customerPhone: (b as any)._customerPhone ?? "",
            staffId: b.staffId ?? null,
            serviceId: b.serviceId ?? null,
          }))}
          hrefBuilder={(patch) => {
            if (patch.tz) {
              setTzMode(patch.tz === "local" ? "local" : "org");
              delete patch.tz;
            }
            if (typeof patch.staff !== "undefined") {
              setStaffFilter(patch.staff);
              delete patch.staff;
            }
            if (typeof patch.q !== "undefined") {
              setSearchQuery(patch.q);
              delete patch.q;
            }
            // no navigation
            return window.location.href;
          }}
        />
      </div>

      {/* Body */}
      <div className="rounded-lg border border-zinc-200 bg-white overflow-hidden">
        {/* Column header */}
        <div className="px-3 py-2 text-sm font-medium border-b border-zinc-200">
          {selectedDate}
        </div>

        {/* Single-day grid */}
        <div className="relative">
          {loading ? (
            <div className="p-8 text-sm text-zinc-500">Loading…</div>
          ) : error ? (
            <div className="p-8 text-sm text-red-600">{error}</div>
          ) : (
            <GridColumn
              gutterSlots={gutterSlots}
              blocks={visibleBlocks}
              create={{
                dateISO: selectedDate,
                slotMin: DEFAULT_SLOT_MIN,
                staff: staff.map((s) => ({ id: s.id, name: s.name })),
                services: services.map((sv) => ({
                  id: sv.id,
                  name: sv.name,
                  durationMin: sv.durationMin,
                })),
                // NOTE: do NOT pass minutesFromOpen here — GridColumn doesn't accept it.
              }}
            />
          )}
        </div>
      </div>

      {/* Modal portal */}
      <EditBookingPortal
        staff={staff}
        services={services}
        timezone={tzMode === "org" ? orgTZ : undefined}
      />
    </div>
  );
}
