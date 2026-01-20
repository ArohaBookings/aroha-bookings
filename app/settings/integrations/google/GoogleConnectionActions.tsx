"use client";

import React from "react";

export default function GoogleConnectionActions({
  orgId,
  connected,
  accountEmail,
}: {
  orgId: string;
  connected: boolean;
  accountEmail: string | null;
}) {
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);

  async function disconnect() {
    if (!orgId || !connected || busy) return;
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch("/api/org/integrations/google-calendar/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, accountEmail }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) throw new Error(j?.error || "Disconnect failed");
      setStatus("Disconnected.");
      window.location.reload();
    } catch (err: any) {
      setStatus(err?.message || "Disconnect failed");
    } finally {
      setBusy(false);
    }
  }

  if (!connected) return null;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={busy}
        onClick={disconnect}
        className="inline-flex items-center rounded-md border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-900 hover:bg-rose-100 disabled:opacity-60"
      >
        {busy ? "Disconnecting..." : "Disconnect Google Calendar"}
      </button>
      {status ? <span className="text-xs text-zinc-500">{status}</span> : null}
    </div>
  );
}
