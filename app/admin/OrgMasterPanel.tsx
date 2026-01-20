"use client";

import React from "react";
import { renderScalar } from "@/lib/ui/renderScalar";

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
  retell?: {
    agentId: string | null;
    apiKeyEncrypted: string | null;
    webhookSecret: string | null;
    active: boolean | null;
    zapierWebhookUrl: string | null;
    lastWebhookAt: string | null;
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
  google?: {
    connected: boolean;
    calendarId: string | null;
    accountEmail: string | null;
    expiresAt: string | null;
    lastSyncAt?: string | null;
    lastSyncError?: string | null;
  };
  gmail?: { connected: boolean; accountEmail: string | null; lastError?: string | null };
  calls?: {
    retell?: {
      agentId: string | null;
      phoneNumber: string | null;
      webhookUrl: string | null;
      webhookSecret: string | null;
    };
    bookingTools?: {
      enabled: boolean;
    };
  };
  cronLastRun?: string | null;
  recentSyncErrors?: Array<Record<string, unknown>>;
  latestAppointment?: { id: string; status: string; startsAt: string; updatedAt: string } | null;
  emailAiSync?: Record<string, unknown>;
  messagesSync?: Record<string, unknown>;
  lastEmailSendAt?: string | null;
  error?: string;
};

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
      canDecrypt: boolean;
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

const DEFAULT_FEATURES = [
  "booking",
  "calls",
  "emailAI",
  "googleSync",
  "staffPortal",
  "automations",
  "clientSelfService",
];

