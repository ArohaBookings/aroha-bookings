"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type StatusProbe = {
  ok: boolean;
  orgId?: string;
  connected: boolean;
  email?: string | null;
  expiresAt?: number | null;
  needsReconnect?: boolean;
  calendarId?: string | null;
  lastSyncAt?: string | null;
  lastError?: { error?: string; ts?: string } | null;
  startUrl?: string;
  error?: string;
};

async function fetchStatus(): Promise<StatusProbe> {
  const res = await fetch("/api/integrations/google/status", { cache: "no-store" });
  if (res.status === 401) {
    window.location.href = "/login?callbackUrl=%2Fcalendar%2Fconnect";
    return { ok: false, connected: false };
  }
  return res.json();
}

export default function CalendarConnectPage() {
  const [probe, setProbe] = useState<StatusProbe | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setErr(null);
        const p1 = await fetchStatus();
        if (!cancelled) setProbe(p1);
        if (!cancelled && !p1.connected) {
          setTimeout(async () => {
            try {
              const p2 = await fetchStatus();
              if (!cancelled) setProbe(p2);
            } catch {}
          }, 1200);
        }
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "Failed to check calendar connection");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const nearExpiry = useMemo(() => {
    if (!probe?.expiresAt) return false;
    return probe.expiresAt - Date.now() <= 5 * 60 * 1000;
  }, [probe?.expiresAt]);

  if (loading) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold tracking-tight">Google Calendar</h1>
        <p className="mt-2 text-sm text-zinc-600">Checking connection…</p>
      </div>
    );
  }

  if (!probe || !probe.ok) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold tracking-tight">Google Calendar</h1>
        <p className="mt-2 text-sm text-zinc-600">Unable to check Google connection.</p>
        {err && <div className="mt-3 text-sm text-rose-600">{err}</div>}
      </div>
    );
  }

  if (probe.connected) {
    return (
      <div className="p-6 space-y-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Google Calendar connected</h1>
          <p className="mt-2 text-sm text-zinc-600">
            Signed in as <span className="font-medium">{probe.email ?? "unknown"}</span>.
          </p>
          {nearExpiry && (
            <p className="mt-2 text-sm text-amber-600">
              Token expiring soon — reconnect to keep sync healthy.
            </p>
          )}
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-600">
          <div>Calendar selected: <span className="font-medium text-zinc-800">{probe.calendarId || "Not set"}</span></div>
          <div className="mt-1">
            Last sync:{" "}
            <span className="font-medium text-zinc-800">
              {probe.lastSyncAt ? new Date(probe.lastSyncAt).toLocaleString() : "No sync yet"}
            </span>
          </div>
          {probe.lastError?.error && (
            <div className="mt-2 text-rose-600">
              Last error: {probe.lastError.error}
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-3">
          <a
            className="inline-flex items-center rounded-md border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
            href={probe.startUrl || "/api/integrations/google/start"}
          >
            {nearExpiry || probe.needsReconnect ? "Reconnect Google" : "Reconnect / Switch account"}
          </a>
          <Link
            className="inline-flex items-center rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-900 hover:bg-emerald-100"
            href="/calendar/google"
          >
            Choose calendar
          </Link>
          <Link
            className="inline-flex items-center rounded-md border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
            href="/calendar"
          >
            Back to calendar
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Connect Google Calendar</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Link Google Calendar to keep Aroha in sync with external bookings.
        </p>
      </div>
      {err && <div className="text-sm text-rose-600">{err}</div>}
      <a
        className="inline-flex items-center rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-900 hover:bg-emerald-100"
        href={probe.startUrl || "/api/integrations/google/start"}
      >
        Connect Google Calendar
      </a>
    </div>
  );
}
