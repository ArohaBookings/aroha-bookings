// app/calendar/ClientIslands.tsx
"use client";

/**
 * Aroha Bookings – Calendar Client Islands (stable build)
 * - Click empty slot → Create (prefilled).
 * - Double-click empty slot → Create (prefilled).
 * - Drag-to-create (press–drag–release) → Create with duration.
 * - Click existing block → Edit (never creates behind it).
 * - Drag existing block → persist time change on mouse-up.
 * - Resize existing block → persist duration on mouse-up.
 * - Option/Alt+drag → duplicate on drop (persists).
 * - Draft autosave (Create & Edit).
 * - Cancel button in Edit.
 * - Collision hint (same-staff overlap) on move/resize.
 */

import * as React from "react";
import { createBooking, updateBooking, cancelBooking, undoCancelBooking } from "./actions";
import { Badge, Button, Card } from "@/components/ui";


/* ───────────────────────── Types (mirror server) ───────────────────────── */
export type StaffRow = { id: string; name: string; active?: boolean; colorHex?: string };
export type ServiceRow = { id: string; name: string; durationMin: number; colorHex?: string; priceCents?: number };

export type Block = {
  id: string;
  top: number;            // px from column top
  height: number;         // px height
  title: string;
  subtitle: string;
  staffName: string;
  colorClass: string;     // Tailwind fallback color ring/bg
  bgHex?: string;         // explicit bg/border (optional)
  startsAt: string | Date;
  endsAt: string | Date;
  staffId: string | null;
  serviceId: string | null;
  _customerPhone?: string;
  _customerName?: string;
  _customerId?: string | null;
  _syncProvider?: string | null;
  _syncCalendarId?: string | null;
  _syncEventId?: string | null;
  _syncedAt?: string | null;
  _syncErrorMessage?: string | null;
  _syncErrorAt?: string | null;
};

export type ViewMode = "week" | "day";

/* ───────────────────────── Constants ───────────────────────── */
const SLOT_PX = 64;        // must match your grid’s CSS row height
const SLOT_MIN = 30;       // minutes per visual slot (keep in sync with server)
const MIN_DURATION = 10;   // guard against silly durations
const STORE = "__ar_cal_v3_";

/* ───────────────────────── Utils ───────────────────────── */
const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
const roundTo = (n: number, step: number) => Math.round(n / step) * step;
const toDate = (x: Date | string) => (x instanceof Date ? x : new Date(x));
const minutesBetween = (a: Date, b: Date) => Math.floor((b.getTime() - a.getTime()) / 60000);
const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);
const isoDateOnly = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const isValidLocal = (v: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v);
const safeUUID = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);

function normalizePhone(raw: string) {
  const t = (raw ?? "").trim();
  if (!t) return "";
  let s = t.replace(/[^\d+]/g, "");
  if (s && s[0] !== "+" && s[0] !== "0") s = "0" + s;
  return s;
}

function toast(msg: string, kind: "info" | "error" = "info") {
  try {
    const id = "__ar_toast";
    let root = document.getElementById(id);
    if (!root) {
      root = document.createElement("div");
      root.id = id;
      root.style.position = "fixed";
      root.style.bottom = "16px";
      root.style.left = "50%";
      root.style.transform = "translateX(-50%)";
      root.style.zIndex = "99999";
      document.body.appendChild(root);
    }
    const el = document.createElement("div");
    el.className =
      (kind === "error" ? "bg-red-600 text-white" : "bg-zinc-800 text-white") +
      " rounded px-3 py-2 mb-2 shadow";
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  } catch {}
}

function toastAction(label: string, actionLabel: string, onAction: () => void) {
  try {
    const id = "__ar_toast";
    let root = document.getElementById(id);
    if (!root) {
      root = document.createElement("div");
      root.id = id;
      root.style.position = "fixed";
      root.style.bottom = "16px";
      root.style.left = "50%";
      root.style.transform = "translateX(-50%)";
      root.style.zIndex = "99999";
      document.body.appendChild(root);
    }
    const el = document.createElement("div");
    el.className = "bg-zinc-900 text-white rounded px-3 py-2 mb-2 shadow flex items-center gap-3";
    const text = document.createElement("span");
    text.textContent = label;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = actionLabel;
    btn.className = "rounded bg-white/10 px-2 py-1 text-xs font-semibold hover:bg-white/20";
    btn.onclick = () => {
      onAction();
      el.remove();
    };
    el.appendChild(text);
    el.appendChild(btn);
    root.appendChild(el);
    setTimeout(() => el.remove(), 10000);
  } catch {}
}

function timeAgo(value?: string | null) {
  if (!value) return "—";
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return value;
  const diffSec = Math.floor((Date.now() - ts) / 1000);
  if (diffSec < 0) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}
/* ───── Draft helpers ───── */
type Draft = Record<string, string>;
const keyCreate = (dateISO: string) => `${STORE}draft_create_${dateISO}`;
const keyEdit = (id: string) => `${STORE}draft_edit_${id}`;
const loadDraft = (k: string): Draft | null => {
  try { const s = localStorage.getItem(k); return s ? (JSON.parse(s) as Draft) : null; } catch { return null; }
};
const saveDraft = (k: string, obj: Draft) => { try { localStorage.setItem(k, JSON.stringify(obj)); } catch {} };
const clearDraft = (k: string) => { try { localStorage.removeItem(k); } catch {} };

/* ───── Collision check (client hint only) ───── */
function overlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && aEnd > bStart;
}

/* ───────────────────────── Filters / Search / Export ───────────────────────── */
export function FiltersBar({
  orgTZ,
  activeTZ,
  staff,
  services,
  searchQuery,
  staffFilter,
  hrefBuilder,
  onExportCSV,
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
  appts?: Array<{
    startsAt: string | Date;
    endsAt: string | Date;
    customerName: string;
    customerPhone: string;
    staffId: string | null;
    serviceId: string | null;
  }>;
}) {
  const [q, setQ] = React.useState(searchQuery);
  const [staffSel, setStaffSel] = React.useState(staffFilter);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const navigate = (patch: Record<string, string>) => {
    const url = hrefBuilder
      ? hrefBuilder(patch)
      : (() => {
          const u = new URL(window.location.href);
          const p = u.searchParams;
          Object.entries(patch).forEach(([k, v]) => (v === "" ? p.delete(k) : p.set(k, v)));
          u.search = p.toString();
          return u.toString();
        })();
    window.location.href = url;
  };

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/") {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key.toLowerCase() === "n") {
        window.dispatchEvent(new CustomEvent("__ar_new_booking"));
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

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
        aria-label="Search appointments"
        className="w-44 md:w-56 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />

      <select
        value={staffSel}
        onChange={(e) => {
          const v = e.target.value;
          setStaffSel(v);
          navigate({ staff: v });
        }}
        aria-label="Filter by staff"
        className="rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm"
      >
        <option value="">All staff</option>
        {staff.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>

      <button
        onClick={() => navigate({ tz: activeTZ === "org" ? "local" : "org" })}
        className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm hover:bg-zinc-50"
        aria-label="Toggle timezone"
        title={`Switch timezone (current: ${activeTZ === "org" ? orgTZ : "Local"})`}
      >
        TZ: {activeTZ === "org" ? "Org" : "Local"}
      </button>

      <button
        onClick={() => (onExportCSV ? onExportCSV() : defaultCSVExport(appts, staff, services))}
        className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm hover:bg-zinc-50"
        aria-label="Export CSV"
      >
        Export CSV
      </button>
    </>
  );
}

