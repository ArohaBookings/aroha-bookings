"use client";

import React from "react";
import { Badge, Button, Card, EmptyState } from "@/components/ui";

type ApptRow = {
  id: string;
  startsAt: string;
  endsAt: string;
  customerName: string;
  customerPhone: string;
  serviceName: string | null;
  status: "SCHEDULED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
};

type StaffHomeProps = {
  orgName: string;
  timezone: string;
  staffName: string;
  appointments: ApptRow[];
};

function fmtTime(iso: string, tz: string) {
  return new Intl.DateTimeFormat("en-NZ", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function fmtDate(iso: string, tz: string) {
  return new Intl.DateTimeFormat("en-NZ", {
    timeZone: tz,
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).format(new Date(iso));
}

export default function StaffHomeClient({ orgName, timezone, staffName, appointments }: StaffHomeProps) {
  const [rows, setRows] = React.useState(appointments);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  async function updateStatus(id: string, status: ApptRow["status"]) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/org/appointments/${id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        alert(data.error || "Failed to update status.");
        return;
      }
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
    } finally {
      setBusyId(null);
    }
  }

  async function reschedule(id: string) {
    const next = prompt("Enter new start time (YYYY-MM-DDTHH:MM):");
    if (!next) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/org/appointments/${id}/reschedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startISO: next }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        alert(data.error || "Failed to reschedule.");
        return;
      }
      setRows((prev) =>
        prev.map((r) =>
          r.id === id ? { ...r, startsAt: data.startsAt, endsAt: data.endsAt } : r
        )
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="min-h-screen bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-6 py-5">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Staff portal</p>
          <div className="flex items-center justify-between mt-2">
            <div>
              <h1 className="text-2xl font-semibold text-zinc-900">Today</h1>
              <p className="text-sm text-zinc-600">
                {orgName} · {staffName}
              </p>
            </div>
            <span className="text-xs text-zinc-500">{timezone}</span>
          </div>
        </div>
      </header>

      <section className="max-w-5xl mx-auto px-6 py-8 space-y-4">
        {rows.length === 0 ? (
          <EmptyState
            title="No upcoming appointments"
            body="You’re clear for the next 24 hours."
          />
        ) : (
          rows.map((a) => (
            <Card key={a.id} className="p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm text-zinc-500">
                    {fmtDate(a.startsAt, timezone)} · {fmtTime(a.startsAt, timezone)} –{" "}
                    {fmtTime(a.endsAt, timezone)}
                  </p>
                  <h3 className="mt-2 text-lg font-semibold text-zinc-900">{a.customerName}</h3>
                  <p className="text-sm text-zinc-600 mt-1">
                    {a.serviceName ?? "Appointment"} · {a.customerPhone}
                  </p>
                </div>
                <Badge
                  variant={
                    a.status === "CANCELLED"
                      ? "warning"
                      : a.status === "COMPLETED"
                      ? "success"
                      : a.status === "NO_SHOW"
                      ? "warning"
                      : "info"
                  }
                >
                  {a.status.replace("_", " ")}
                </Badge>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  type="button"
                  disabled={busyId === a.id}
                  onClick={() => updateStatus(a.id, "COMPLETED")}
                  className="rounded-full px-3 py-1.5 text-xs"
                >
                  Mark complete
                </Button>
                <Button
                  variant="secondary"
                  type="button"
                  disabled={busyId === a.id}
                  onClick={() => updateStatus(a.id, "NO_SHOW")}
                  className="rounded-full px-3 py-1.5 text-xs"
                >
                  No-show
                </Button>
                <Button
                  variant="destructive"
                  type="button"
                  disabled={busyId === a.id}
                  onClick={() => updateStatus(a.id, "CANCELLED")}
                  className="rounded-full px-3 py-1.5 text-xs"
                >
                  Cancel
                </Button>
                <Button
                  variant="secondary"
                  type="button"
                  disabled={busyId === a.id}
                  onClick={() => reschedule(a.id)}
                  className="rounded-full px-3 py-1.5 text-xs"
                >
                  Reschedule
                </Button>
              </div>
            </Card>
          ))
        )}
      </section>
    </main>
  );
}
