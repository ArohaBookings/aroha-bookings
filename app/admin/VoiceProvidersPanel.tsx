// app/admin/VoiceProvidersPanel.tsx
"use client";

import React from "react";

type OrgLite = { id: string; name: string };

type Connection = {
  orgId: string;
  agentId: string;
  webhookSecret: string;
  active: boolean;
  apiKeyEncrypted?: string | null;
};

const PROVIDERS = [{ value: "retell", label: "Retell" }] as const;

function buildWebhookUrl(baseUrl: string, orgId: string) {
  if (!baseUrl || !orgId) return "";

  const cleanBase = baseUrl.endsWith("/")
    ? baseUrl.slice(0, -1)
    : baseUrl;

  return `${cleanBase}/api/webhooks/voice/retell/${orgId}`;
}


export default function VoiceProvidersPanel({ orgs }: { orgs: OrgLite[] }) {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "").trim();
  const [orgId, setOrgId] = React.useState(orgs[0]?.id || "");
  const [provider, setProvider] = React.useState("retell");
  const [agentId, setAgentId] = React.useState("");
  const [webhookSecret, setWebhookSecret] = React.useState("");
  const [active, setActive] = React.useState(true);
  const [status, setStatus] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const webhookUrl = buildWebhookUrl(appUrl, orgId);
  const missingEnv = !appUrl;

  async function loadConnection() {
    if (!orgId) return;
    setLoading(true);
    setStatus(null);
    try {
      const url = `/api/admin/voice-connection?orgId=${encodeURIComponent(orgId)}&provider=${encodeURIComponent(provider)}`;
      const res = await fetch(url, { cache: "no-store" });
      const json = (await res.json()) as { ok: boolean; connection?: Connection | null; error?: string };
      if (!res.ok || !json.ok) {
        setStatus(json.error || "Unable to load connection.");
        setLoading(false);
        return;
      }
      if (json.connection) {
        setAgentId(json.connection.agentId || "");
        setWebhookSecret(json.connection.webhookSecret || "");
        setActive(Boolean(json.connection.active));
      } else {
        setAgentId("");
        setWebhookSecret("");
        setActive(true);
      }
    } catch (e) {
      setStatus("Unable to load connection.");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    loadConnection();
  }, [orgId, provider]);

  async function saveConnection() {
    if (!orgId) return;
    setLoading(true);
    setStatus(null);
    try {
      const res = await fetch("/api/admin/voice-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId,
          provider,
          agentId,
          webhookSecret,
          active,
        }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string; connection?: Connection };
      if (!res.ok || !json.ok) {
        setStatus(json.error || "Unable to save connection.");
        return;
      }
      setStatus("Connection saved.");
    } catch {
      setStatus("Unable to save connection.");
    } finally {
      setLoading(false);
    }
  }

  async function rotateSecret() {
    if (!orgId || !agentId) return;
    setLoading(true);
    setStatus(null);
    try {
      const res = await fetch("/api/admin/voice-connection/rotate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, provider, agentId }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string; connection?: Connection };
      if (!res.ok || !json.ok || !json.connection) {
        setStatus(json.error || "Unable to rotate secret.");
        return;
      }
      setWebhookSecret(json.connection.webhookSecret);
      setStatus("Webhook secret rotated.");
    } catch {
      setStatus("Unable to rotate secret.");
    } finally {
      setLoading(false);
    }
  }

  async function sendTestWebhook() {
    if (!orgId || !agentId) return;
    setLoading(true);
    setStatus(null);
    try {
      const res = await fetch("/api/admin/voice-connection/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, provider, agentId }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setStatus(json.error || "Test webhook failed.");
        return;
      }
      setStatus("Test webhook delivered.");
    } catch {
      setStatus("Test webhook failed.");
    } finally {
      setLoading(false);
    }
  }

  async function copyWebhookUrl() {
    if (!webhookUrl) return;
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setStatus("Webhook URL copied.");
    } catch {
      setStatus("Unable to copy webhook URL.");
    }
  }

  return (
    <section className="mb-10 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Voice Providers</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Configure voice webhooks per organisation. Retell is supported now; Aroha Voice is coming.
          </p>
        </div>
        {status ? (
          <div className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs text-zinc-600">
            {status}
          </div>
        ) : null}
      </div>

      {missingEnv ? (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          NEXT_PUBLIC_APP_URL is missing. Set it to enable webhook URL copy and test calls.
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <label className="text-sm font-medium">
          Organisation
          <select
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
          >
            {orgs.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm font-medium">
          Provider
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
          >
            {PROVIDERS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm font-medium">
          Agent ID
          <input
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
            placeholder="retell_agent_..."
          />
        </label>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <label className="text-sm font-medium md:col-span-2">
          Webhook Secret
          <input
            value={webhookSecret}
            onChange={(e) => setWebhookSecret(e.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
            placeholder="whsec_..."
          />
        </label>
        <label className="flex items-center gap-2 text-sm font-medium md:pt-6">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="h-4 w-4 rounded border-zinc-300"
          />
          Active
        </label>
      </div>

      <div className="mt-5 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
        Webhook URL:{" "}
        <span className="font-mono text-[11px] text-zinc-900">
          {webhookUrl || "Select an org to view"}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={saveConnection}
          disabled={loading}
          className="inline-flex items-center justify-center rounded-lg bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          Save connection
        </button>
        <button
          type="button"
          onClick={copyWebhookUrl}
          disabled={loading || missingEnv || !webhookUrl}
          className="inline-flex items-center justify-center rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-700 disabled:opacity-60"
        >
          Copy webhook URL
        </button>
        <button
          type="button"
          onClick={rotateSecret}
          disabled={loading || !agentId}
          className="inline-flex items-center justify-center rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-700 disabled:opacity-60"
        >
          Rotate webhook secret
        </button>
        <button
          type="button"
          onClick={sendTestWebhook}
          disabled={loading || missingEnv || !agentId}
          className="inline-flex items-center justify-center rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 disabled:opacity-60"
        >
          Send test webhook
        </button>
      </div>
    </section>
  );
}