function defaultCSVExport(
  appts: Array<{
    startsAt: string | Date;
    endsAt: string | Date;
    customerName: string;
    customerPhone: string;
    staffId: string | null;
    serviceId: string | null;
  }>,
  staff: StaffRow[],
  services: ServiceRow[]
) {
  const staffBy = Object.fromEntries(staff.map((s) => [s.id, s.name]));
  const svcBy = Object.fromEntries(services.map((s) => [s.id, s.name]));
  const rows = [
    ["When", "Ends", "Client", "Phone", "Staff", "Service"],
    ...appts.map((a) => [
      toDate(a.startsAt).toISOString(),
      toDate(a.endsAt).toISOString(),
      a.customerName,
      a.customerPhone,
      a.staffId ? staffBy[a.staffId] ?? "" : "",
      a.serviceId ? svcBy[a.serviceId] ?? "" : "",
    ]),
  ];
  const csv = rows.map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(",")).join("\n");
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

/* ───────────────────────── New booking button (N shortcut) ───────────────────────── */
export function NewBookingButton({
  staff,
  services,
  defaultDate,
}: {
  staff: StaffRow[];
  services: ServiceRow[];
  defaultDate: Date;
}) {
  const handleNew = React.useCallback(() => {
    openCreate({
      dateISO: isoDateOnly(defaultDate),
      minutesFromOpen: 9 * 60,
      slotMin: SLOT_MIN,
      staff: staff.map((s) => ({ id: s.id, name: s.name })),
      services: services.map((sv) => ({ id: sv.id, name: sv.name, durationMin: sv.durationMin })),
    });
  }, [defaultDate, staff, services]);

  React.useEffect(() => {
    const ev = () => handleNew();
    window.addEventListener("__ar_new_booking" as any, ev);
    return () => window.removeEventListener("__ar_new_booking" as any, ev);
  }, [handleNew]);

  return (
    <button
      type="button"
      onClick={handleNew}
      className="rounded-full bg-[color:var(--brand-primary)] text-white px-4 py-1.5 text-sm font-semibold shadow-sm shadow-emerald-500/30 hover:brightness-95"
    >
      + New booking
    </button>
  );
}

/* ───────────────────────── Grid Column (separate layers) ───────────────────────── */
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
  const totalHeight = gutterSlots * SLOT_PX;

  // background click → create at slot
  const onBackgroundClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("[data-block]")) return; // ignore clicks on blocks
    const el = colRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const y = clamp(e.clientY - rect.top, 0, totalHeight);
    const slotIndex = clamp(Math.round(y / SLOT_PX), 0, gutterSlots - 1);
    const minutesFromOpen = slotIndex * create.slotMin;
    openCreate({ ...create, minutesFromOpen });
  };

  // background dbl-click → create at slot
  const onBackgroundDblClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("[data-block]")) return;
    const el = colRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const y = clamp(e.clientY - rect.top, 0, totalHeight);
    const slotIndex = clamp(Math.floor(y / SLOT_PX), 0, gutterSlots - 1);
    const minutesFromOpen = slotIndex * create.slotMin;
    openCreate({ ...create, minutesFromOpen });
  };

  // drag-to-create marker state
  const dragState = React.useRef<{ startY: number; marker?: HTMLDivElement } | null>(null);

  const onBackgroundMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("[data-block]")) return; // don’t start create-drag on top of a block

    const el = colRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const startY = clamp(e.clientY - rect.top, 0, totalHeight);

    const marker = document.createElement("div");
    marker.style.position = "absolute";
    marker.style.left = "8px";
    marker.style.right = "8px";
    marker.style.top = `${startY}px`;
    marker.style.height = "0px";
    marker.style.border = "1px dashed rgba(99,102,241,0.7)";
    marker.style.background = "rgba(99,102,241,0.08)";
    marker.style.pointerEvents = "none";
    el.appendChild(marker);

    dragState.current = { startY, marker };

    const onMove = (ev: MouseEvent) => {
      const y = clamp(ev.clientY - rect.top, 0, totalHeight);
      const top = Math.min(startY, y);
      const height = Math.abs(y - startY);
      marker.style.top = `${top}px`;
      marker.style.height = `${height}px`;
    };

    const onUp = (ev: MouseEvent) => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);

      const ds = dragState.current;
      dragState.current = null;
      if (!ds) return;
      ds.marker?.remove();

      const y = clamp(ev.clientY - rect.top, 0, totalHeight);
      const top = Math.min(ds.startY, y);
      const height = Math.max(16, Math.abs(y - ds.startY));

      const topSlots = clamp(Math.round(top / SLOT_PX), 0, gutterSlots - 1);
      const heightSlots = Math.max(1, Math.round(height / SLOT_PX));
      const minutesFromOpen = topSlots * create.slotMin;
      const durationMin = Math.max(MIN_DURATION, heightSlots * create.slotMin);

      openCreate({ ...create, minutesFromOpen, slotMin: create.slotMin });
      window.dispatchEvent(new CustomEvent("__ar_set_duration_hint", { detail: { minutes: durationMin } }));
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  return (
    <div
      ref={colRef}
      className="relative border-l border-zinc-200 bg-white"
      style={{ height: totalHeight }}
      onClick={onBackgroundClick}
      onDoubleClick={onBackgroundDblClick}
      onMouseDown={onBackgroundMouseDown}
    >
      {/* grid lines */}
      <div className="absolute inset-0 pointer-events-none select-none">
        {Array.from({ length: gutterSlots }).map((_, i) => (
          <div
            key={i}
            className="border-b border-zinc-100/80"
            style={{ position: "absolute", left: 0, right: 0, top: i * SLOT_PX, height: 1 }}
          />
        ))}
      </div>

      {/* blocks layer */}
      <div className="absolute inset-0" style={{ pointerEvents: "none" }}>
        {blocks.map((b) => (
          <BookingBlock key={b.id} block={b} slotMin={create.slotMin} />
        ))}
      </div>
    </div>
  );
}

