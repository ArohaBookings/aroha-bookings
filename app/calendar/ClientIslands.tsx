// app/calendar/ClientIslands.tsx
"use client";

import * as React from "react";
import { createBooking, updateBooking, cancelBooking } from "./actions";

/* ─── Types used by props ─── */
export type StaffRow = { id: string; name: string; active?: boolean };
export type ServiceRow = { id: string; name: string; durationMin: number; priceCents?: number };
export type Block = {
  id: string;
  top: number;
  height: number;
  title: string;
  subtitle: string;
  staffName: string;
  colorClass: string;
  startsAt: Date | string;
  endsAt: Date | string;
  staffId: string | null;
  serviceId: string | null;
};
export type ViewMode = "week" | "day";

/* Appt shape for CSV (minimal fields we need) */
type ApptForCsv = {
  startsAt: Date | string;
  endsAt: Date | string;
  customerName: string;
  customerPhone: string;
  staffId: string | null;
  serviceId: string | null;
};

/* ─── Tiny helpers (duplicated locally on purpose) ─── */
function isoDateOnly(d: Date) { return d.toISOString().slice(0, 10); }
function minutesBetween(a: Date, b: Date) { return Math.floor((b.getTime() - a.getTime()) / 60000); }
function pad(n: number) { return n < 10 ? `0${n}` : String(n); }
function toDate(x: Date | string) { return x instanceof Date ? x : new Date(x); }

/* Build a URL on the client by patching current query params */
function goWithPatch(patch: Record<string, string>) {
  const url = new URL(window.location.href);
  const params = url.searchParams;
  Object.entries(patch).forEach(([k, v]) => {
    if (v === "") params.delete(k);
    else params.set(k, v);
  });
  url.search = params.toString();
  window.location.href = url.toString();
}

/* ───────────────────────────────────────────────────────────────
   Export CSV (runs on client, uses serializable data)
   ─────────────────────────────────────────────────────────────── */
