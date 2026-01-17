"use client";

import React from "react";

type OrgLite = { id: string; name: string };

type OrgMasterResponse = {
  ok: boolean;
  org?: {
    id: string;
    name: string;
    slug: string;
    timezone: string;
    plan: string;
  };
  planNotes?: string;
  staffCount?: number;
  planLimits?: { bookingsPerMonth: number | null; staffCount: number | null; automations: number | null };
  planFeatures?: Record<string, boolean>;
  entitlements?: {
    features: Record<string, boolean>;
    automation: {
      enableAutoDraft: boolean;
      enableAutoSend: boolean;
      dailySendCap: number;
      minConfidence: number;
      requireApprovalFirstN: number;
    };
    limits: {
      staffMax: number | null;
      bookingsPerMonth: number | null;
      inboxSyncIntervalSec: number;
      messageSyncIntervalSec: number;
    };
    channels: {
      whatsapp: { enabled: boolean };
      instagram: { enabled: boolean };
      webchat: { enabled: boolean };
    };
  };
  google?: { connected: boolean; calendarId: string | null; accountEmail: string | null; expiresAt: string | null };
  cronLastRun?: string | null;
  recentSyncErrors?: Array<Record<string, unknown>>;
  latestAppointment?: { id: string; status: string; startsAt: string; updatedAt: string } | null;
  emailAiSync?: Record<string, unknown>;
  messagesSync?: Record<string, unknown>;
  lastEmailSendAt?: string | null;
  error?: string;
};

const DEFAULT_FEATURES = [
  "booking",
  "calls",
  "emailAI",
  "googleSync",
  "staffPortal",
  "automations",
  "clientSelfService",
];

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function formatError(err: unknown) {
  if (!err || typeof err !== "object") return String(err ?? "Unknown error");
  const record = err as Record<string, unknown>;
  const at = typeof record.at === "string" ? record.at : null;
  const message = typeof record.message === "string" ? record.message : null;
  const context = typeof record.context === "string" ? record.context : null;
  const detail = message || context || JSON.stringify(record);
  return `${detail}${at ? ` · ${new Date(at).toLocaleString()}` : ""}`;
}