/* ───────────────────────── Booking Block ───────────────────────── */
function BookingBlock({ block, slotMin }: { block: Block; slotMin: number }) {
  const ref = React.useRef<HTMLButtonElement | null>(null);
  const [ghost, setGhost] = React.useState<{ top: number; height: number } | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [overlapHint, setOverlapHint] = React.useState(false);
  const [dupOnDrop, setDupOnDrop] = React.useState(false);

  const style: React.CSSProperties = {
    top: (ghost ? ghost.top : block.top) + "px",
    height: (ghost ? ghost.height : block.height) + "px",
    ...(block.bgHex ? { backgroundColor: block.bgHex, borderColor: block.bgHex } : {}),
  };

  // prevent background handlers hearing our events
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  async function persistMoveOrResize(newTop: number, newHeight: number) {
    setSaving(true);

    const origStart = toDate(block.startsAt);
    const origStartSlot = Math.round(block.top / SLOT_PX);
    // Determine which column (day) we're in based on the block's container
    const colEl = ref.current?.closest("[data-date]") as HTMLElement | null;
    const dateISO = colEl?.getAttribute("data-date");
    const baseDate = dateISO ? new Date(dateISO) : toDate(block.startsAt);

    // Compute the new time based on vertical movement within that day
    const newStartSlot = Math.round(newTop / SLOT_PX);
    const newStart = new Date(baseDate.getTime() + newStartSlot * slotMin * 60000);
    const newDurationSlots = Math.max(1, Math.round(newHeight / SLOT_PX));
    const newDurationMin = newDurationSlots * slotMin;

    try {
      if (dupOnDrop) {
        const fd = new FormData();
        fd.set("customerName", (block as any)._customerName ?? block.title);
        fd.set("customerPhone", normalizePhone((block as any)._customerPhone ?? ""));
        fd.set(
          "startsAt",
          `${newStart.getFullYear()}-${pad2(newStart.getMonth() + 1)}-${pad2(newStart.getDate())}T${pad2(
            newStart.getHours()
          )}:${pad2(newStart.getMinutes())}`
        );
        fd.set("durationMin", String(newDurationMin));
        fd.set("staffId", block.staffId ?? "");
        fd.set("serviceId", block.serviceId ?? "");
        fd.set("clientToken", safeUUID());
        const res = await createBooking(fd);
        if (!res.ok) throw new Error(res.error || "Duplicate failed");
      } else {
        const fd = new FormData();
        fd.set("id", block.id);
        fd.set(
          "startsAt",
          `${newStart.getFullYear()}-${pad2(newStart.getMonth() + 1)}-${pad2(newStart.getDate())}T${pad2(
            newStart.getHours()
          )}:${pad2(newStart.getMinutes())}`
        );
        fd.set("durationMin", String(newDurationMin));
        fd.set("staffId", block.staffId ?? "");
        fd.set("serviceId", block.serviceId ?? "");
        // keep server happy: always include name/phone too
        fd.set("customerName", (block as any)._customerName ?? block.title);
        fd.set("customerPhone", normalizePhone((block as any)._customerPhone ?? ""));
        const res = await updateBooking(fd);
        if (!res.ok) throw new Error(res.error || "Move/resize failed");
      }
      location.reload();
    } catch (err: any) {
      console.error(err);
      toast(err?.message ?? "Failed to save", "error");
      setGhost(null);
      setSaving(false);
    }
  }

  // drag move
  const onDragStart = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setDupOnDrop(e.altKey || e.metaKey);
    const root = ref.current?.parentElement?.parentElement as HTMLElement | null;
    if (!root) return;

    const startTop = ghost?.top ?? block.top;
    const startHeight = ghost?.height ?? block.height;
    const startY = e.clientY;

    const onMove = (ev: MouseEvent) => {
      const dy = ev.clientY - startY;
      const proposedTop = startTop + dy;
      const snappedTop = clamp(roundTo(proposedTop, SLOT_PX), 0, root.clientHeight - startHeight);
      setGhost({ top: snappedTop, height: startHeight });
      setOverlapHint(checkOverlapAt(snappedTop, startHeight));
      autoScroll(ev);
    };

    const onUp = async () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      const g = ghost;
      if (!g) return;
      await persistMoveOrResize(g.top, g.height);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  // resize
  const onResizeStart = (e: React.MouseEvent, edge: "top" | "bottom") => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const root = ref.current?.parentElement?.parentElement as HTMLElement | null;
    if (!root) return;

    const startTop = ghost?.top ?? block.top;
    const startHeight = ghost?.height ?? block.height;
    const startY = e.clientY;

    const onMove = (ev: MouseEvent) => {
      const dy = ev.clientY - startY;
      if (edge === "bottom") {
        let h = roundTo(startHeight + dy, SLOT_PX);
        h = clamp(h, SLOT_PX, root.clientHeight - startTop);
        setGhost({ top: startTop, height: h });
        setOverlapHint(checkOverlapAt(startTop, h));
      } else {
        let newTop = roundTo(startTop + dy, SLOT_PX);
        newTop = clamp(newTop, 0, startTop + startHeight - SLOT_PX);
        const delta = startTop - newTop;
        const newHeight = clamp(startHeight + delta, SLOT_PX, root.clientHeight - newTop);
        setGhost({ top: newTop, height: newHeight });
        setOverlapHint(checkOverlapAt(newTop, newHeight));
      }
      autoScroll(ev);
    };

    const onUp = async () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      const g = ghost;
      if (!g) return;
      await persistMoveOrResize(g.top, g.height);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  function checkOverlapAt(topPx: number, heightPx: number): boolean {
    try {
      const startSlot = Math.round(topPx / SLOT_PX);
      const durSlots = Math.max(1, Math.round(heightPx / SLOT_PX));
      const start = toDate(block.startsAt);
      const origStartSlot = Math.round(block.top / SLOT_PX);
      const deltaSlots = startSlot - origStartSlot;
      const moveStart = new Date(start.getTime() + deltaSlots * slotMin * 60000);
      const moveEnd = new Date(moveStart.getTime() + durSlots * slotMin * 60000);

      const els = Array.from(document.querySelectorAll("[data-block]")) as HTMLElement[];
      const peers = els
        .map((el) => JSON.parse(el.getAttribute("data-block-json") || "null") as Block | null)
        .filter(Boolean)
        .filter((b) => b!.id !== block.id && (b!.staffId ?? "") === (block.staffId ?? ""));

      return peers.some((b) => overlap(moveStart, moveEnd, toDate(b!.startsAt), toDate(b!.endsAt)));
    } catch {
      return false;
    }
  }

  function autoScroll(ev: MouseEvent) {
    const margin = 40;
    const speed = 14;
    if (ev.clientY < margin) window.scrollBy({ top: -speed });
    else if (window.innerHeight - ev.clientY < margin) window.scrollBy({ top: speed });
  }

  const openEditNow = () => {
    openEdit({
      id: block.id,
      startsAtISO: toDate(block.startsAt).toISOString().slice(0, 16),
      durationMin: Math.max(MIN_DURATION, minutesBetween(toDate(block.startsAt), toDate(block.endsAt))),
      staffId: block.staffId ?? "",
      serviceId: block.serviceId ?? "",
      customerName: (block as any)._customerName ?? block.title,
      customerPhone: (block as any)._customerPhone ?? "",
      customerId: (block as any)._customerId ?? null,
      syncProvider: (block as any)._syncProvider ?? null,
      syncCalendarId: (block as any)._syncCalendarId ?? null,
      syncEventId: (block as any)._syncEventId ?? null,
      syncedAt: (block as any)._syncedAt ?? null,
      syncErrorMessage: (block as any)._syncErrorMessage ?? null,
      syncErrorAt: (block as any)._syncErrorAt ?? null,
    });
  };

  return (
    <button
      ref={ref}
      data-block
      data-block-json={JSON.stringify(block)}
      type="button"
      onClick={(e) => {
        stop(e);
        openEditNow();
      }}
      onDoubleClick={(e) => {
        stop(e);
        openEditNow();
      }}
      onMouseDown={(e) => {
        stop(e);
        onDragStart(e);
      }}
      aria-label={`Booking for ${(block as any)._customerName ?? block.title}, ${block.subtitle}`}
      className={[
        "absolute left-2 right-2 rounded-lg px-2.5 py-1.5 text-[12px] leading-tight text-left overflow-hidden",
        "shadow-sm ring-1 ring-inset ring-black/5 transition hover:shadow-md",
        block.bgHex ? "text-zinc-900 ring-zinc-300" : "",
        !block.bgHex ? block.colorClass : "",
        "focus:outline-none focus:ring-2 focus:ring-emerald-400/50",
        "group",
      ].join(" ")}
      style={{ ...style, pointerEvents: "auto", cursor: saving ? "progress" : "grab" }}
      title={`${(block as any)._customerName ?? block.title} — ${block.subtitle}`}
    >
      <div className="font-medium truncate">{(block as any)._customerName ?? block.title}</div>
      <div className="text-[11px] opacity-80 truncate">{block.subtitle}</div>

      {/* resize handles */}
      <div
        className="absolute left-1 right-1 -top-1 h-2 cursor-ns-resize rounded opacity-0 group-hover:opacity-60 bg-zinc-700/10"
        onMouseDown={(e) => onResizeStart(e, "top")}
      />
      <div
        className="absolute left-1 right-1 -bottom-1 h-2 cursor-ns-resize rounded opacity-0 group-hover:opacity-60 bg-zinc-700/10"
        onMouseDown={(e) => onResizeStart(e, "bottom")}
      />

      {overlapHint && (
        <div className="absolute inset-x-0 bottom-1 text-[10px] text-amber-800 bg-amber-100 border border-amber-300 rounded px-1 py-[1px]">
          Overlaps another booking
        </div>
      )}
    </button>
  );
}

