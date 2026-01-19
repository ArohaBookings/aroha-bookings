"use client";

import React from "react";
import { renderScalar } from "@/lib/ui/renderScalar";

function buildWebhookUrl() {
  const base = (process.env.NEXT_PUBLIC_APP_URL || "").trim();
  if (!base) return "";
  return `${base.replace(/\/$/, "")}/api/webhooks/retell`;
}


export default function IntegrationsPanel() {
  const [globalZapierWebhookUrl, setGlobalZapierWebhookUrl] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);
  const [running, setRunning] = React.useState(false);

  const webhookUrl = buildWebhookUrl();

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/admin/global-settings", { cache: "no-store" });
        const data = await res.json();
        if (!cancelled && res.ok && data.ok) {
          setGlobalZapierWebhookUrl(data.globalZapierWebhookUrl || "");
        }
      } catch {
        if (!cancelled) setStatus(renderScalar("Failed to load global settings."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveGlobalZapier() {
    setStatus(null);
    try {
      const res = await fetch("/api/admin/global-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ globalZapierWebhookUrl }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setStatus(renderScalar(data.error || "Failed to save."));
        return;
      }
      setGlobalZapierWebhookUrl(data.globalZapierWebhookUrl || "");
      setStatus(renderScalar("Global Zapier URL saved."));
    } catch {
      setStatus(renderScalar("Failed to save."));
    }
  }

  async function runQueue() {
    setRunning(true);
    setStatus(null);
    try {
      const res = await fetch("/api/admin/process-forward-queue", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setStatus(renderScalar(data.error || "Queue run failed."));
        return;
      }
      setStatus(renderScalar(`Queue processed: ${data.processed} (sent ${data.sent}, failed ${data.failed}).`));
    } catch {
      setStatus(renderScalar("Queue run failed."));
    } finally {
      setRunning(false);
    }
  }

  async function copyWebhookUrl() {
    if (!webhookUrl) return;
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setStatus(renderScalar("Webhook URL copied."));
    } catch {
      setStatus(renderScalar("Copy failed."));
    }
  }

  return (
    <section className="mb-10 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Integrations</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Global Retell + Zapier settings for all orgs.
          </p>
        </div>
        {status ? (
          <div className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs text-zinc-600">
            {renderScalar(status)}
          </div>
        ) : null}
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm">
          <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Retell webhook URL</div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-white px-3 py-2 text-xs text-zinc-700 border border-zinc-200">
              {webhookUrl || "Configure NEXT_PUBLIC_APP_URL"}
            </span>
            <button
              type="button"
              onClick={copyWebhookUrl}
              disabled={!webhookUrl}
              className="rounded-md border border-zinc-300 px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
            >
              Copy
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Global Zapier URL</div>
          <input
            value={globalZapierWebhookUrl}
            onChange={(e) => setGlobalZapierWebhookUrl(e.target.value)}
            placeholder="https://hooks.zapier.com/..."
            className="mt-3 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
            disabled={loading}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={saveGlobalZapier}
              className="rounded-md border border-zinc-300 px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-100"
              disabled={loading}
            >
              Save global Zapier
            </button>
            <button
              type="button"
              onClick={runQueue}
              className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 hover:bg-emerald-100"
              disabled={running}
            >
              {running ? "Running..." : "Run forward queue"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
