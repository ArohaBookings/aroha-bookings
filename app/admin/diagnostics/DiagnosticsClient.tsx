"use client";

import React from "react";
import { renderScalar } from "@/lib/ui/renderScalar";

type OrgLite = { id: string; name: string };

type DiagnosticsResponse = {
  ok: boolean;
  traceId?: string;
  data?: {
    db: { ok: boolean };
    retell: {
      ok: boolean;
      hasConnection: boolean;
      agentIdPresent: boolean;
      apiKeyPresent: boolean;
      lastWebhookAt: string | null;
      lastWebhookError: string | null;
      lastWebhookErrorAt: string | null;
      lastSyncAt: string | null;
      lastSyncError: string | null;
      lastSyncTraceId: string | null;
      lastSyncHttpStatus: number | null;
      lastSyncEndpointTried: string | null;
    };
    calls: {
      ok: boolean;
      callLogCount24h: number;
      callLogCountTotal: number;
      lastCallAt: string | null;
      pendingForwardJobs: number;
      failedForwardJobs: number;
    };
    google: {
      ok: boolean;
      connected: boolean;
      calendarId: string | null;
      accountEmail: string | null;
      expiresAt: string | null;
      needsReconnect: boolean;
      lastSyncAt: string | null;
      lastError: string | null;
    };
    server: { now: string; env: string };
  };
  error?: string;
};

function statusPill(ok: boolean | null) {
  if (ok === null) return "bg-slate-100 text-slate-600 border-slate-200";
  return ok
    ? "bg-emerald-100 text-emerald-700 border-emerald-200"
    : "bg-amber-100 text-amber-700 border-amber-200";
}

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

export default function DiagnosticsClient({ orgs }: { orgs: OrgLite[] }) {
  const [orgId, setOrgId] = React.useState(orgs[0]?.id || "");
  const [data, setData] = React.useState<DiagnosticsResponse["data"] | null>(null);
  const [traceId, setTraceId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);

  const load = React.useCallback(async () => {
    if (!orgId) return;
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/diagnostics?orgId=${encodeURIComponent(orgId)}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const json = (await res.json()) as DiagnosticsResponse;
      if (!res.ok || !json.ok) {
        setData(null);
        setTraceId(json.traceId || null);
        setError(renderScalar(json.error || "Diagnostics failed."));
        return;
      }
      setData(json.data || null);
      setTraceId(json.traceId || null);
    } catch {
      setData(null);
      setError("Diagnostics failed.");
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  React.useEffect(() => {
    load();
    return () => abortRef.current?.abort();
  }, [load]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Super Admin</p>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">Diagnostics</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
          >
            {orgs.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={load}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-100"
            disabled={loading}
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </header>

      {error ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          {error}
          {traceId ? ` · Trace ${traceId}` : ""}
        </div>
      ) : null}

      {!data ? (
        <div className="text-sm text-zinc-500">No diagnostics loaded.</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-zinc-200 bg-white p-4 space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-zinc-800">Retell</span>
              <span className={`rounded-full border px-2 py-0.5 text-xs ${statusPill(data.retell.ok)}`}>
                {data.retell.ok ? "OK" : "Attention"}
              </span>
            </div>
            <div className="text-zinc-600">Agent: {data.retell.agentIdPresent ? "Set" : "Missing"}</div>
            <div className="text-zinc-600">API key: {data.retell.apiKeyPresent ? "Set" : "Missing"}</div>
            <div className="text-zinc-600">Last webhook: {formatDateTime(data.retell.lastWebhookAt)}</div>
            {data.retell.lastWebhookError ? (
              <div className="text-amber-700">
                Webhook error: {renderScalar(data.retell.lastWebhookError)}
                {data.retell.lastWebhookErrorAt
                  ? ` · ${formatDateTime(data.retell.lastWebhookErrorAt)}`
                  : ""}
              </div>
            ) : null}
            <div className="text-zinc-600">Last sync: {formatDateTime(data.retell.lastSyncAt)}</div>
            <div className="text-zinc-600">HTTP status: {renderScalar(data.retell.lastSyncHttpStatus)}</div>
            <div className="text-zinc-600">Endpoint: {renderScalar(data.retell.lastSyncEndpointTried)}</div>
            {data.retell.lastSyncError ? (
              <div className="text-amber-700">
                {renderScalar(data.retell.lastSyncError)}
                {data.retell.lastSyncTraceId ? ` · Trace ${data.retell.lastSyncTraceId}` : ""}
              </div>
            ) : null}
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-4 space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-zinc-800">Calls</span>
              <span className={`rounded-full border px-2 py-0.5 text-xs ${statusPill(data.calls.ok)}`}>
                {data.calls.ok ? "OK" : "Attention"}
              </span>
            </div>
            <div className="text-zinc-600">Calls (24h): {data.calls.callLogCount24h}</div>
            <div className="text-zinc-600">Calls (total): {data.calls.callLogCountTotal}</div>
            <div className="text-zinc-600">Last call: {formatDateTime(data.calls.lastCallAt)}</div>
            <div className="text-zinc-600">Pending forwards: {data.calls.pendingForwardJobs}</div>
            <div className="text-zinc-600">Failed forwards: {data.calls.failedForwardJobs}</div>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-4 space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-zinc-800">Google Calendar</span>
              <span className={`rounded-full border px-2 py-0.5 text-xs ${statusPill(data.google.ok)}`}>
                {data.google.ok ? "OK" : "Attention"}
              </span>
            </div>
            <div className="text-zinc-600">Connected: {renderScalar(data.google.connected)}</div>
            <div className="text-zinc-600">Calendar ID: {renderScalar(data.google.calendarId)}</div>
            <div className="text-zinc-600">Account: {renderScalar(data.google.accountEmail)}</div>
            <div className="text-zinc-600">Token expires: {formatDateTime(data.google.expiresAt)}</div>
            {data.google.needsReconnect ? <div className="text-amber-700">Needs reconnect</div> : null}
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-4 space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-zinc-800">Server</span>
              <span className={`rounded-full border px-2 py-0.5 text-xs ${statusPill(data.db.ok)}`}>
                {data.db.ok ? "OK" : "Attention"}
              </span>
            </div>
            <div className="text-zinc-600">Now: {formatDateTime(data.server.now)}</div>
            <div className="text-zinc-600">Env: {renderScalar(data.server.env)}</div>
          </div>
        </div>
      )}
    </div>
  );
}