/* ───────────────────────── Modal plumbing ───────────────────────── */
declare global {
  interface Window {
    __ar_modal_v3?: (p: CreateProps | EditProps) => void;
  }
}
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
  startsAtISO: string; // yyyy-mm-ddTHH:mm
  durationMin: number;
  staffId: string;
  serviceId: string;
  customerName: string;
  customerPhone: string;
  customerId?: string | null;
  syncProvider?: string | null;
  syncCalendarId?: string | null;
  syncEventId?: string | null;
  syncedAt?: string | null;
  syncErrorMessage?: string | null;
  syncErrorAt?: string | null;
};

function openCreate(p: CreateProps) {
  if (typeof window !== "undefined" && window.__ar_modal_v3) window.__ar_modal_v3({ ...p, mode: "create" });
}
function openEdit(p: EditProps) {
  if (typeof window !== "undefined" && window.__ar_modal_v3) window.__ar_modal_v3({ ...p, mode: "edit" });
}

/* Focus trap hook (generic) */
function useFocusTrap<T extends HTMLElement>(onEscape: () => void) {
  const ref = React.useRef<T | null>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const focusables = el.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onEscape();
      if (e.key !== "Tab" || focusables.length === 0) return;

      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first) {
          e.preventDefault();
          last?.focus();
        }
      } else {
        if (active === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };

    first?.focus();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onEscape]);

  return ref;
}


/* ───────────────────────── EditBookingPortal (fixed for hook order) ───────────────────────── */
export function EditBookingPortal({
  staff,
  services,
  timezone,
}: {
  staff: StaffRow[];
  services: ServiceRow[];
  timezone?: string;
}) {
  const [state, setState] = React.useState<CreateProps | EditProps | null>(null);

  // Always call the hook — even if portal closed
  const trap = useFocusTrap<HTMLDivElement>(() => setState(null));

  React.useEffect(() => {
    window.__ar_modal_v3 = (props) => setState(props);
    return () => {
      if (window.__ar_modal_v3) delete window.__ar_modal_v3;
    };
  }, []);

  if (!state) return null;

  const onClose = () => setState(null);

  return (
    <div
      className="fixed inset-0 z-[999] bg-black/30 flex items-center justify-center p-4"
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div
        ref={trap}
        className="w-full max-w-md rounded-lg bg-white shadow-lg border border-zinc-200"
        role="dialog"
        aria-modal="true"
      >
        {"mode" in state && state.mode === "edit" ? (
          <EditForm
            key="edit"
            data={state as EditProps}
            onClose={onClose}
            staff={staff}
            services={services}
            timezone={timezone}
          />
        ) : (
          <CreateForm
            key="create"
            data={state as CreateProps}
            onClose={onClose}
            staff={staff}
            services={services}
            timezone={timezone}
          />
        )}
      </div>
    </div>
  );
}

