"use client";

import React from "react";
import { Button } from "@/components/ui";

type IntegrationState = {
  enabled: boolean;
  status: "not_configured" | "setup_required" | "connected";
  pageId?: string;
  appId?: string;
  phoneNumberId?: string;
  wabaId?: string;
  igBusinessId?: string;
  accessToken?: string;
};

type IntegrationsConfig = {
  instagram: IntegrationState;
  whatsapp: IntegrationState;
  sms?: IntegrationState;
};

const defaultState: IntegrationsConfig = {
  instagram: { enabled: false, status: "not_configured" },
  whatsapp: { enabled: false, status: "not_configured" },
  sms: { enabled: false, status: "not_configured" },
};

function statusBadge(status: IntegrationState["status"]) {
  if (status === "connected") return "bg-emerald-100 text-emerald-700 border-emerald-200";
  if (status === "setup_required") return "bg-amber-100 text-amber-700 border-amber-200";
  return "bg-zinc-100 text-zinc-600 border-zinc-200";
}

export default function MessagesIntegrationsPage() {
  const [config, setConfig] = React.useState<IntegrationsConfig>(defaultState);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);
  const [entitlementError, setEntitlementError] = React.useState<string | null>(null);
  const [channelEntitlements, setChannelEntitlements] = React.useState<{
    instagram: boolean;
    whatsapp: boolean;
    webchat: boolean;
  } | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/messages/integrations", { cache: "no-store" });
        const j = await res.json();
        if (!cancelled && !j?.ok) {
          setEntitlementError(j?.error || "Messages Hub is not included in your plan.");
          return;
        }
        if (!cancelled && j?.ok) {
          setEntitlementError(null);
          setConfig(j.integrations || defaultState);
        }
        const identity = await fetch("/api/org/identity", { cache: "no-store" });
        const identityJson = await identity.json();
        if (!cancelled && identityJson?.entitlements) {
          const channels = identityJson.entitlements.channels || {};
          setChannelEntitlements({
            instagram: Boolean(channels.instagram?.enabled),
            whatsapp: Boolean(channels.whatsapp?.enabled),
            webchat: Boolean(channels.webchat?.enabled),
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async (next: IntegrationsConfig) => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/messages/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const j = await res.json();
      if (!res.ok || !j?.ok) throw new Error(j?.error || "Save failed");
      setConfig(j.integrations || next);
      setSuccess("Integrations updated.");
    } catch (e: any) {
      setError(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const update = (key: keyof IntegrationsConfig, patch: Partial<IntegrationState>) => {
    const current = (config[key] as IntegrationState) || { enabled: false, status: "not_configured" };
    const next = {
      ...config,
      [key]: {
        ...current,
        ...patch,
      },
    } as IntegrationsConfig;
    setConfig(next);
  };

  const onTest = async (key: keyof IntegrationsConfig) => {
    try {
      const res = await fetch("/api/messages/integrations/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: key, config: config[key] }),
      });
      const j = await res.json();
      if (!res.ok || !j?.ok) {
        setError(j?.error || "Test connection failed.");
        return;
      }
      const next = {
        ...config,
        [key]: { ...(config[key] as IntegrationState), status: "connected" },
      } as IntegrationsConfig;
      await save(next);
    } catch (e: any) {
      setError(e?.message || "Test connection failed.");
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Channel integrations</h1>
          <p className="text-sm text-zinc-600">
            Connect Instagram and WhatsApp to bring every message into Aroha.
          </p>
        </div>
        <Button onClick={() => save(config)} disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </header>

      {(error || success) && (
        <div
          className={`rounded-md border px-4 py-2 text-sm ${
            error ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"
          }`}
        >
          {error || success}
        </div>
      )}

      {entitlementError && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          {entitlementError}{" "}
          <a className="font-semibold underline" href="/settings">
            Upgrade to enable Messages Hub
          </a>
          .
        </div>
      )}

      {loading ? (
        <div className="text-sm text-zinc-500">Loading integrations…</div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {(["instagram", "whatsapp"] as const).map((key) => {
            const entry = config[key];
            const entitlementEnabled =
              channelEntitlements?.[key as "instagram" | "whatsapp"] ?? true;
            return (
              <section key={key} className="rounded-xl border border-zinc-200 bg-white shadow-sm">
                <div className="px-5 py-3 border-b border-zinc-200 font-semibold flex items-center justify-between">
                  <span>{key === "instagram" ? "Instagram DMs" : "WhatsApp Business"}</span>
                  <span className={`rounded-full border px-2 py-1 text-[11px] ${statusBadge(entry.status)}`}>
                    {entry.status.replace("_", " ")}
                  </span>
                </div>
                <div className="p-5 space-y-3 text-sm text-zinc-600">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={entry.enabled}
                      disabled={!entitlementEnabled}
                      onChange={(e) => update(key, { enabled: e.target.checked })}
                    />
                    Enable connector
                  </label>
                  {!entitlementEnabled && (
                    <div className="text-[11px] text-amber-600">
                      Channel disabled by entitlements. Contact support to enable.
                    </div>
                  )}
                  <div className="grid gap-3 text-xs">
                    {key === "instagram" ? (
                      <>
                        <input
                          className="h-9 rounded-md border border-zinc-200 px-3"
                          placeholder="Meta app ID"
                          value={entry.appId || ""}
                          onChange={(e) => update(key, { appId: e.target.value })}
                        />
                        <input
                          className="h-9 rounded-md border border-zinc-200 px-3"
                          placeholder="Facebook page ID"
                          value={entry.pageId || ""}
                          onChange={(e) => update(key, { pageId: e.target.value })}
                        />
                        <input
                          className="h-9 rounded-md border border-zinc-200 px-3"
                          placeholder="IG business ID"
                          value={entry.igBusinessId || ""}
                          onChange={(e) => update(key, { igBusinessId: e.target.value })}
                        />
                        <input
                          className="h-9 rounded-md border border-zinc-200 px-3"
                          placeholder="Access token (stored as plain text)"
                          value={entry.accessToken || ""}
                          onChange={(e) => update(key, { accessToken: e.target.value })}
                        />
                      </>
                    ) : (
                      <>
                        <input
                          className="h-9 rounded-md border border-zinc-200 px-3"
                          placeholder="WhatsApp phone number ID"
                          value={entry.phoneNumberId || ""}
                          onChange={(e) => update(key, { phoneNumberId: e.target.value })}
                        />
                        <input
                          className="h-9 rounded-md border border-zinc-200 px-3"
                          placeholder="WABA ID"
                          value={entry.wabaId || ""}
                          onChange={(e) => update(key, { wabaId: e.target.value })}
                        />
                        <input
                          className="h-9 rounded-md border border-zinc-200 px-3"
                          placeholder="Access token (stored as plain text)"
                          value={entry.accessToken || ""}
                          onChange={(e) => update(key, { accessToken: e.target.value })}
                        />
                      </>
                    )}
                  </div>
                  <ol className="list-decimal list-inside text-xs text-zinc-500 space-y-1">
                    <li>Authorize the Meta Business account</li>
                    <li>Select the business page/phone number</li>
                    <li>Confirm webhook verification</li>
                  </ol>
                  <div className="text-[11px] text-amber-600">
                    Tokens are stored in OrgSettings (draft-only). Move to a vault before production.
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={() => onTest(key)}>
                      Test connection
                    </Button>
                    <Button variant="secondary" onClick={() => save(config)} disabled={saving}>
                      Save
                    </Button>
                  </div>
                </div>
              </section>
            );
          })}

          <section className="rounded-xl border border-zinc-200 bg-white shadow-sm">
            <div className="px-5 py-3 border-b border-zinc-200 font-semibold">SMS / Webchat (placeholder)</div>
            <div className="p-5 text-sm text-zinc-600 space-y-3">
              <div>SMS and webchat connectors are coming next. We can draft replies now.</div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={Boolean(config.sms?.enabled)}
                  onChange={(e) => update("sms", { enabled: e.target.checked })}
                />
                Enable placeholder
              </label>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
