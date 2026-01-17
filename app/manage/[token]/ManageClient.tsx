"use client";

import React from "react";
import Skeleton from "@/components/Skeleton";
import { Badge, Button, Card, EmptyState, Input } from "@/components/ui";

type Slot = { start: string; end: string; staffId?: string | null };

type ManageProps = {
  token: string;
  org: { name: string; slug: string; timezone: string };
  appointment: {
    id: string;
    startsAt: string;
    endsAt: string;
    status: "SCHEDULED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
    customerName: string;
    customerPhone: string;
    customerEmail: string | null;
    staffId: string | null;
    staffName: string | null;
    serviceId: string | null;
    serviceName: string | null;
  };
};

const PRESETS = [
  { label: "Next 7 days", days: 7 },
  { label: "Next 14 days", days: 14 },
  { label: "Next 30 days", days: 30 },
] as const;

function dateKeyInTZ(iso: string, tz: string) {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function fmtDayLabel(dateKey: string, tz: string) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const safe = new Date(Date.UTC(y, (m || 1) - 1, d || 1, 12));
  return new Intl.DateTimeFormat("en-NZ", {
    timeZone: tz,
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).format(safe);
}

function fmtTime(iso: string, tz: string) {
  return new Intl.DateTimeFormat("en-NZ", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function toInputDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function addDays(dateKey: string, days: number) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const base = new Date(Date.UTC(y, (m || 1) - 1, d || 1, 12));
  base.setUTCDate(base.getUTCDate() + days);
  return toInputDate(base);
}

export default function ManageClient({ token, org, appointment }: ManageProps) {
  const todayKey = dateKeyInTZ(new Date().toISOString(), org.timezone);
  const [fromDate, setFromDate] = React.useState(todayKey);
  const [toDate, setToDate] = React.useState(addDays(todayKey, 14));
  const [selectedDate, setSelectedDate] = React.useState(todayKey);
  const [slots, setSlots] = React.useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = React.useState(false);
  const [slotError, setSlotError] = React.useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = React.useState<Slot | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [status, setStatus] = React.useState(appointment.status);
  const [currentStart, setCurrentStart] = React.useState(appointment.startsAt);
  const [currentEnd, setCurrentEnd] = React.useState(appointment.endsAt);
  const [honeypot, setHoneypot] = React.useState("");

  const canModify = status === "SCHEDULED" || status === "NO_SHOW";

  React.useEffect(() => {
    if (!appointment.serviceId) {
      setSlotError("This booking cannot be rescheduled online.");
      return;
    }
    let alive = true;
    setLoadingSlots(true);
    setSlotError(null);
    setSelectedSlot(null);
    fetch(
      `/api/public/availability?orgSlug=${encodeURIComponent(org.slug)}&from=${encodeURIComponent(
        fromDate
      )}&to=${encodeURIComponent(toDate)}&serviceId=${encodeURIComponent(appointment.serviceId)}${
        appointment.staffId ? `&staffId=${encodeURIComponent(appointment.staffId)}` : ""
      }`
    )
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!alive) return;
        if (!ok || !data.ok) {
          setSlotError(data.error || "Failed to load availability.");
          setSlots([]);
          return;
        }
        setSlots(data.slots || []);
      })
      .catch(() => {
        if (!alive) return;
        setSlotError("Failed to load availability.");
      })
      .finally(() => {
        if (alive) setLoadingSlots(false);
      });

    return () => {
      alive = false;
    };
  }, [fromDate, toDate, appointment.serviceId, appointment.staffId, org.slug]);

  const slotsByDate = React.useMemo(() => {
    const map = new Map<string, Slot[]>();
    slots.forEach((s) => {
      const d = dateKeyInTZ(s.start, org.timezone);
      const list = map.get(d) ?? [];
      list.push(s);
      map.set(d, list);
    });
    return map;
  }, [slots, org.timezone]);

  const datesWithSlots = React.useMemo(() => Array.from(slotsByDate.keys()).sort(), [slotsByDate]);
  const daySlots = slotsByDate.get(selectedDate) ?? [];

  function selectPreset(days: number) {
    setFromDate(todayKey);
    setToDate(addDays(todayKey, days));
    setSelectedDate(todayKey);
  }

  async function handleReschedule() {
    if (!selectedSlot) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/manage/${encodeURIComponent(token)}/reschedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startISO: selectedSlot.start,
          honeypot,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        alert(data.error || "Could not reschedule booking.");
        return;
      }
      setCurrentStart(data.startsAt);
      setCurrentEnd(data.endsAt);
      setSelectedSlot(null);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel() {
    if (!confirm("Cancel this booking?")) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/manage/${encodeURIComponent(token)}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ honeypot }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        alert(data.error || "Could not cancel booking.");
        return;
      }
      setStatus("CANCELLED");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-zinc-900">Manage booking</h1>
            <p className="text-sm text-zinc-600 mt-1">{org.name}</p>
          </div>
          <div className="text-xs text-zinc-500">
            {org.timezone}
          </div>
        </div>
      </header>

      <section className="max-w-5xl mx-auto px-6 py-8 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-6">
          <Card className="p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Current booking</p>
                <h2 className="mt-2 text-lg font-semibold text-zinc-900">
                  {appointment.serviceName ?? "Appointment"}
                </h2>
                <p className="text-sm text-zinc-600 mt-1">
                  {appointment.staffName ? `with ${appointment.staffName}` : "Staff to be assigned"}
                </p>
              </div>
              <Badge
                variant={
                  status === "CANCELLED"
                    ? "warning"
                    : status === "COMPLETED"
                    ? "success"
                    : status === "NO_SHOW"
                    ? "warning"
                    : "info"
                }
              >
                {status.replace("_", " ")}
              </Badge>
            </div>
            <div className="mt-4 grid gap-3 text-sm text-zinc-700">
              <div className="flex items-center justify-between">
                <span>Date</span>
                <span className="font-medium">
                  {fmtDayLabel(dateKeyInTZ(currentStart, org.timezone), org.timezone)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Time</span>
                <span className="font-medium">
                  {fmtTime(currentStart, org.timezone)} – {fmtTime(currentEnd, org.timezone)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Booked for</span>
                <span className="font-medium">{appointment.customerName}</span>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                variant="destructive"
                type="button"
                disabled={!canModify || submitting}
                onClick={handleCancel}
              >
                Cancel booking
              </Button>
              <Input
                value={honeypot}
                onChange={(e) => setHoneypot(e.target.value)}
                className="hidden"
                aria-hidden="true"
                tabIndex={-1}
                autoComplete="off"
              />
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Reschedule</p>
                <h3 className="mt-2 text-lg font-semibold text-zinc-900">Pick a new time</h3>
                <p className="text-sm text-zinc-600 mt-1">Times shown in {org.timezone}.</p>
              </div>
            </div>

            {!appointment.serviceId ? (
              <p className="mt-4 text-sm text-zinc-600">This booking can’t be rescheduled online.</p>
            ) : (
              <>
                <div className="mt-4 flex flex-wrap gap-2">
                  {PRESETS.map((p) => (
                    <Button
                      variant="secondary"
                      key={p.label}
                      type="button"
                      onClick={() => selectPreset(p.days)}
                      className="rounded-full px-3 py-1 text-xs"
                    >
                      {p.label}
                    </Button>
                  ))}
                </div>

                <div className="mt-4 grid gap-4 lg:grid-cols-[200px_1fr]">
                  <div className="space-y-2">
                    {loadingSlots ? (
                      <div className="grid gap-2">
                        {Array.from({ length: 5 }).map((_, idx) => (
                          <Skeleton key={idx} className="h-10 rounded-lg" />
                        ))}
                      </div>
                    ) : slotError ? (
                      <div className="text-sm text-red-600">{slotError}</div>
                    ) : datesWithSlots.length === 0 ? (
                      <EmptyState title="No available dates" body="Try expanding the range or check back later." />
                    ) : (
                      datesWithSlots.map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setSelectedDate(d)}
                          className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                            selectedDate === d
                              ? "border-black bg-black text-white"
                              : "border-zinc-200 text-zinc-700 hover:border-zinc-400"
                          }`}
                        >
                          {fmtDayLabel(d, org.timezone)}
                        </button>
                      ))
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {loadingSlots
                      ? Array.from({ length: 6 }).map((_, idx) => (
                          <Skeleton key={idx} className="h-10 rounded-xl" />
                        ))
                      : daySlots.map((slot) => (
                          <button
                            key={slot.start}
                            type="button"
                            onClick={() => setSelectedSlot(slot)}
                            className={`rounded-xl border px-3 py-2 text-sm ${
                              selectedSlot?.start === slot.start
                                ? "border-indigo-600 bg-indigo-600 text-white"
                                : "border-zinc-200 text-zinc-700 hover:border-zinc-400"
                            }`}
                          >
                            {fmtTime(slot.start, org.timezone)}
                          </button>
                        ))}
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between">
                  <p className="text-xs text-zinc-500">
                    {selectedSlot
                      ? `Selected ${fmtDayLabel(dateKeyInTZ(selectedSlot.start, org.timezone), org.timezone)} at ${fmtTime(
                          selectedSlot.start,
                          org.timezone
                        )}`
                      : "Select a time to continue."}
                  </p>
                  <Button
                    type="button"
                    disabled={!selectedSlot || submitting || !canModify}
                    onClick={handleReschedule}
                  >
                    {submitting ? "Saving…" : "Confirm new time"}
                  </Button>
                </div>
              </>
            )}
          </Card>
        </div>

        <Card className="p-6 h-fit">
          <h3 className="text-sm font-semibold text-zinc-900">Need help?</h3>
          <p className="mt-2 text-sm text-zinc-600">
            If you can’t find a time that works, please contact the business directly.
          </p>
        </Card>
      </section>
    </main>
  );
}