/* ───────────────────────── Create Form ───────────────────────── */
function CreateForm({
  data,
  onClose,
  staff,
  services,
  timezone,
}: {
  data: CreateProps;
  onClose: () => void;
  staff: Array<{ id: string; name: string }>;
  services: Array<{ id: string; name: string; durationMin: number }>;
  timezone?: string;
}) {
  // focus trap ON THE FORM element — typed correctly
  const trapRef = useFocusTrap<HTMLFormElement>(onClose);

  const baseStart = `${data.dateISO}T${pad2(Math.floor(data.minutesFromOpen / 60))}:${pad2(
    data.minutesFromOpen % 60
  )}`;

  const [startsAt, setStartsAt] = React.useState<string>(baseStart);
  const [duration, setDuration] = React.useState<number>(services[0]?.durationMin ?? SLOT_MIN);
  const [name, setName] = React.useState<string>("");
  const [phone, setPhone] = React.useState<string>("");
  const [staffId, setStaffId] = React.useState<string>(staff.length === 1 ? staff[0].id : "");
  const [serviceId, setServiceId] = React.useState<string>("");
  const [dirty, setDirty] = React.useState<boolean>(false);
  const [saving, setSaving] = React.useState<boolean>(false);

  const dk = React.useMemo(() => keyCreate(data.dateISO), [data.dateISO]);

  React.useEffect(() => {
    const onHint = (ev: Event) => {
      const any = ev as CustomEvent<{ minutes?: number }>;
      const m = Number(any?.detail?.minutes ?? 0);
      if (m > 0) setDuration(m);
    };
    window.addEventListener("__ar_set_duration_hint" as any, onHint);
    return () => window.removeEventListener("__ar_set_duration_hint" as any, onHint);
  }, []);

  React.useEffect(() => {
    const d = loadDraft(dk);
    if (!d) return;
    if (d.startsAt) setStartsAt(d.startsAt);
    if (d.durationMin) setDuration(Number(d.durationMin));
    if (d.customerName) setName(d.customerName);
    if (d.customerPhone) setPhone(d.customerPhone);
    if (d.staffId) setStaffId(d.staffId);
    if (d.serviceId) setServiceId(d.serviceId);
  }, [dk]);

  React.useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => {
      saveDraft(dk, {
        startsAt,
        durationMin: String(duration),
        customerName: name,
        customerPhone: phone,
        staffId,
        serviceId,
      });
    }, 250);
    return () => clearTimeout(t);
  }, [dk, startsAt, duration, name, phone, staffId, serviceId, dirty]);

  return (
    <form
      ref={trapRef}
      action={async (fd: FormData) => {
        setSaving(true);

        const customerName = name.trim();
        const customerPhone = normalizePhone(phone);
        const start = startsAt || `${data.dateISO}T${pad2(Math.floor(data.minutesFromOpen / 60))}:${pad2(data.minutesFromOpen % 60)}`;
        const dur = Number(duration || 0);

        if (!customerName) { setSaving(false); return alert("Please enter the customer's name."); }
        if (!customerPhone) { setSaving(false); return alert("Please enter a phone number."); }
        if (!isValidLocal(start)) { setSaving(false); return alert("Start time is not valid."); }
        if (dur < MIN_DURATION) { setSaving(false); return alert(`Duration must be at least ${MIN_DURATION} minutes.`); }

        fd.set("customerName", customerName);
        fd.set("customerPhone", customerPhone);
        fd.set("startsAt", start);
        fd.set("durationMin", String(dur));
        fd.set("staffId", staffId || "");
        fd.set("serviceId", serviceId || "");
        fd.set("clientToken", safeUUID());

        const res = await createBooking(fd);
        setSaving(false);
        if (!res?.ok) return toast(res?.error ?? "Failed to create booking", "error");

        clearDraft(dk);
        location.reload();
      }}
      className="p-4 space-y-3"
      onChange={() => setDirty(true)}
    >
      <header className="font-semibold text-lg">New booking</header>

      <label className="block">
        <span className="text-sm text-zinc-600">Customer name</span>
        <input
          name="customerName"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
          placeholder="Jane Doe"
        />
      </label>

      <label className="block">
        <span className="text-sm text-zinc-600">Phone</span>
        <input
          name="customerPhone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
          className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
          placeholder="021 000 0000"
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-sm text-zinc-600">Start</span>
          <input
            type="datetime-local"
            name="startsAt"
            required
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
          <div className="mt-1 text-[11px] text-zinc-500">TZ: {timezone ?? "Local"}</div>
        </label>

        <label className="block">
          <span className="text-sm text-zinc-600">Duration (min)</span>
          <input
            type="number"
            name="durationMin"
            required
            min={MIN_DURATION}
            step={5}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
          <div className="mt-1 flex flex-wrap gap-1">
            {[15, 30, 45, 60, 90, 120].map((m) => (
              <button
                key={m}
                type="button"
                className={`text-[11px] px-2 py-0.5 rounded border ${
                  duration === m ? "border-indigo-500 text-indigo-600" : "border-zinc-300 text-zinc-600"
                }`}
                onClick={() => setDuration(m)}
              >
                {m}m
              </button>
            ))}
          </div>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-sm text-zinc-600">Staff</span>
          <select
            name="staffId"
            value={staffId}
            onChange={(e) => setStaffId(e.target.value)}
            className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
          >
            <option value="">(Unassigned)</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-sm text-zinc-600">Service</span>
          <select
            name="serviceId"
            value={serviceId}
            onChange={(e) => {
              setServiceId(e.target.value);
              const m = services.find((x) => x.id === e.target.value);
              if (m) setDuration(m.durationMin);
            }}
            className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
          >
            <option value="">(None)</option>
            {services.map((sv) => (
              <option key={sv.id} value={sv.id}>
                {sv.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex items-center justify-between pt-2">
        <div className="flex gap-2">
          {[30, 45, 60].map((m) => (
            <button
              key={m}
              type="button"
              className="text-[11px] px-2 py-0.5 rounded border border-zinc-300 text-zinc-600"
              onClick={() => setDuration(m)}
              title={`Set ${m}m`}
            >
              Set {m}m
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (!dirty || confirm("Discard this booking?")) {
                clearDraft(dk);
                onClose();
              }
            }}
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm hover:bg-zinc-50"
          >
            Close
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-indigo-600 text-white px-3 py-1.5 text-sm hover:bg-indigo-500 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Create & Save"}
          </button>
        </div>
      </div>
    </form>
  );
}

/* ───────────────────────── Edit Form ───────────────────────── */
function EditForm({
  data: rawData,
  onClose,
  staff,
  services,
  timezone,
}: {
  data: {
    id: string;
    startsAtISO: string;
    durationMin: number;
    staffId: string;
    serviceId: string;
    customerName: string;
    customerPhone: string;
  };
  onClose: () => void;
  staff: StaffRow[];
  services: ServiceRow[];
  timezone?: string;
}) {
  const data = rawData as {
    id: string;
    startsAtISO: string;
    durationMin: number;
    staffId: string;
    serviceId: string;
    customerName: string;
    customerPhone: string;
    customerId?: string | null;
    syncProvider?: string | null;
    syncCalendarId?: string | null;
    syncEventId?: string | null;
    syncedAt?: string | Date | null;
    syncErrorMessage?: string | null;
    syncErrorAt?: string | Date | null;
  };
  // Focus trap on container DIV (not the <form/>) to avoid ref type mismatch warnings
  const trapRef = useFocusTrap<HTMLDivElement>(onClose);

  const [startsAt, setStartsAt] = React.useState<string>(data.startsAtISO);
  const [duration, setDuration] = React.useState<number>(data.durationMin);
  const [name, setName] = React.useState<string>(data.customerName);
  const [phone, setPhone] = React.useState<string>(data.customerPhone);
  const [staffId, setStaffId] = React.useState<string>(data.staffId);
  const [serviceId, setServiceId] = React.useState<string>(data.serviceId);
  const [saving, setSaving] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  const [syncing, setSyncing] = React.useState(false);
  const [syncMsg, setSyncMsg] = React.useState<string | null>(null);
  const [dryRunMsg, setDryRunMsg] = React.useState<string | null>(null);
  const [timeline, setTimeline] = React.useState<
    | {
        summary: string;
        summaryAI?: boolean;
        items: Array<{ type: string; at: string; detail: string }>;
      }
    | null
  >(null);
  const [timelineBusy, setTimelineBusy] = React.useState(false);
  const [customerTimeline, setCustomerTimeline] = React.useState<
    | {
        items: Array<{ type: string; at: string; detail: string }>;
      }
    | null
  >(null);
  const [customerTimelineBusy, setCustomerTimelineBusy] = React.useState(false);
  const [signals, setSignals] = React.useState<{
    summary?: string;
    noShowCount?: number;
    cancellationCount?: number;
    totalVisits?: number;
    preferredTimeWindow?: string;
    lastVisit?: string | null;
    guardrailSummary?: string;
    suggestedGuardrails?: Array<{ type: string; label: string; payload: Record<string, unknown> }>;
    activeGuardrails?: Record<string, unknown> | null;
    flags?: Array<{ type: string; label: string }>;
  } | null>(null);
  const [signalsBusy, setSignalsBusy] = React.useState(false);
  const [guardrailMsg, setGuardrailMsg] = React.useState<string | null>(null);
  const [optimizer, setOptimizer] = React.useState<{
    summary?: string;
    ai?: boolean;
    suggestions?: Array<{ title: string; detail: string }>;
  } | null>(null);
  const [optimizerBusy, setOptimizerBusy] = React.useState(false);

  const dk = React.useMemo(() => keyEdit(data.id), [data.id]);

  React.useEffect(() => {
    const d = loadDraft(dk);
    if (!d) return;
    if (d.startsAt) setStartsAt(d.startsAt);
    if (d.durationMin) setDuration(Number(d.durationMin));
    if (d.customerName) setName(d.customerName);
    if (d.customerPhone) setPhone(d.customerPhone);
    if (d.staffId) setStaffId(d.staffId);
    if (d.serviceId) setServiceId(d.serviceId);
  }, [dk]);

  React.useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => {
      saveDraft(dk, {
        startsAt,
        durationMin: String(duration),
        customerName: name,
        customerPhone: phone,
        staffId,
        serviceId,
      });
    }, 250);
    return () => clearTimeout(t);
  }, [dk, startsAt, duration, name, phone, staffId, serviceId, dirty]);

  function bumpStart(minutes: number) {
    const dt = new Date(startsAt);
    const n = new Date(dt.getTime() + minutes * 60000);
    const s = `${n.getFullYear()}-${pad2(n.getMonth() + 1)}-${pad2(n.getDate())}T${pad2(n.getHours())}:${pad2(
      n.getMinutes()
    )}`;
    setStartsAt(s);
    setDirty(true);
  }

  async function doUpdate(fd: FormData) {
    const res = await updateBooking(fd);
    if (!res.ok) {
      toast(res.error ?? "Failed to update booking", "error");
      return false;
    }
    clearDraft(dk);
    return true;
  }

  return (
    <div ref={trapRef} className="p-4 space-y-3">
      <header className="font-semibold text-lg">Edit booking</header>

      <form
        action={async (fd: FormData) => {
          setSaving(true);

          fd.set("id", data.id);
          fd.set("customerName", name.trim());
          fd.set("customerPhone", normalizePhone(phone));
          fd.set("startsAt", startsAt);
          fd.set("durationMin", String(duration));
          fd.set("staffId", staffId || "");
          fd.set("serviceId", serviceId || "");

          if (!name.trim()) { setSaving(false); return alert("Please enter the customer's name."); }
          if (!phone.trim()) { setSaving(false); return alert("Please enter a phone number."); }
          if (!isValidLocal(startsAt)) { setSaving(false); return alert("Start time is not valid."); }
          if (duration < MIN_DURATION) { setSaving(false); return alert(`Duration must be at least ${MIN_DURATION} minutes.`); }

          const ok = await doUpdate(fd);
          setSaving(false);
          if (ok) location.reload();
        }}
        className="space-y-3"
        onChange={() => setDirty(true)}
      >
        <input type="hidden" name="id" value={data.id} />

        <label className="block">
          <span className="text-sm text-zinc-600">Customer name</span>
          <input
            name="customerName"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
        </label>

        <label className="block">
          <span className="text-sm text-zinc-600">Phone</span>
          <input
            name="customerPhone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
            className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-sm text-zinc-600">Start</span>
            <input
              type="datetime-local"
              name="startsAt"
              required
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
            />
            <div className="mt-1 text-[11px] text-zinc-500">TZ: {timezone ?? "Local"}</div>

            <div className="mt-2 flex flex-wrap gap-1">
              {[-60, -30, -15, +15, +30, +60].map((m) => (
                <button
                  key={m}
                  type="button"
                  className="text-[11px] px-2 py-0.5 rounded border border-zinc-300 text-zinc-600"
                  onClick={() => bumpStart(m)}
                  title={`Shift ${m > 0 ? "+" : ""}${m}m`}
                >
                  {m > 0 ? `+${m}m` : `${m}m`}
                </button>
              ))}
            </div>
          </label>

          <label className="block">
            <span className="text-sm text-zinc-600">Duration (min)</span>
            <input
              type="number"
              name="durationMin"
              required
              min={MIN_DURATION}
              step={5}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
            />
            <div className="mt-1 flex flex-wrap gap-1">
              {[15, 30, 45, 60, 90, 120].map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`text-[11px] px-2 py-0.5 rounded border ${
                    duration === m ? "border-indigo-500 text-indigo-600" : "border-zinc-300 text-zinc-600"
                  }`}
                  onClick={() => setDuration(m)}
                >
                  {m}m
                </button>
              ))}
            </div>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-sm text-zinc-600">Staff</span>
            <select
              name="staffId"
              value={staffId}
              onChange={(e) => setStaffId(e.target.value)}
              className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
            >
              <option value="">(Unassigned)</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-sm text-zinc-600">Service</span>
            <select
              name="serviceId"
              value={serviceId}
              onChange={(e) => {
                setServiceId(e.target.value);
                const m = services.find((x) => x.id === e.target.value);
                if (m) setDuration(m.durationMin);
              }}
              className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
            >
              <option value="">(None)</option>
              {services.map((sv) => (
                <option key={sv.id} value={sv.id}>
                  {sv.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <Card className="bg-zinc-50 p-3 text-xs text-zinc-600">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-zinc-700">Sync status</span>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                type="button"
                disabled={syncing}
                onClick={async () => {
                  setSyncing(true);
                  setSyncMsg(null);
                  try {
                    const res = await fetch(`/api/org/appointments/${data.id}/sync`, { method: "POST" });
                    const json = await res.json();
                    if (!res.ok || !json.ok) {
                      setSyncMsg(json.error || "Sync failed");
                    } else {
                      setSyncMsg("Retry scheduled");
                    }
                  } catch {
                    setSyncMsg("Sync failed");
                  } finally {
                    setSyncing(false);
                  }
                }}
                className="px-2 py-1 text-[11px]"
              >
                {syncing ? "Syncing…" : "Retry sync"}
              </Button>
              <Button
                variant="secondary"
                type="button"
                onClick={async () => {
                  setDryRunMsg(null);
                  try {
                    const res = await fetch(`/api/org/appointments/${data.id}/dry-run-sync`);
                    const json = await res.json();
                    if (!res.ok || !json.ok) {
                      setDryRunMsg(json.error || "Dry-run failed");
                    } else {
                      setDryRunMsg(`${json.action}: ${json.reason}`);
                    }
                  } catch {
                    setDryRunMsg("Dry-run failed");
                  }
                }}
                className="px-2 py-1 text-[11px]"
              >
                Dry-run
              </Button>
            </div>
          </div>
          <div className="mt-1 space-y-1">
            <div>
              Provider: <span className="font-medium">{data.syncProvider || "Not linked"}</span>
            </div>
            <div>
              Calendar: <span className="font-medium">{data.syncCalendarId || "—"}</span>
            </div>
            <div>
              Event: <span className="font-medium">{data.syncEventId || "—"}</span>
            </div>
            <div>
              Last synced:{" "}
              <span className="font-medium">
                {data.syncedAt
                  ? `${timeAgo(
                      data.syncedAt instanceof Date ? data.syncedAt.toISOString() : data.syncedAt
                    )} (${new Date(data.syncedAt).toLocaleString()})`
                  : "—"}
              </span>
            </div>
            {data.syncErrorMessage ? (
              <div className="text-red-600">
                Error: {data.syncErrorMessage}
                {data.syncErrorAt ? ` (${new Date(data.syncErrorAt).toLocaleString()})` : ""}
              </div>
            ) : null}
            {syncMsg ? <div className="text-zinc-500">{syncMsg}</div> : null}
            {dryRunMsg ? <div className="text-zinc-500">Dry-run: {dryRunMsg}</div> : null}
          </div>
        </Card>

        <Card className="p-3 text-xs text-zinc-700">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-zinc-700">Appointment timeline</span>
            <Button
              variant="secondary"
              type="button"
              disabled={timelineBusy}
              onClick={async () => {
                setTimelineBusy(true);
                try {
                  const res = await fetch(`/api/org/appointments/${data.id}/timeline`);
                  const json = await res.json();
                  if (!res.ok || !json.ok) {
                    setTimeline({ summary: json.error || "Failed to load timeline.", items: [] });
                  } else {
                    setTimeline({
                      summary: json.summary || "Timeline loaded.",
                      summaryAI: json.summaryAI,
                      items: json.timeline || [],
                    });
                  }
                } finally {
                  setTimelineBusy(false);
                }
              }}
              className="px-2 py-1 text-[11px]"
            >
              {timelineBusy ? "Loading…" : "Load"}
            </Button>
          </div>
          {timeline ? (
            <div className="mt-2 space-y-2">
              <div className="text-[11px] text-zinc-500">
                {timeline.summary}
                {timeline.summaryAI ? " (AI summary from org activity)" : ""}
              </div>
              <div className="space-y-1">
                {timeline.items.map((item) => (
                  <div key={`${item.type}-${item.at}`} className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1">
                    <div className="text-[11px] font-semibold">{item.type.replace("_", " ")}</div>
                    <div className="text-[11px] text-zinc-500">{new Date(item.at).toLocaleString()}</div>
                    <div className="text-[11px]">{item.detail}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="mt-2 text-[11px] text-zinc-500">Load to see the booking timeline.</div>
          )}
        </Card>

        <Card className="p-3 text-xs text-zinc-700">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-zinc-700">Customer timeline</span>
            <Button
              variant="secondary"
              type="button"
              disabled={customerTimelineBusy || !data.customerPhone}
              onClick={async () => {
                if (!data.customerPhone) return;
                setCustomerTimelineBusy(true);
                try {
                  const res = await fetch(
                    `/api/org/clients/timeline?phone=${encodeURIComponent(data.customerPhone)}`
                  );
                  const json = await res.json();
                  if (!res.ok || !json.ok) {
                    setCustomerTimeline({ items: [] });
                  } else {
                    setCustomerTimeline({
                      items: json.timeline?.events || [],
                    });
                  }
                } finally {
                  setCustomerTimelineBusy(false);
                }
              }}
              className="px-2 py-1 text-[11px]"
            >
              {customerTimelineBusy ? "Loading…" : "Load"}
            </Button>
          </div>
          {customerTimeline ? (
            <div className="mt-2 space-y-1">
              {customerTimeline.items.length ? (
                customerTimeline.items.slice(-6).map((item) => (
                  <div key={`${item.type}-${item.at}`} className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1">
                    <div className="text-[11px] font-semibold">{item.type.replace(/_/g, " ")}</div>
                    <div className="text-[11px] text-zinc-500">{new Date(item.at).toLocaleString()}</div>
                    <div className="text-[11px]">{item.detail}</div>
                  </div>
                ))
              ) : (
                <div className="text-[11px] text-zinc-500">No customer activity yet.</div>
              )}
            </div>
          ) : (
            <div className="mt-2 text-[11px] text-zinc-500">Load to see the customer timeline.</div>
          )}
        </Card>

        <Card className="p-3 text-xs text-zinc-700">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-zinc-700">Client signals</span>
            <Button
              variant="secondary"
              type="button"
              disabled={signalsBusy || !data.customerId}
              onClick={async () => {
                if (!data.customerId) return;
                setSignalsBusy(true);
                setGuardrailMsg(null);
                try {
                  const res = await fetch(`/api/org/clients/${data.customerId}/signals`);
                  const json = await res.json();
                  if (!res.ok || !json.ok) {
                    setSignals({ summary: json.error || "Failed to load signals." });
                    return;
                  }
                  setSignals({
                    summary: json.summary,
                    noShowCount: json.signals?.noShowCount,
                    cancellationCount: json.signals?.cancellationCount,
                    totalVisits: json.signals?.totalVisits,
                    preferredTimeWindow: json.signals?.preferredTimeWindow,
                    lastVisit: json.signals?.lastVisit,
                    guardrailSummary: json.guardrailSummary || "",
                    suggestedGuardrails: json.suggestedGuardrails || [],
                    activeGuardrails: json.activeGuardrails || null,
                    flags: json.flags || [],
                  });
                } finally {
                  setSignalsBusy(false);
                }
              }}
              className="px-2 py-1 text-[11px]"
            >
              {signalsBusy ? "Loading…" : "Load"}
            </Button>
          </div>
          {!data.customerId ? (
            <p className="mt-2 text-[11px] text-zinc-500">No linked customer record yet.</p>
          ) : signals ? (
            <div className="mt-2 space-y-2">
              {signals.summary ? <p>{signals.summary}</p> : null}
              <div className="text-[11px] text-zinc-500">
                Visits: {signals.totalVisits ?? "—"} · No-shows: {signals.noShowCount ?? "—"} · Preferred:{" "}
                {signals.preferredTimeWindow ?? "—"}
              </div>
              {signals.flags?.length ? (
                <div className="flex flex-wrap gap-1">
                  {signals.flags.map((flag) => (
                    <span
                      key={flag.type}
                      className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-700"
                    >
                      {flag.label}
                    </span>
                  ))}
                </div>
              ) : null}
              {signals.lastVisit ? (
                <div className="text-[11px] text-zinc-500">
                  Last visit: {new Date(signals.lastVisit).toLocaleString()}
                </div>
              ) : null}
              {signals.guardrailSummary ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
                  {signals.guardrailSummary}
                </div>
              ) : null}
              {signals.activeGuardrails ? (
                <div className="text-[11px] text-emerald-700">
                  Active guardrails: {Object.keys(signals.activeGuardrails).length}
                </div>
              ) : null}
              {signals.suggestedGuardrails?.length ? (
                <div className="space-y-1">
                  {signals.suggestedGuardrails.map((g) => (
                    <div key={g.type} className="flex items-center justify-between rounded-md border border-zinc-200 px-2 py-1">
                      <span>{g.label}</span>
                      <Button
                        variant="secondary"
                        type="button"
                        onClick={async () => {
                          if (!data.customerId) return;
                          setGuardrailMsg(null);
                          const res = await fetch(`/api/org/clients/${data.customerId}/guardrails`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ guardrail: g.payload }),
                          });
                          const json = await res.json();
                          if (!res.ok || !json.ok) {
                            setGuardrailMsg(json.error || "Failed to apply guardrail.");
                          } else {
                            setGuardrailMsg("Guardrail saved.");
                          }
                        }}
                        className="px-2 py-0.5 text-[11px]"
                      >
                        Apply
                      </Button>
                    </div>
                  ))}
                </div>
              ) : null}
              {guardrailMsg ? <div className="text-[11px] text-zinc-500">{guardrailMsg}</div> : null}
            </div>
          ) : (
            <p className="mt-2 text-[11px] text-zinc-500">Load signals to see insights.</p>
          )}
        </Card>

        <Card className="p-3 text-xs text-zinc-700">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-zinc-700">Scheduling optimizer</span>
            <Button
              variant="secondary"
              type="button"
              disabled={optimizerBusy}
              onClick={async () => {
                setOptimizerBusy(true);
                try {
                  const res = await fetch(`/api/org/appointments/${data.id}/suggest`);
                  const json = await res.json();
                  if (!res.ok || !json.ok) {
                    setOptimizer({ summary: json.error || "Failed to load suggestions." });
                    return;
                  }
                  setOptimizer({
                    summary: json.summary,
                    ai: json.ai,
                    suggestions: json.suggestions || [],
                  });
                } finally {
                  setOptimizerBusy(false);
                }
              }}
              className="px-2 py-1 text-[11px]"
            >
              {optimizerBusy ? "Loading…" : "Load"}
            </Button>
          </div>
          {optimizer ? (
            <div className="mt-2 space-y-2">
              {optimizer.summary ? (
                <div className="text-[11px] text-zinc-500">
                  {optimizer.summary}
                  {optimizer.ai ? " (AI summary)" : ""}
                </div>
              ) : null}
              {optimizer.suggestions?.map((s) => (
                <div key={s.title} className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1">
                  <div className="text-[11px] font-semibold">{s.title}</div>
                  <div className="text-[11px] text-zinc-500">{s.detail}</div>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-[11px] text-zinc-500">Load to see optimization ideas.</p>
          )}
        </Card>

        <div className="flex items-center justify-between pt-2">
          <div className="flex items-center gap-3">
            <Button
              id="__ar_cancel_btn"
              variant="destructive"
              type="button"
              onClick={async () => {
                if (!confirm("Cancel this booking?")) return;
                const fd = new FormData();
                fd.set("id", data.id);
                const res = await cancelBooking(fd);
                if (!res?.ok) return toast(res?.error ?? "Failed to cancel", "error");
                clearDraft(dk);
                const reloadTimer = window.setTimeout(() => location.reload(), 8000);
                toastAction("Booking cancelled.", "Undo", async () => {
                  window.clearTimeout(reloadTimer);
                  const undo = await undoCancelBooking(data.id, 10);
                  if (!undo?.ok) return toast(undo?.error ?? "Undo failed", "error");
                  toast("Cancellation undone.");
                  location.reload();
                });
              }}
              className="text-sm px-3 py-1"
              title="Cancel booking"
            >
              Cancel booking
            </Button>

            <Button
              variant="secondary"
              type="button"
              className="text-sm px-3 py-1"
              title="Duplicate booking +30m"
              onClick={async () => {
                const start = new Date(startsAt);
                const dupStart = new Date(start.getTime() + 30 * 60000);
                const s = `${dupStart.getFullYear()}-${pad2(dupStart.getMonth() + 1)}-${pad2(
                  dupStart.getDate()
                )}T${pad2(dupStart.getHours())}:${pad2(dupStart.getMinutes())}`;
                const fd = new FormData();
                fd.set("customerName", name.trim());
                fd.set("customerPhone", normalizePhone(phone));
                fd.set("startsAt", s);
                fd.set("durationMin", String(duration));
                fd.set("staffId", staffId || "");
                fd.set("serviceId", serviceId || "");
                fd.set("clientToken", safeUUID());
                const res = await createBooking(fd);
                if (!res.ok) return toast(res.error ?? "Failed to duplicate", "error");
                location.reload();
              }}
            >
              Duplicate
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              type="button"
              onClick={() => {
                // keep draft so user can return later
                onClose();
              }}
              className="text-sm"
            >
              Close
            </Button>
            <Button
              type="submit"
              disabled={saving}
              className="text-sm"
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}

/* ───────────────────────── End exports ───────────────────────── */
// Exported above: FiltersBar, NewBookingButton, GridColumn, EditBookingPortal
// Exported types: StaffRow, ServiceRow, Block