function formatDateTime(value?: unknown) {
  if (!value) return "—";
  if (typeof value !== "string" && typeof value !== "number" && !(value instanceof Date)) {
    return renderScalar(value);
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return renderScalar(value);
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

function statusPill(ok: boolean | null) {
  if (ok === null) return "bg-slate-100 text-slate-600 border-slate-200";
  return ok
    ? "bg-emerald-100 text-emerald-700 border-emerald-200"
    : "bg-amber-100 text-amber-700 border-amber-200";
}

export default function OrgMasterPanel({ orgs }: { orgs: OrgLite[] }) {
  const [orgId, setOrgId] = React.useState(orgs[0]?.id || "");
  const [info, setInfo] = React.useState<OrgMasterResponse | null>(null);
  const [status, setStatus] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [updating, setUpdating] = React.useState(false);
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
  const [retellAgentId, setRetellAgentId] = React.useState("");
  const [retellApiKey, setRetellApiKey] = React.useState("");
  const [retellWebhookSecret, setRetellWebhookSecret] = React.useState("");
  const [retellPhoneNumber, setRetellPhoneNumber] = React.useState("");
  const [retellActive, setRetellActive] = React.useState(true);
  const [retellZapierWebhookUrl, setRetellZapierWebhookUrl] = React.useState("");
  const [retellLastWebhookAt, setRetellLastWebhookAt] = React.useState<string | null>(null);
  const [bookingToolsEnabled, setBookingToolsEnabled] = React.useState(false);
  const [diagnostics, setDiagnostics] = React.useState<DiagnosticsResponse["data"] | null>(null);
  const [diagnosticsTraceId, setDiagnosticsTraceId] = React.useState<string | null>(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = React.useState(false);
  const [diagnosticsError, setDiagnosticsError] = React.useState<string | null>(null);
  const [globalControls, setGlobalControls] = React.useState<{
    disableAutoSendAll: boolean;
    disableMessagesHubAll: boolean;
    disableEmailAIAll: boolean;
    disableAiSummariesAll: boolean;
  } | null>(null);
  const loadAbortRef = React.useRef<AbortController | null>(null);
  const loadRequestRef = React.useRef(0);
  const actionAbortRef = React.useRef<AbortController | null>(null);
  const globalAbortRef = React.useRef<AbortController | null>(null);
  const diagnosticsAbortRef = React.useRef<AbortController | null>(null);
  const mountedRef = React.useRef(true);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadAbortRef.current?.abort();
      actionAbortRef.current?.abort();
      globalAbortRef.current?.abort();
      diagnosticsAbortRef.current?.abort();
    };
  }, []);

  const safeSet = React.useCallback((fn: () => void) => {
    if (!mountedRef.current) return;
    fn();
  }, []);

  const newActionController = React.useCallback(() => {
    if (actionAbortRef.current) actionAbortRef.current.abort();
    const controller = new AbortController();
    actionAbortRef.current = controller;
    return controller;
  }, []);

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "").trim();
  const bookingUrl = info?.org?.slug && appUrl ? `${appUrl.replace(/\/$/, "")}/book/${info.org.slug}` : "";
  const orgDashboardUrl = info?.org?.slug ? `/o/${info.org.slug}/dashboard?readonly=1` : "";
  const voiceBase = info?.org?.id && appUrl ? `${appUrl.replace(/\/$/, "")}/api/integrations/voice/${info.org.id}` : "";
  const availabilityEndpoint = voiceBase ? `${voiceBase}/availability` : "";
  const createBookingEndpoint = voiceBase ? `${voiceBase}/create-booking` : "";
  const webhookUrl = info?.org?.id && appUrl ? `${appUrl.replace(/\/$/, "")}/api/webhooks/voice/retell/${info.org.id}` : "";

  async function loadInfo(nextOrgId: string) {
    if (!nextOrgId) return;
    loadRequestRef.current += 1;
    const requestId = loadRequestRef.current;
    if (loadAbortRef.current) loadAbortRef.current.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    safeSet(() => {
      setLoading(true);
      setUpdating(true);
      setStatus(renderScalar("Updating..."));
    });
    try {
      const res = await fetch(`/api/admin/org-master?orgId=${encodeURIComponent(nextOrgId)}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const data = (await res.json()) as OrgMasterResponse;
      if (!res.ok || !data.ok) {
        if (requestId !== loadRequestRef.current) return;
        safeSet(() => {
          setStatus(renderScalar(data.error || "Failed to load org details."));
        });
        return;
      }
      if (requestId !== loadRequestRef.current) return;
      safeSet(() => {
        setInfo(data);
        setFeatures(data.planFeatures || {});
        setEntitlements(data.entitlements || null);
        setPlanNotes(data.planNotes || "");
        setSelectedPlan(data.org?.plan || "PROFESSIONAL");
        setRetellAgentId(data.retell?.agentId || "");
        setRetellApiKey(data.retell?.apiKeyEncrypted || "");
        setRetellWebhookSecret(data.retell?.webhookSecret || "");
        setRetellPhoneNumber(data.calls?.retell?.phoneNumber || "");
        setRetellActive(Boolean(data.retell?.active));
        setRetellZapierWebhookUrl(data.retell?.zapierWebhookUrl || "");
        setRetellLastWebhookAt(data.retell?.lastWebhookAt || null);
        setBookingToolsEnabled(Boolean(data.calls?.bookingTools?.enabled));
        setLimits({
          bookingsPerMonth: data.planLimits?.bookingsPerMonth?.toString() || "",
          staffCount: data.planLimits?.staffCount?.toString() || "",
          automations: data.planLimits?.automations?.toString() || "",
        });
      });
    } catch {
      if (requestId !== loadRequestRef.current) return;
      safeSet(() => {
        setStatus(renderScalar("Failed to load org details."));
      });
    } finally {
      if (requestId !== loadRequestRef.current) return;
      safeSet(() => {
        setLoading(false);
        setUpdating(false);
      });
    }
  }

  React.useEffect(() => {
    loadInfo(orgId);
  }, [orgId]);

  React.useEffect(() => {
    if (globalAbortRef.current) globalAbortRef.current.abort();
    const controller = new AbortController();
    globalAbortRef.current = controller;
    (async () => {
      try {
        const res = await fetch("/api/admin/global-controls", {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await res.json();
        if (res.ok && data.ok) {
          safeSet(() => setGlobalControls(data.controls));
        }
      } catch {
        safeSet(() => setGlobalControls(null));
      }
    })();
    return () => controller.abort();
  }, []);

  async function saveFeatures(next: Record<string, boolean>) {
    if (!orgId) return;
    safeSet(() => setStatus(null));
    const controller = newActionController();
    try {
      const res = await fetch("/api/admin/org-features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ orgId, planFeatures: next }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) {
        safeSet(() => setStatus(renderScalar(data.error || "Failed to update features.")));
        return;
      }
      safeSet(() => setStatus(renderScalar("Features updated.")));
    } catch {
      safeSet(() => setStatus(renderScalar("Failed to update features.")));
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
    safeSet(() => setStatus(null));
    const controller = newActionController();
    try {
      const res = await fetch("/api/admin/org-limits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
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
        safeSet(() => setStatus(renderScalar(data.error || "Failed to update limits.")));
        return;
      }
      safeSet(() => setStatus(renderScalar("Limits updated.")));
    } catch {
      safeSet(() => setStatus(renderScalar("Failed to update limits.")));
    }
  }

  async function saveEntitlements(next: OrgMasterResponse["entitlements"]) {
    if (!orgId || !next) return;
    safeSet(() => setStatus(null));
    const controller = newActionController();
    try {
      const res = await fetch("/api/admin/org-entitlements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ orgId, entitlements: next }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        safeSet(() => setStatus(renderScalar(data.error || "Failed to update entitlements.")));
        return;
      }
      safeSet(() => {
        setEntitlements(data.entitlements || next);
        setStatus(renderScalar("Entitlements updated."));
      });
    } catch {
      safeSet(() => setStatus(renderScalar("Failed to update entitlements.")));
    }
  }

  async function savePlan() {
    if (!orgId) return;
    safeSet(() => setStatus(null));
    const controller = newActionController();
    try {
      const res = await fetch("/api/admin/org-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ orgId, plan: selectedPlan, planNotes }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        safeSet(() => setStatus(renderScalar(data.error || "Failed to update plan.")));
        return;
      }
      safeSet(() => setStatus(renderScalar("Plan updated.")));
      await loadInfo(orgId);
    } catch {
      safeSet(() => setStatus(renderScalar("Failed to update plan.")));
    }
  }

  async function saveRetellSettings() {
    if (!orgId) return;
    safeSet(() => setStatus(null));
    const controller = newActionController();
    try {
      const res = await fetch("/api/admin/org-master", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          orgId,
          retell: {
            agentId: retellAgentId,
            apiKeyEncrypted: retellApiKey,
            webhookSecret: retellWebhookSecret,
            active: retellActive,
            phoneNumber: retellPhoneNumber,
          },
          zapierWebhookUrl: retellZapierWebhookUrl,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        safeSet(() => setStatus(renderScalar(data.error || "Failed to update Retell settings.")));
        return;
      }
      safeSet(() => setStatus(renderScalar("Retell settings updated.")));
      await loadInfo(orgId);
    } catch {
      safeSet(() => setStatus(renderScalar("Failed to update Retell settings.")));
    }
  }

  async function saveBookingTools() {
    if (!orgId) return;
    safeSet(() => setStatus(null));
    const controller = newActionController();
    try {
      const res = await fetch("/api/admin/org-master", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          orgId,
          bookingToolsEnabled,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        safeSet(() => setStatus(renderScalar(data.error || "Failed to update booking tools.")));
        return;
      }
      safeSet(() => setStatus(renderScalar("Booking tools updated.")));
      await loadInfo(orgId);
    } catch {
      safeSet(() => setStatus(renderScalar("Failed to update booking tools.")));
    }
  }

  async function saveGlobalControls(next: NonNullable<typeof globalControls>) {
    safeSet(() => setStatus(null));
    const controller = newActionController();
    try {
      const res = await fetch("/api/admin/global-controls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify(next),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        safeSet(() => setStatus(renderScalar(data.error || "Failed to update global controls.")));
        return;
      }
      safeSet(() => {
        setGlobalControls(data.controls || next);
        setStatus(renderScalar("Global controls updated."));
      });
    } catch {
      safeSet(() => setStatus(renderScalar("Failed to update global controls.")));
    }
  }

  async function copyLink() {
    if (!bookingUrl) return;
    try {
      await navigator.clipboard.writeText(bookingUrl);
      safeSet(() => setStatus(renderScalar("Booking link copied.")));
    } catch {
      safeSet(() => setStatus(renderScalar("Unable to copy booking link.")));
    }
  }

  async function copyText(value: string, label: string) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      safeSet(() => setStatus(renderScalar(`${label} copied.`)));
    } catch {
      safeSet(() => setStatus(renderScalar(`Unable to copy ${label.toLowerCase()}.`)));
    }
  }

  async function disconnectGoogle() {
    if (!info?.org?.id || !info?.google?.connected) return;
    safeSet(() => setStatus(renderScalar("Disconnecting Google...")));
    try {
      const res = await fetch("/api/integrations/google/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId: info.org.id, accountEmail: info.google?.accountEmail }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        safeSet(() => setStatus(renderScalar(data.error || "Failed to disconnect Google.")));
        return;
      }
      await loadInfo(info.org.id);
      safeSet(() => setStatus(renderScalar("Google disconnected.")));
    } catch {
      safeSet(() => setStatus(renderScalar("Failed to disconnect Google.")));
    }
  }

  async function disconnectGmail() {
    if (!info?.org?.id || !info?.gmail?.connected) return;
    safeSet(() => setStatus(renderScalar("Disconnecting Gmail...")));
    try {
      const res = await fetch("/api/integrations/gmail/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId: info.org.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        safeSet(() => setStatus(renderScalar(data.error || "Failed to disconnect Gmail.")));
        return;
      }
      await loadInfo(info.org.id);
      safeSet(() => setStatus(renderScalar("Gmail disconnected.")));
    } catch {
      safeSet(() => setStatus(renderScalar("Failed to disconnect Gmail.")));
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
      const controller = newActionController();
      const res = await fetch(url, { signal: controller.signal });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        safeSet(() => setStatus(renderScalar(data.error || "Availability test failed.")));
        return;
      }
      safeSet(() =>
        setStatus(renderScalar(`Availability OK: ${data.meta?.totalSlots ?? data.slots?.length ?? 0} slots.`)),
      );
    } catch {
      safeSet(() => setStatus(renderScalar("Availability test failed.")));
    }
  }

  async function testBooking() {
    if (!orgId) return;
    try {
      const controller = newActionController();
      const res = await fetch(`/api/admin/test-booking?orgId=${encodeURIComponent(orgId)}`, {
        signal: controller.signal,
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        safeSet(() => setStatus(renderScalar(data.error || "Booking test failed.")));
        return;
      }
      safeSet(() =>
        setStatus(renderScalar(`Booking test OK: ${data.service?.name || "service"} @ ${data.slot?.start}`)),
      );
    } catch {
      safeSet(() => setStatus(renderScalar("Booking test failed.")));
    }
  }

  async function testSync() {
    if (!orgId) return;
    try {
      const controller = newActionController();
      const res = await fetch(`/api/admin/test-sync?orgId=${encodeURIComponent(orgId)}`, {
        signal: controller.signal,
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        safeSet(() => setStatus(renderScalar(data.error || "Sync dry-run failed.")));
        return;
      }
      const google = data.google as { connected?: boolean; needsReconnect?: boolean } | undefined;
      const googleNote = google
        ? google.needsReconnect
          ? "Google reconnect needed"
          : "Google OK"
        : "Google status unknown";
      safeSet(() => setStatus(renderScalar(`Sync dry-run: ${data.action} (${data.reason}) · ${googleNote}`)));
    } catch {
      safeSet(() => setStatus(renderScalar("Sync dry-run failed.")));
    }
  }

  async function runDiagnostics() {
    if (!orgId) return;
    if (diagnosticsAbortRef.current) diagnosticsAbortRef.current.abort();
    const controller = new AbortController();
    diagnosticsAbortRef.current = controller;
    safeSet(() => {
      setDiagnosticsLoading(true);
      setDiagnosticsError(null);
    });
    try {
      const res = await fetch(`/api/admin/diagnostics?orgId=${encodeURIComponent(orgId)}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const data = (await res.json()) as DiagnosticsResponse;
      if (!res.ok || !data.ok) {
        safeSet(() => {
          setDiagnostics(null);
          setDiagnosticsTraceId(data.traceId || null);
          setDiagnosticsError(renderScalar(data.error || "Diagnostics failed."));
        });
        return;
      }
      safeSet(() => {
        setDiagnostics(data.data || null);
        setDiagnosticsTraceId(data.traceId || null);
      });
    } catch {
      safeSet(() => {
        setDiagnostics(null);
        setDiagnosticsError("Diagnostics failed.");
      });
    } finally {
      safeSet(() => setDiagnosticsLoading(false));
    }
  }

  async function runCallsSyncNow() {
    if (!orgId) return;
    try {
      const controller = newActionController();
      const res = await fetch("/api/org/calls/sync", {
        method: "POST",
        signal: controller.signal,
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        safeSet(() => setStatus(renderScalar("Calls sync failed.")));
        return;
      }
      safeSet(() => setStatus(renderScalar("Calls sync started.")));
      await runDiagnostics();
    } catch {
      safeSet(() => setStatus(renderScalar("Calls sync failed.")));
    }
  }

  async function refreshDiagnostics() {
    try {
      await fetch("/api/org/calls/sync", { cache: "no-store" });
    } catch {
      // ignore sync meta refresh failures
    }
    await loadInfo(orgId);
    await runDiagnostics();
  }

  async function resetCallLogs() {
    if (!orgId) return;
    try {
      const controller = newActionController();
      const res = await fetch("/api/admin/calls/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ orgId }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        safeSet(() => setStatus(renderScalar(data.error || "Call reset failed.")));
        return;
      }
      safeSet(() => setStatus(renderScalar(`Call logs cleared (${data.deletedCallLogs ?? 0}).`)));
      await refreshDiagnostics();
    } catch {
      safeSet(() => setStatus(renderScalar("Call reset failed.")));
    }
  }

  async function copyDiagnostics() {
    if (!diagnostics) return;
    try {
      const payload = { traceId: diagnosticsTraceId, diagnostics };
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      safeSet(() => setStatus(renderScalar("Diagnostics copied.")));
    } catch {
      safeSet(() => setStatus(renderScalar("Unable to copy diagnostics.")));
    }
  }

  async function runIsolationCheck() {
    safeSet(() => setStatus(null));
    try {
      const controller = newActionController();
      const res = await fetch("/api/admin/org-isolation-check", {
        cache: "no-store",
        signal: controller.signal,
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        safeSet(() => setStatus(renderScalar(data.error || "Isolation check failed.")));
        return;
      }
      safeSet(() => setStatus(renderScalar(`Isolation check OK: ${data.summary?.length || 0} orgs scanned.`)));
    } catch {
      safeSet(() => setStatus(renderScalar("Isolation check failed.")));
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
            {renderScalar(status)}
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
          {updating && (
            <div className="mt-1 text-xs text-amber-600">Updating…</div>
          )}
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

      <div className="mt-4 grid gap-4 md:grid-cols-4">
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
          <div className="mt-2 flex items-center gap-2 text-zinc-700">
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] ${statusPill(info?.google?.connected ?? null)}`}>
              {loading ? "Loading..." : info?.google?.connected ? "Connected" : "Not connected"}
            </span>
            {info?.google?.lastSyncError ? (
              <span className="text-[10px] text-rose-600">Needs attention</span>
            ) : null}
          </div>
          <div className="text-xs text-zinc-500">{info?.google?.accountEmail || "No account"}</div>
          <div className="text-xs text-zinc-500">{info?.google?.calendarId || "No calendar"}</div>
          <div className="text-xs text-zinc-500">
            Expires: {info?.google?.expiresAt ? formatDateTime(info.google.expiresAt) : "—"}
          </div>
          <div className="text-xs text-zinc-500">
            Last sync: {formatDateTime(info?.google?.lastSyncAt || null)}
          </div>
          {info?.google?.lastSyncError ? (
            <div className="mt-2 text-[11px] text-rose-600">{info.google.lastSyncError}</div>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={disconnectGoogle}
              disabled={!info?.google?.connected}
              className="rounded-md border border-rose-200 bg-rose-50 px-3 py-1 text-[11px] font-semibold text-rose-900 hover:bg-rose-100 disabled:opacity-50"
            >
              Disconnect Google
            </button>
          </div>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-3 text-sm">
          <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Gmail</div>
          <div className="mt-2 flex items-center gap-2 text-zinc-700">
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] ${statusPill(info?.gmail?.connected ?? null)}`}>
              {loading ? "Loading..." : info?.gmail?.connected ? "Connected" : "Not connected"}
            </span>
            {info?.gmail?.lastError ? <span className="text-[10px] text-rose-600">Needs attention</span> : null}
          </div>
          <div className="text-xs text-zinc-500">{info?.gmail?.accountEmail || "No account"}</div>
          {info?.gmail?.lastError ? (
            <div className="mt-2 text-[11px] text-rose-600">{info.gmail.lastError}</div>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={disconnectGmail}
              disabled={!info?.gmail?.connected}
              className="rounded-md border border-rose-200 bg-rose-50 px-3 py-1 text-[11px] font-semibold text-rose-900 hover:bg-rose-100 disabled:opacity-50"
            >
              Disconnect Gmail
            </button>
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
          <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Retell settings</div>
          <div className="mt-3 grid gap-3 text-sm">
            <label className="grid gap-1">
              <span className="text-xs text-zinc-500">Agent ID</span>
              <input
                value={retellAgentId}
                onChange={(e) => setRetellAgentId(e.target.value)}
                className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
                placeholder="retell_agent_..."
              />
            </label>
            <label className="grid gap-1">
              <span className="text-xs text-zinc-500">API key (encrypted)</span>
              <input
                value={retellApiKey}
                onChange={(e) => setRetellApiKey(e.target.value)}
                className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
                placeholder="Encrypted key"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-xs text-zinc-500">Webhook secret</span>
              <input
                value={retellWebhookSecret}
                onChange={(e) => setRetellWebhookSecret(e.target.value)}
                className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
                placeholder="whsec_..."
              />
            </label>
            <label className="grid gap-1">
              <span className="text-xs text-zinc-500">Phone number</span>
              <input
                value={retellPhoneNumber}
                onChange={(e) => setRetellPhoneNumber(e.target.value)}
                className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
                placeholder="+64..."
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-zinc-600">
              <input
                type="checkbox"
                checked={retellActive}
                onChange={(e) => setRetellActive(e.target.checked)}
              />
              Active
            </label>
            <div className="text-xs text-zinc-500">
              Last webhook: {formatDateTime(retellLastWebhookAt)}
            </div>
            <button
              type="button"
              onClick={saveRetellSettings}
              className="rounded-md border border-zinc-300 px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-100"
            >
              Save Retell settings
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Zapier override</div>
          <div className="mt-3 grid gap-3 text-sm">
            <label className="grid gap-1">
              <span className="text-xs text-zinc-500">Per-org Zapier URL</span>
              <input
                value={retellZapierWebhookUrl}
                onChange={(e) => setRetellZapierWebhookUrl(e.target.value)}
                className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
                placeholder="https://hooks.zapier.com/..."
              />
            </label>
            <div className="text-xs text-zinc-500">
              Leave blank to use the global Zapier URL.
            </div>
            <button
              type="button"
              onClick={saveRetellSettings}
              className="rounded-md border border-zinc-300 px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-100"
            >
              Save Zapier override
            </button>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Voice booking tools</div>
          <div className="mt-3 grid gap-3 text-sm">
            <label className="flex items-center gap-2 text-xs text-zinc-600">
              <input
                type="checkbox"
                checked={bookingToolsEnabled}
                onChange={(e) => setBookingToolsEnabled(e.target.checked)}
              />
              Enabled
            </label>
            <div>
              <div className="text-xs text-zinc-500">Availability endpoint</div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] text-zinc-700">
                  {availabilityEndpoint || "Configure NEXT_PUBLIC_APP_URL"}
                </span>
                <button
                  type="button"
                  onClick={() => copyText(availabilityEndpoint, "Availability endpoint")}
                  disabled={!availabilityEndpoint}
                  className="rounded-md border border-zinc-300 px-2 py-1 text-[11px] text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
                >
                  Copy
                </button>
              </div>
            </div>
            <div>
              <div className="text-xs text-zinc-500">Create booking endpoint</div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] text-zinc-700">
                  {createBookingEndpoint || "Configure NEXT_PUBLIC_APP_URL"}
                </span>
                <button
                  type="button"
                  onClick={() => copyText(createBookingEndpoint, "Create booking endpoint")}
                  disabled={!createBookingEndpoint}
                  className="rounded-md border border-zinc-300 px-2 py-1 text-[11px] text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
                >
                  Copy
                </button>
              </div>
            </div>
            <div>
              <div className="text-xs text-zinc-500">Webhook URL</div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] text-zinc-700">
                  {webhookUrl || "Configure NEXT_PUBLIC_APP_URL"}
                </span>
                <button
                  type="button"
                  onClick={() => copyText(webhookUrl, "Webhook URL")}
                  disabled={!webhookUrl}
                  className="rounded-md border border-zinc-300 px-2 py-1 text-[11px] text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
                >
                  Copy
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={saveBookingTools}
              className="rounded-md border border-zinc-300 px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-100"
            >
              Save booking tools
            </button>
          </div>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Call settings</div>
          <div className="mt-3 grid gap-3 text-sm">
            <div className="text-xs text-zinc-500">Retell agent ID: {info?.calls?.retell?.agentId || "—"}</div>
            <div className="text-xs text-zinc-500">Retell webhook secret: {info?.calls?.retell?.webhookSecret || "—"}</div>
            <div className="text-xs text-zinc-500">Retell phone number: {info?.calls?.retell?.phoneNumber || "—"}</div>
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
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={globalControls.disableAiSummariesAll}
                    onChange={(e) =>
                      setGlobalControls({ ...globalControls, disableAiSummariesAll: e.target.checked })
                    }
                  />
                  Disable AI summaries globally
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Diagnostics / health</div>
            <p className="mt-1 text-xs text-zinc-500">
              One-click snapshot for Retell, calls, and Google Calendar connectivity.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={runCallsSyncNow}
              disabled={!orgId || diagnosticsLoading}
              className="rounded-md border border-zinc-300 px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
            >
              Run calls sync now
            </button>
            <button
              type="button"
              onClick={refreshDiagnostics}
              disabled={!orgId || diagnosticsLoading}
              className="rounded-md border border-zinc-300 px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
            >
              {diagnosticsLoading ? "Refreshing..." : "Refresh diagnostics"}
            </button>
            <button
              type="button"
              onClick={resetCallLogs}
              disabled={!orgId || diagnosticsLoading}
              className="rounded-md border border-zinc-300 px-3 py-2 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-50"
            >
              Reset call logs
            </button>
            <button
              type="button"
              onClick={copyDiagnostics}
              disabled={!diagnostics}
              className="rounded-md border border-zinc-300 px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
            >
              Copy diagnostics JSON
            </button>
          </div>
        </div>
        {diagnosticsError ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            {renderScalar(diagnosticsError)}
            {diagnosticsTraceId ? ` · Trace ${diagnosticsTraceId}` : ""}
          </div>
        ) : null}
        {!diagnostics ? (
          <div className="text-xs text-zinc-500">Run diagnostics to see the latest health snapshot.</div>
        ) : (
          <div className="grid gap-3 text-xs md:grid-cols-2">
            <div className="space-y-2 rounded-lg border border-zinc-200 p-3">
              <div className="flex items-center justify-between">
                <span className="font-medium text-zinc-700">Retell</span>
                <span className={`rounded-full border px-2 py-0.5 ${statusPill(diagnostics.retell.ok)}`}>
                  {diagnostics.retell.ok ? "OK" : "Attention"}
                </span>
              </div>
              <div className="text-zinc-500">Agent: {renderScalar(diagnostics.retell.agentIdPresent ? "Set" : "Missing")}</div>
              <div className="text-zinc-500">API key: {renderScalar(diagnostics.retell.apiKeyPresent ? "Set" : "Missing")}</div>
              <div className="text-zinc-500">Last webhook: {formatDateTime(diagnostics.retell.lastWebhookAt)}</div>
              {diagnostics.retell.lastWebhookError ? (
                <div className="text-amber-700">
                  Webhook error: {renderScalar(diagnostics.retell.lastWebhookError)}
                  {diagnostics.retell.lastWebhookErrorAt
                    ? ` · ${formatDateTime(diagnostics.retell.lastWebhookErrorAt)}`
                    : ""}
                </div>
              ) : null}
              <div className="text-zinc-500">Last sync: {formatDateTime(diagnostics.retell.lastSyncAt)}</div>
              <div className="text-zinc-500">
                HTTP status: {renderScalar(diagnostics.retell.lastSyncHttpStatus)}
              </div>
              <div className="text-zinc-500">
                Endpoint: {renderScalar(diagnostics.retell.lastSyncEndpointTried)}
              </div>
              {diagnostics.retell.lastSyncError ? (
                <div className="text-amber-700">
                  Sync error: {renderScalar(diagnostics.retell.lastSyncError)}
                  {diagnostics.retell.lastSyncTraceId ? ` · Trace ${diagnostics.retell.lastSyncTraceId}` : ""}
                </div>
              ) : null}
            </div>
            <div className="space-y-2 rounded-lg border border-zinc-200 p-3">
              <div className="flex items-center justify-between">
                <span className="font-medium text-zinc-700">Calls</span>
                <span className={`rounded-full border px-2 py-0.5 ${statusPill(diagnostics.calls.ok)}`}>
                  {diagnostics.calls.ok ? "OK" : "Attention"}
                </span>
              </div>
              <div className="text-zinc-500">Calls (24h): {diagnostics.calls.callLogCount24h}</div>
              <div className="text-zinc-500">Calls (total): {diagnostics.calls.callLogCountTotal}</div>
              <div className="text-zinc-500">Last call: {formatDateTime(diagnostics.calls.lastCallAt)}</div>
              <div className="text-zinc-500">Pending forwards: {diagnostics.calls.pendingForwardJobs}</div>
              <div className="text-zinc-500">Failed forwards: {diagnostics.calls.failedForwardJobs}</div>
            </div>
            <div className="space-y-2 rounded-lg border border-zinc-200 p-3">
              <div className="flex items-center justify-between">
                <span className="font-medium text-zinc-700">Google Calendar</span>
                <span className={`rounded-full border px-2 py-0.5 ${statusPill(diagnostics.google.ok)}`}>
                  {diagnostics.google.ok ? "OK" : "Attention"}
                </span>
              </div>
              <div className="text-zinc-500">Connected: {renderScalar(diagnostics.google.connected)}</div>
              <div className="text-zinc-500">Calendar ID: {renderScalar(diagnostics.google.calendarId)}</div>
              <div className="text-zinc-500">Account: {renderScalar(diagnostics.google.accountEmail)}</div>
              <div className="text-zinc-500">Token expires: {formatDateTime(diagnostics.google.expiresAt)}</div>
              {diagnostics.google.needsReconnect ? (
                <div className="text-amber-700">Needs reconnect</div>
              ) : null}
              {diagnostics.google.lastError ? (
                <div className="text-amber-700">Last error: {renderScalar(diagnostics.google.lastError)}</div>
              ) : null}
            </div>
            <div className="space-y-2 rounded-lg border border-zinc-200 p-3">
              <div className="flex items-center justify-between">
                <span className="font-medium text-zinc-700">Server</span>
                <span className={`rounded-full border px-2 py-0.5 ${statusPill(diagnostics.db.ok)}`}>
                  {diagnostics.db.ok ? "OK" : "Attention"}
                </span>
              </div>
              <div className="text-zinc-500">Now: {formatDateTime(diagnostics.server.now)}</div>
              <div className="text-zinc-500">Env: {renderScalar(diagnostics.server.env)}</div>
              {diagnosticsTraceId ? (
                <div className="text-zinc-500">Trace: {renderScalar(diagnosticsTraceId)}</div>
              ) : null}
            </div>
          </div>
        )}
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
              <label className="grid gap-1">
  <span className="text-zinc-500">Calls poll (sec)</span>
  <input
    type="number"
    value={(entitlements.limits as any)?.callsSyncIntervalSec ?? 20}
    onChange={(e) =>
  setEntitlements({
    ...entitlements,
    limits: ({
      ...(entitlements.limits as any),
      callsSyncIntervalSec: Number(e.target.value || 0),
    } as typeof entitlements.limits),
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