export default function OrgMasterPanel({ orgs }: { orgs: OrgLite[] }) {
  const [orgId, setOrgId] = React.useState(orgs[0]?.id || "");
  const [info, setInfo] = React.useState<OrgMasterResponse | null>(null);
  const [status, setStatus] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [features, setFeatures] = React.useState<Record<string, boolean>>({});
  const [limits, setLimits] = React.useState<{
    bookingsPerMonth: string;
    staffCount: string;
    automations: string;
  }>({ bookingsPerMonth: "", staffCount: "", automations: "" });
  const [newFeature, setNewFeature] = React.useState("");
  const [entitlements, setEntitlements] = React.useState<OrgMasterResponse["entitlements"] | null>(null);
  const [planNotes, setPlanNotes] = React.useState("");
  const [selectedPlan, setSelectedPlan] = React.useState("PROFESSIONAL");
  const [globalControls, setGlobalControls] = React.useState<{
    disableAutoSendAll: boolean;
    disableMessagesHubAll: boolean;
    disableEmailAIAll: boolean;
  } | null>(null);

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "").trim();
  const bookingUrl = info?.org?.slug && appUrl ? `${appUrl.replace(/\/$/, "")}/book/${info.org.slug}` : "";
  const orgDashboardUrl = info?.org?.slug ? `/o/${info.org.slug}/dashboard?readonly=1` : "";

  async function loadInfo(nextOrgId: string) {
    if (!nextOrgId) return;
    setLoading(true);
    setStatus(null);
    try {
      const res = await fetch(`/api/admin/org-master?orgId=${encodeURIComponent(nextOrgId)}`, {
        cache: "no-store",
      });
      const data = (await res.json()) as OrgMasterResponse;
      if (!res.ok || !data.ok) {
        setStatus(data.error || "Failed to load org details.");
        setInfo(null);
        return;
      }
      setInfo(data);
      setFeatures(data.planFeatures || {});
      setEntitlements(data.entitlements || null);
      setPlanNotes(data.planNotes || "");
      setSelectedPlan(data.org?.plan || "PROFESSIONAL");
      setLimits({
        bookingsPerMonth: data.planLimits?.bookingsPerMonth?.toString() || "",
        staffCount: data.planLimits?.staffCount?.toString() || "",
        automations: data.planLimits?.automations?.toString() || "",
      });
    } catch {
      setStatus("Failed to load org details.");
      setInfo(null);
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    loadInfo(orgId);
  }, [orgId]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/global-controls", { cache: "no-store" });
        const data = await res.json();
        if (!cancelled && res.ok && data.ok) {
          setGlobalControls(data.controls);
        }
      } catch {
        if (!cancelled) setGlobalControls(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveFeatures(next: Record<string, boolean>) {
    if (!orgId) return;
    setStatus(null);
    try {
      const res = await fetch("/api/admin/org-features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, planFeatures: next }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setStatus(data.error || "Failed to update features.");
        return;
      }
      setStatus("Features updated.");
    } catch {
      setStatus("Failed to update features.");
    }
  }

  function toggleFeature(key: string) {
    const next = { ...features, [key]: !features[key] };
    setFeatures(next);
    saveFeatures(next);
  }

  function addFeatureKey() {
    const key = newFeature.trim();
    if (!key) return;
    if (features[key] !== undefined) {
      setNewFeature("");
      return;
    }
    const next = { ...features, [key]: true };
    setFeatures(next);
    setNewFeature("");
    saveFeatures(next);
  }

  async function saveLimits(next: { bookingsPerMonth: string; staffCount: string; automations: string }) {
    if (!orgId) return;
    setStatus(null);
    try {
      const res = await fetch("/api/admin/org-limits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId,
          planLimits: {
            bookingsPerMonth: next.bookingsPerMonth ? Number(next.bookingsPerMonth) : null,
            staffCount: next.staffCount ? Number(next.staffCount) : null,
            automations: next.automations ? Number(next.automations) : null,
          },
        }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setStatus(data.error || "Failed to update limits.");
        return;
      }
      setStatus("Limits updated.");
    } catch {
      setStatus("Failed to update limits.");
    }
  }

  async function saveEntitlements(next: OrgMasterResponse["entitlements"]) {
    if (!orgId || !next) return;
    setStatus(null);
    try {
      const res = await fetch("/api/admin/org-entitlements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, entitlements: next }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setStatus(data.error || "Failed to update entitlements.");
        return;
      }
      setEntitlements(data.entitlements || next);
      setStatus("Entitlements updated.");
    } catch {
      setStatus("Failed to update entitlements.");
    }
  }

  async function savePlan() {
    if (!orgId) return;
    setStatus(null);
    try {
      const res = await fetch("/api/admin/org-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, plan: selectedPlan, planNotes }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setStatus(data.error || "Failed to update plan.");
        return;
      }
      setStatus("Plan updated.");
      await loadInfo(orgId);
    } catch {
      setStatus("Failed to update plan.");
    }
  }

  async function saveGlobalControls(next: NonNullable<typeof globalControls>) {
    setStatus(null);
    try {
      const res = await fetch("/api/admin/global-controls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setStatus(data.error || "Failed to update global controls.");
        return;
      }
      setGlobalControls(data.controls || next);
      setStatus("Global controls updated.");
    } catch {
      setStatus("Failed to update global controls.");
    }
  }

  async function copyLink() {
    if (!bookingUrl) return;
    try {
      await navigator.clipboard.writeText(bookingUrl);
      setStatus("Booking link copied.");
    } catch {
      setStatus("Unable to copy booking link.");
    }
  }

  async function testAvailability() {
    if (!info?.org?.slug) return;
    const from = new Date().toISOString().slice(0, 10);
    const to = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const url =
      `/api/public/availability?orgSlug=${encodeURIComponent(info.org.slug)}` +
      `&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setStatus(data.error || "Availability test failed.");
        return;
      }
      setStatus(`Availability OK: ${data.meta?.totalSlots ?? data.slots?.length ?? 0} slots.`);
    } catch {
      setStatus("Availability test failed.");
    }
  }

  async function testBooking() {
    if (!orgId) return;
    try {
      const res = await fetch(`/api/admin/test-booking?orgId=${encodeURIComponent(orgId)}`);
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setStatus(data.error || "Booking test failed.");
        return;
      }
      setStatus(`Booking test OK: ${data.service?.name || "service"} @ ${data.slot?.start}`);
    } catch {
      setStatus("Booking test failed.");
    }
  }

  async function testSync() {
    if (!orgId) return;
    try {
      const res = await fetch(`/api/admin/test-sync?orgId=${encodeURIComponent(orgId)}`);
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setStatus(data.error || "Sync dry-run failed.");
        return;
      }
      setStatus(`Sync dry-run: ${data.action} (${data.reason})`);
    } catch {
      setStatus("Sync dry-run failed.");
    }
  }

  async function runIsolationCheck() {
    setStatus(null);
    try {
      const res = await fetch("/api/admin/org-isolation-check", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setStatus(data.error || "Isolation check failed.");
        return;
      }
      setStatus(`Isolation check OK: ${data.summary?.length || 0} orgs scanned.`);
    } catch {
      setStatus("Isolation check failed.");
    }
  }

  const featureKeys = React.useMemo(() => {
    const keys = new Set([...DEFAULT_FEATURES, ...Object.keys(features)]);
    return Array.from(keys).sort();
  }, [features]);

  return (
    <section className="mb-10 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Org master view</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Plan, features, booking link, sync status, and operational checks.
          </p>
        </div>
        {status ? (
          <div className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs text-zinc-600">
            {status}
          </div>
        ) : null}
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
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

        <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm">
          <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Booking link</div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-white px-3 py-2 text-xs text-zinc-700 border border-zinc-200">
              {bookingUrl || "Configure NEXT_PUBLIC_APP_URL"}
            </span>
            <button
              type="button"
              onClick={copyLink}
              disabled={!bookingUrl}
              className="rounded-md border border-zinc-300 px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
            >
              Copy link
            </button>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-zinc-200 bg-white p-3 text-sm">
          <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Org overview</div>
          <div className="mt-2 text-zinc-700">
            Plan: <span className="font-medium">{info?.org?.plan || "—"}</span>
          </div>
          <div className="text-xs text-zinc-500">Staff members: {info?.staffCount ?? "—"}</div>
          <div className="text-xs text-zinc-500">Timezone: {info?.org?.timezone || "—"}</div>
          <div className="text-xs text-zinc-500">Cron last run: {formatDateTime(info?.cronLastRun || null)}</div>
          <div className="text-xs text-zinc-500">
            Email AI last sync: {formatDateTime((info?.emailAiSync as any)?.lastSuccessAt || null)}
          </div>
          <div className="text-xs text-zinc-500">
            Email AI last send: {formatDateTime(info?.lastEmailSendAt || null)}
          </div>
          <div className="text-xs text-zinc-500">
            Messages last sync: {formatDateTime((info?.messagesSync as any)?.lastSuccessAt || null)}
          </div>
          {orgDashboardUrl ? (
            <a
              className="mt-2 inline-flex items-center text-xs font-medium text-zinc-700 hover:underline"
              href={orgDashboardUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open org (read-only)
            </a>
          ) : null}
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-3 text-sm">
          <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Google sync</div>
          <div className="mt-2 text-zinc-700">
            {loading ? "Loading..." : info?.google?.connected ? "Connected" : "Not connected"}
          </div>
          <div className="text-xs text-zinc-500">{info?.google?.accountEmail || "No account"}</div>
          <div className="text-xs text-zinc-500">{info?.google?.calendarId || "No calendar"}</div>
          <div className="text-xs text-zinc-500">
            Expires: {info?.google?.expiresAt ? formatDateTime(info.google.expiresAt) : "—"}
          </div>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-3 text-sm">
          <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Recent sync errors</div>
          <div className="mt-2 space-y-2 text-xs text-zinc-600">
            {(info?.recentSyncErrors || []).slice(0, 3).map((err, idx) => (
              <div key={idx} className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1">
                {formatError(err)}
              </div>
            ))}
            {(info?.recentSyncErrors?.length ?? 0) === 0 && (
              <div className="text-zinc-500">No recent errors.</div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Plan control</div>
          <div className="mt-3 grid gap-3 text-sm">
            <label className="grid gap-1">
              <span className="text-xs text-zinc-500">Plan tier</span>
              <select
                value={selectedPlan}
                onChange={(e) => setSelectedPlan(e.target.value)}
                className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
              >
                {["LITE", "STARTER", "PROFESSIONAL", "PREMIUM"].map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="text-xs text-zinc-500">Plan notes</span>
              <textarea
                value={planNotes}
                onChange={(e) => setPlanNotes(e.target.value)}
                className="h-20 rounded-md border border-zinc-300 px-3 py-2 text-xs"
                placeholder="Internal notes for this org"
              />
            </label>
            <button
              type="button"
              onClick={savePlan}
              className="rounded-md border border-zinc-300 px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-100"
            >
              Save plan
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Global kill switches</div>
          <div className="mt-3 grid gap-3 text-sm">
            {!globalControls ? (
              <div className="text-xs text-zinc-500">Loading controls…</div>
            ) : (
              <>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={globalControls.disableAutoSendAll}
                    onChange={(e) =>
                      setGlobalControls({ ...globalControls, disableAutoSendAll: e.target.checked })
                    }
                  />
                  Disable auto-send across all orgs
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={globalControls.disableMessagesHubAll}
                    onChange={(e) =>
                      setGlobalControls({ ...globalControls, disableMessagesHubAll: e.target.checked })
                    }
                  />
                  Disable Messages Hub globally
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={globalControls.disableEmailAIAll}
                    onChange={(e) =>
                      setGlobalControls({ ...globalControls, disableEmailAIAll: e.target.checked })
                    }
                  />
                  Disable Email AI globally
                </label>
                <button
                  type="button"
                  onClick={() => globalControls && saveGlobalControls(globalControls)}
                  className="rounded-md border border-zinc-300 px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-100"
                >
                  Save global controls
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Plan features</div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {featureKeys.map((key) => (
              <label key={key} className="flex items-center gap-2 text-sm text-zinc-700">
                <input
                  type="checkbox"
                  checked={Boolean(features[key])}
                  onChange={() => toggleFeature(key)}
                  className="h-4 w-4 rounded border-zinc-300"
                />
                {key}
              </label>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-2">
            <input
              value={newFeature}
              onChange={(e) => setNewFeature(e.target.value)}
              className="w-full rounded-md border border-zinc-300 px-3 py-2 text-xs"
              placeholder="Add custom feature key"
            />
            <button
              type="button"
              onClick={addFeatureKey}
              className="rounded-md border border-zinc-300 px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-100"
            >
              Add
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-4 space-y-4">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Plan limits</div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3 text-xs">
              <label className="grid gap-1">
                <span className="text-zinc-500">Bookings/month</span>
                <input
                  value={limits.bookingsPerMonth}
                  onChange={(e) => setLimits((prev) => ({ ...prev, bookingsPerMonth: e.target.value }))}
                  className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
                  placeholder="Unlimited"
                />
              </label>
              <label className="grid gap-1">
                <span className="text-zinc-500">Staff count</span>
                <input
                  value={limits.staffCount}
                  onChange={(e) => setLimits((prev) => ({ ...prev, staffCount: e.target.value }))}
                  className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
                  placeholder="Unlimited"
                />
              </label>
              <label className="grid gap-1">
                <span className="text-zinc-500">Automations</span>
                <input
                  value={limits.automations}
                  onChange={(e) => setLimits((prev) => ({ ...prev, automations: e.target.value }))}
                  className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
                  placeholder="Unlimited"
                />
              </label>
            </div>
            <button
              type="button"
              onClick={() => saveLimits(limits)}
              className="mt-3 rounded-md border border-zinc-300 px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-100"
            >
              Save limits
            </button>
          </div>

          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Test tools</div>
            <p className="mt-2 text-xs text-zinc-500">
              Dry-run checks for availability, booking, and Google sync.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={testAvailability}
                disabled={!info?.org?.slug}
                className="rounded-md border border-zinc-300 px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
              >
                Test availability
              </button>
              <button
                type="button"
                onClick={testBooking}
                disabled={!orgId}
                className="rounded-md border border-zinc-300 px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
              >
                Test booking
              </button>
              <button
                type="button"
                onClick={testSync}
                disabled={!orgId}
                className="rounded-md border border-zinc-300 px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
              >
                Dry-run sync
              </button>
              <button
                type="button"
                onClick={runIsolationCheck}
                className="rounded-md border border-zinc-300 px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-100"
              >
                Org isolation check
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-zinc-200 bg-white p-4 space-y-4">
        <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Entitlements</div>
        {!entitlements ? (
          <div className="text-xs text-zinc-500">Loading entitlements…</div>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-3 text-sm">
              {Object.entries(entitlements.features).map(([key, value]) => (
                <label key={key} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={Boolean(value)}
                    onChange={(e) =>
                      setEntitlements({
                        ...entitlements,
                        features: { ...entitlements.features, [key]: e.target.checked },
                      })
                    }
                  />
                  {key}
                </label>
              ))}
            </div>
            <div className="grid gap-3 md:grid-cols-5 text-xs">
              <label className="grid gap-1">
                <span className="text-zinc-500">Auto draft</span>
                <input
                  type="checkbox"
                  checked={entitlements.automation.enableAutoDraft}
                  onChange={(e) =>
                    setEntitlements({
                      ...entitlements,
                      automation: { ...entitlements.automation, enableAutoDraft: e.target.checked },
                    })
                  }
                />
              </label>
              <label className="grid gap-1">
                <span className="text-zinc-500">Auto send</span>
                <input
                  type="checkbox"
                  checked={entitlements.automation.enableAutoSend}
                  onChange={(e) =>
                    setEntitlements({
                      ...entitlements,
                      automation: { ...entitlements.automation, enableAutoSend: e.target.checked },
                    })
                  }
                />
              </label>
              <label className="grid gap-1">
                <span className="text-zinc-500">Daily cap</span>
                <input
                  value={entitlements.automation.dailySendCap}
                  onChange={(e) =>
                    setEntitlements({
                      ...entitlements,
                      automation: { ...entitlements.automation, dailySendCap: Number(e.target.value || 0) },
                    })
                  }
                  className="rounded-md border border-zinc-300 px-2 py-1 text-xs"
                />
              </label>
              <label className="grid gap-1">
                <span className="text-zinc-500">Min confidence</span>
                <input
                  value={entitlements.automation.minConfidence}
                  onChange={(e) =>
                    setEntitlements({
                      ...entitlements,
                      automation: { ...entitlements.automation, minConfidence: Number(e.target.value || 0) },
                    })
                  }
                  className="rounded-md border border-zinc-300 px-2 py-1 text-xs"
                />
              </label>
              <label className="grid gap-1">
                <span className="text-zinc-500">Approval first N</span>
                <input
                  value={entitlements.automation.requireApprovalFirstN}
                  onChange={(e) =>
                    setEntitlements({
                      ...entitlements,
                      automation: {
                        ...entitlements.automation,
                        requireApprovalFirstN: Number(e.target.value || 0),
                      },
                    })
                  }
                  className="rounded-md border border-zinc-300 px-2 py-1 text-xs"
                />
              </label>
            </div>
            <div className="grid gap-3 md:grid-cols-4 text-xs">
              <label className="grid gap-1">
                <span className="text-zinc-500">Staff max</span>
                <input
                  value={entitlements.limits.staffMax ?? ""}
                  onChange={(e) =>
                    setEntitlements({
                      ...entitlements,
                      limits: {
                        ...entitlements.limits,
                        staffMax: e.target.value ? Number(e.target.value || 0) : null,
                      },
                    })
                  }
                  className="rounded-md border border-zinc-300 px-2 py-1 text-xs"
                  placeholder="Unlimited"
                />
              </label>
              <label className="grid gap-1">
                <span className="text-zinc-500">Bookings/month</span>
                <input
                  value={entitlements.limits.bookingsPerMonth ?? ""}
                  onChange={(e) =>
                    setEntitlements({
                      ...entitlements,
                      limits: {
                        ...entitlements.limits,
                        bookingsPerMonth: e.target.value ? Number(e.target.value || 0) : null,
                      },
                    })
                  }
                  className="rounded-md border border-zinc-300 px-2 py-1 text-xs"
                  placeholder="Unlimited"
                />
              </label>
              <label className="grid gap-1">
                <span className="text-zinc-500">Inbox poll (sec)</span>
                <input
                  value={entitlements.limits.inboxSyncIntervalSec}
                  onChange={(e) =>
                    setEntitlements({
                      ...entitlements,
                      limits: {
                        ...entitlements.limits,
                        inboxSyncIntervalSec: Number(e.target.value || 0),
                      },
                    })
                  }
                  className="rounded-md border border-zinc-300 px-2 py-1 text-xs"
                />
              </label>
              <label className="grid gap-1">
                <span className="text-zinc-500">Messages poll (sec)</span>
                <input
                  value={entitlements.limits.messageSyncIntervalSec}
                  onChange={(e) =>
                    setEntitlements({
                      ...entitlements,
                      limits: {
                        ...entitlements.limits,
                        messageSyncIntervalSec: Number(e.target.value || 0),
                      },
                    })
                  }
                  className="rounded-md border border-zinc-300 px-2 py-1 text-xs"
                />
              </label>
            </div>
            <div className="grid gap-3 md:grid-cols-3 text-sm">
              {Object.entries(entitlements.channels).map(([key, value]) => (
                <label key={key} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={Boolean(value.enabled)}
                    onChange={(e) =>
                      setEntitlements({
                        ...entitlements,
                        channels: {
                          ...entitlements.channels,
                          [key]: { enabled: e.target.checked },
                        },
                      })
                    }
                  />
                  {key} enabled
                </label>
              ))}
            </div>
            <button
              type="button"
              onClick={() => entitlements && saveEntitlements(entitlements)}
              className="rounded-md border border-zinc-300 px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-100"
            >
              Save entitlements
            </button>
          </>
        )}
      </div>
    </section>
  );
}