function exportCSV(appts: ApptForCsv[], staff: StaffRow[], services: ServiceRow[]) {
  const staffBy = Object.fromEntries(staff.map(s => [s.id, s]));
  const svcBy = Object.fromEntries(services.map(s => [s.id, s]));

  const rows = [
    ["When", "Ends", "Client", "Phone", "Staff", "Service"],
    ...appts.map(a => {
      const starts = toDate(a.startsAt).toISOString();
      const ends = toDate(a.endsAt).toISOString();
      const staffName = a.staffId ? (staffBy[a.staffId]?.name ?? "") : "";
      const svcName = a.serviceId ? (svcBy[a.serviceId]?.name ?? "") : "";
      return [starts, ends, a.customerName, a.customerPhone, staffName, svcName];
    })
  ];

  const csv = rows.map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `appointments-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ───────────────────────────────────────────────────────────────
   Filters/search/export bar
   - Accepts BOTH styles:
     • Old style: hrefBuilder + onExportCSV (from server) — OPTIONAL
     • New style: no functions; we use goWithPatch + local export — pass appts
   ─────────────────────────────────────────────────────────────── */
export function FiltersBar({
  orgTZ, activeTZ, staff, services, searchQuery, staffFilter,
  // optional function props (if your page.tsx still passes them)
  hrefBuilder,
  onExportCSV,
  // optional data-based export fallback
  appts = [],
}: {
  orgTZ: string;
  activeTZ: "org" | "local";
  staff: StaffRow[];
  services: ServiceRow[];
  searchQuery: string;
  staffFilter: string;
  hrefBuilder?: (patch: Record<string, string>) => string;
  onExportCSV?: () => void;
  appts?: ApptForCsv[];
}) {
  const [q, setQ] = React.useState(searchQuery);
  const [staffSel, setStaffSel] = React.useState(staffFilter);

  const inputRef = React.useRef<HTMLInputElement | null>(null);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "/") { e.preventDefault(); inputRef.current?.focus(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const navigate = (patch: Record<string, string>) => {
    if (hrefBuilder) {
      // legacy style from server
      window.location.href = hrefBuilder(patch);
    } else {
      // data-only style
      goWithPatch(patch);
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") navigate({ q });
          if (e.key === "Escape") setQ("");
        }}
        placeholder="Search name or phone…"
        className="w-44 md:w-56 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />

      <select
        value={staffSel}
        onChange={(e) => {
          const v = e.target.value;
          setStaffSel(v);
          navigate({ staff: v });
        }}
        className="rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm"
      >
        <option value="">All staff</option>
        {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>

      <button
        onClick={() => {
          const tz = activeTZ === "org" ? "local" : "org";
          navigate({ tz });
        }}
        className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm hover:bg-zinc-50"
        title={`Switch timezone (current: ${activeTZ === "org" ? orgTZ : "Local"})`}
      >
        TZ: {activeTZ === "org" ? "Org" : "Local"}
      </button>

      <button
        onClick={() => {
          if (onExportCSV) onExportCSV();
          else exportCSV(appts, staff, services);
        }}
        className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm hover:bg-zinc-50"
      >
        Export CSV
      </button>
    </>
  );
}

/* ───────────────────────────────────────────────────────────────
   New booking button
   ─────────────────────────────────────────────────────────────── */
export function NewBookingButton({
  staff, services, defaultDate,
}: { staff: StaffRow[]; services: ServiceRow[]; defaultDate: Date; }) {
  return (
    <button
      className="rounded-md bg-indigo-600 text-white px-3 py-1.5 text-sm hover:bg-indigo-500 shadow"
      onClick={() =>
        openCreateWithTime({
          dateISO: isoDateOnly(defaultDate),
          minutesFromOpen: 9 * 60,
          slotMin: 30,
          staff: staff.map((s) => ({ id: s.id, name: s.name })),
          services: services.map((sv) => ({ id: sv.id, name: sv.name, durationMin: sv.durationMin })),
        })
      }
    >
      + New booking
    </button>
  );
}

/* ───────────────────────────────────────────────────────────────
   Grid column & appointment button
   - Matches page.tsx usage: <GridColumn create={{...}} />
   ─────────────────────────────────────────────────────────────── */
// in app/calendar/ClientIslands.tsx
export function GridColumn({
  gutterSlots,
  blocks,
  create,
}: {
  gutterSlots: number;
  blocks: Block[];
  create: {
    dateISO: string;
    slotMin: number;
    staff: Array<{ id: string; name: string }>;
    services: Array<{ id: string; name: string; durationMin: number }>;
  };
}) {
  const colRef = React.useRef<HTMLDivElement | null>(null);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = colRef.current; if (!el) return;
    const rect = el.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const slotHeight = rect.height / gutterSlots;
    const slotIndex = Math.max(0, Math.round(y / slotHeight));
    const minutesFromOpen = slotIndex * create.slotMin;
    openCreateWithTime({ ...create, minutesFromOpen });
  };

  return (
    <div ref={colRef} className="relative border-l border-zinc-100" onDoubleClick={handleClick}>
      {Array.from({ length: gutterSlots }).map((_, i) => (
        <div key={i} className="h-16 border-b border-zinc-100" />
      ))}
      <div className="absolute inset-0">
        {blocks.map((b) => <BlockButton key={b.id} block={b} />)}
      </div>
    </div>
  );
}

export function BlockButton({ block }: { block: Block }) {
  return (
    <button
      className={`absolute left-1 right-1 rounded-md border px-2 py-1 text-[12px] leading-tight shadow-sm ${block.colorClass} text-left`}
      style={{ top: block.top, height: block.height }}
      title={`${block.title} — ${block.subtitle}`}
      onClick={() =>
        openEdit({
          id: block.id,
          startsAtISO: toDate(block.startsAt).toISOString(),
          durationMin: Math.max(10, minutesBetween(toDate(block.startsAt), toDate(block.endsAt))),
          staffId: block.staffId ?? "",
          serviceId: block.serviceId ?? "",
          customerName: block.title,
          customerPhone: "",
        })
      }
    >
      <div className="font-medium truncate">{block.title}</div>
      <div className="text-[11px] opacity-80 truncate">{block.subtitle}</div>
    </button>
  );
}

/* ───────────────────────────────────────────────────────────────
   Modal plumbing + forms
   ─────────────────────────────────────────────────────────────── */
declare global { interface Window { __ar_modal?: (p: EditProps | CreateProps) => void; } }

type CreateProps = {
  mode?: "create";
  dateISO: string;
  minutesFromOpen: number;
  slotMin: number;
  staff: Array<{ id: string; name: string }>;
  services: Array<{ id: string; name: string; durationMin: number }>;
};
type EditProps = {
  mode?: "edit";
  id: string;
  startsAtISO: string;
  durationMin: number;
  staffId: string;
  serviceId: string;
  customerName: string;
  customerPhone: string;
};

export function EditBookingPortal({
  staff, services, timezone,
}: { staff: StaffRow[]; services: ServiceRow[]; timezone?: string; }) {
  const [state, setState] = React.useState<CreateProps | EditProps | null>(null);

  React.useEffect(() => {
    window.__ar_modal = (props) => setState(props);
    return () => { if (window.__ar_modal) delete window.__ar_modal; };
  }, []);

  if (!state) return null;
  const onClose = () => setState(null);

  return (
    <div className="fixed inset-0 z-[999] bg-black/30 flex items-center justify-center p-4"
         onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="w-full max-w-md rounded-lg bg-white shadow-lg border border-zinc-200">
        {"mode" in state && state.mode === "edit" ? (
          <EditForm data={state} onClose={onClose} staff={staff} services={services} timezone={timezone} />
        ) : (
          <CreateForm data={state as CreateProps} onClose={onClose} staff={staff} services={services} timezone={timezone} />
        )}
      </div>
    </div>
  );
}

function openCreateWithTime(p: CreateProps) { if (typeof window !== "undefined" && window.__ar_modal) window.__ar_modal({ ...p, mode: "create" }); }
function openEdit(p: EditProps) { if (typeof window !== "undefined" && window.__ar_modal) window.__ar_modal({ ...p, mode: "edit" }); }

function CreateForm({
  data, onClose, staff, services, timezone,
}: { data: CreateProps; onClose: () => void; staff: Array<{ id: string; name: string }>; services: Array<{ id: string; name: string; durationMin: number }>; timezone?: string; }) {
  const [startsAt, setStartsAt] = React.useState(`${data.dateISO}T${pad(Math.floor(data.minutesFromOpen/60))}:${pad(data.minutesFromOpen%60)}`);
  const [duration, setDuration] = React.useState(services[0]?.durationMin ?? 30);

  return (
    <form
      action={async (fd: FormData) => {
        const res = await createBooking(fd);
        if (!res.ok) alert(res.error ?? "Failed to create booking"); else location.reload();
      }}
      className="p-4 space-y-3"
    >
      <header className="font-semibold text-lg">New booking</header>

      <label className="block">
        <span className="text-sm text-zinc-600">Customer name</span>
        <input name="customerName" required className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm" placeholder="Jane Doe" />
      </label>

      <label className="block">
        <span className="text-sm text-zinc-600">Phone</span>
        <input name="customerPhone" required className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm" placeholder="021 000 0000" />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-sm text-zinc-600">Start</span>
          <input type="datetime-local" name="startsAt" required value={startsAt} onChange={(e) => setStartsAt(e.target.value)}
                 className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm" />
          <div className="mt-1 text-[11px] text-zinc-500">TZ: {timezone ?? "Local"}</div>
        </label>

        <label className="block">
          <span className="text-sm text-zinc-600">Duration (min)</span>
          <input type="number" name="durationMin" required min={10} step={5} value={duration}
                 onChange={(e) => setDuration(Number(e.target.value))}
                 className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm" />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-sm text-zinc-600">Staff</span>
          <select name="staffId" className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm">
            <option value="">(Unassigned)</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>

        <label className="block">
          <span className="text-sm text-zinc-600">Service</span>
          <select
            name="serviceId"
            className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
            onChange={(e) => {
              const m = services.find((x) => x.id === e.target.value);
              if (m) setDuration(m.durationMin);
            }}
          >
            <option value="">(None)</option>
            {services.map((sv) => <option key={sv.id} value={sv.id}>{sv.name}</option>)}
          </select>
        </label>
      </div>

      <div className="flex items-center justify-end gap-2 pt-2">
        <button type="button" onClick={onClose} className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm hover:bg-zinc-50">Cancel</button>
        <button className="rounded-md bg-indigo-600 text-white px-3 py-1.5 text-sm hover:bg-indigo-500">Create</button>
      </div>
    </form>
  );
}

function EditForm({
  data, onClose, staff, services, timezone,
}: { data: { id: string; startsAtISO: string; durationMin: number; staffId: string; serviceId: string; customerName: string; customerPhone: string; };
     onClose: () => void; staff: StaffRow[]; services: ServiceRow[]; timezone?: string; }) {
  const [startsAt, setStartsAt] = React.useState<string>(data.startsAtISO.slice(0, 16));
  const [duration, setDuration] = React.useState<number>(data.durationMin);

  return (
    <div className="p-4 space-y-3">
      <header className="font-semibold text-lg">Edit booking</header>

      <form
        action={async (fd: FormData) => {
          const res = await updateBooking(fd);
          if (!res.ok) alert(res.error ?? "Failed to update booking"); else location.reload();
        }}
        className="space-y-3"
      >
        <input type="hidden" name="id" value={data.id} />

        <label className="block">
          <span className="text-sm text-zinc-600">Customer name</span>
          <input name="customerName" defaultValue={data.customerName} required className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm" />
        </label>

        <label className="block">
          <span className="text-sm text-zinc-600">Phone</span>
          <input name="customerPhone" defaultValue={data.customerPhone} required className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm" />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-sm text-zinc-600">Start</span>
            <input type="datetime-local" name="startsAt" required value={startsAt}
                   onChange={(e) => setStartsAt(e.target.value)}
                   className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm" />
            <div className="mt-1 text-[11px] text-zinc-500">TZ: {timezone ?? "Local"}</div>
          </label>

          <label className="block">
            <span className="text-sm text-zinc-600">Duration (min)</span>
            <input type="number" name="durationMin" required min={10} step={5} value={duration}
                   onChange={(e) => setDuration(Number(e.target.value))}
                   className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm" />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-sm text-zinc-600">Staff</span>
            <select name="staffId" defaultValue={data.staffId} className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm">
              <option value="">(Unassigned)</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>

          <label className="block">
            <span className="text-sm text-zinc-600">Service</span>
            <select
              name="serviceId"
              defaultValue={data.serviceId}
              className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
              onChange={(e) => {
                const m = services.find((x) => x.id === e.target.value);
                if (m) setDuration(m.durationMin);
              }}
            >
              <option value="">(None)</option>
              {services.map((sv) => <option key={sv.id} value={sv.id}>{sv.name}</option>)}
            </select>
          </label>
        </div>

        <div className="flex items-center justify-between pt-2">
          <button
            formAction={async (fd: FormData) => {
              const res = await cancelBooking(fd);
              if (!res.ok) alert(res.error ?? "Failed to cancel"); else location.reload();
            }}
            className="text-sm text-red-600 hover:underline"
            name="id"
            value={data.id}
          >
            Cancel booking
          </button>

          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm hover:bg-zinc-50">Close</button>
            <button className="rounded-md bg-indigo-600 text-white px-3 py-1.5 text-sm hover:bg-indigo-500">Save</button>
          </div>
        </div>
      </form>
    </div>
  );
}
