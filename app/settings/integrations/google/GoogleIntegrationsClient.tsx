"use client";

import React from "react";

type SyncErrorRow = {
  appointmentId?: string;
  message?: string;
  at?: string;
};

export default function GoogleIntegrationsClient({ errors }: { errors: SyncErrorRow[] }) {
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  async function retry(id?: string) {
    if (!id) return;
    setBusyId(id);
    setNotice(null);
    try {
      const res = await fetch(`/api/org/appointments/${id}/sync`, { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setNotice(json.error || "Retry failed");
      } else {
        setNotice("Sync requested");
      }
    } finally {
      setBusyId(null);
    }
  }

  if (!errors.length) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-sm text-zinc-600 shadow-sm">
        No sync errors logged.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
      <h3 className="text-sm font-semibold text-zinc-900">Recent sync errors</h3>
      {notice ? <p className="mt-2 text-xs text-zinc-500">{notice}</p> : null}
      <div className="mt-4 space-y-3">
        {errors.map((e, idx) => (
          <div key={`${e.appointmentId || "unknown"}-${idx}`} className="rounded-xl border border-zinc-200 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs text-zinc-500">{e.at ? new Date(e.at).toLocaleString() : "Unknown time"}</p>
                <p className="mt-1 text-sm text-zinc-800">{e.message || "Sync failed"}</p>
                {e.appointmentId ? (
                  <p className="mt-1 text-xs text-zinc-500">Appointment: {e.appointmentId}</p>
                ) : null}
              </div>
              {e.appointmentId ? (
                <button
                  type="button"
                  disabled={busyId === e.appointmentId}
                  onClick={() => retry(e.appointmentId)}
                  className="rounded-md border border-zinc-200 bg-white px-3 py-1 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                >
                  {busyId === e.appointmentId ? "Retrying…" : "Retry"}
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
