// FILE MAP: app layout at app/layout.tsx; Retell webhook at app/api/webhooks/voice/[provider]/[orgId]/route.ts.
"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Badge, Button, Card, EmptyState, Input, Select } from "@/components/ui";
import Toast from "@/components/ui/Toast";
import IntentActionsPanel from "@/components/IntentActionsPanel";
import type { OrgEntitlements } from "@/lib/entitlements";
import { formatCallerPhone } from "@/lib/phone/format";

type CallItem = {
  id: string;
  callId: string;
  agentId: string;
  startedAt: string;
  endedAt: string | null;
  callerPhone: string;
  businessPhone?: string | null;
  outcome: string;
  appointmentId: string | null;
  appointment: { startsAt: string; serviceName: string | null; staffName: string | null } | null;
  summary: string;
  category: string;
  priority: "low" | "normal" | "high" | "urgent";
  risk: "safe" | "needs_review" | "blocked";
  reasons: string[];
  steps: string[];
  fields: Record<string, string>;
  hasTranscript: boolean;
  riskRadar?: { flagged: boolean; flags: string[]; cancellationCount: number };
};

type CallDetail = {
  id: string;
  callId: string;
  agentId: string;
  startedAt: string;
  endedAt: string | null;
  callerPhone: string;
  businessPhone?: string | null;
  outcome: string;
  appointmentId: string | null;
  appointment: {
    id: string;
    startsAt: string;
    endsAt: string;
    customerName: string;
    customerId?: string | null;
    serviceName: string | null;
    staffName: string | null;
  } | null;
  transcript: string | null;
  recordingUrl: string | null;
  rawJson: unknown;
  summary: { system: string; ai: string | null; aiEnabled: boolean };
  category: string;
  priority: "low" | "normal" | "high" | "urgent";
  risk: "safe" | "needs_review" | "blocked";
  reasons: string[];
  steps: string[];
  fields: Record<string, string>;
};

type RescueDraft = {
  toName: string;
  toEmail: string | null;
  toPhone: string | null;
  sms: string;
  emailSubject: string;
  emailBody: string;
  bookingUrl: string;
  aiRewritten: boolean;
};

type StatsRow = {
  label: string;
  count: number;
  minutes: number;
  missed: number;
  answered: number;
  bookings: number;
};

type MetricKey = "count" | "minutes" | "missed" | "answered" | "bookings" | "conversion";

type StatsResponse = {
  totals: {
    count: number;
    minutes: number;
    missed: number;
    answered: number;
    bookings: number;
  };
  weekly: StatsRow[];
  monthly: StatsRow[];
  timezone: string;
  lastWebhookAt?: string | null;
};

type StatsApiResponse = {
  ok: boolean;
  data?: StatsResponse;
  debug?: { from: string; to: string; rows: { total: number; filtered: number } } | null;
};

type Filters = {
  from: string;
  to: string;
  agent: string;
  outcome: string;
  q: string;
  staffId: string;
  serviceId: string;
  businessHoursOnly: boolean;
  riskRadar: boolean;
};

type ToastState = { message: string; variant: "info" | "success" | "error" } | null;

const skeletonKeys = ["s1", "s2", "s3", "s4", "s5", "s6"];

function useToast() {
  const [toast, setToast] = React.useState<ToastState>(null);
  const timer = React.useRef<number | null>(null);
  const mountedRef = React.useRef(true);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  const show = React.useCallback(
    (
      message: string,
      variant: NonNullable<ToastState>["variant"] = "info"
    ) => {
      if (!mountedRef.current) return;
      setToast({ message, variant });
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        if (!mountedRef.current) return;
        setToast(null);
      }, 2400);
    },
    []
  );

  const node = toast ? (
    <div className="fixed right-6 top-6 z-[80]">
      <Toast message={toast.message} variant={toast.variant} />
    </div>
  ) : null;

  return { show, node };
}

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("en-NZ", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-NZ", { hour: "2-digit", minute: "2-digit" });
}

function formatDuration(startIso: string, endIso?: string | null) {
  if (!endIso) return "—";
  const start = new Date(startIso);
  const end = new Date(endIso);
  const seconds = Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

function isAbortResponse(res: Response, data: unknown) {
  if (res.status === 499) return true;
  const error = (data as { error?: string } | null)?.error;
  return typeof error === "string" && error.toLowerCase() === "aborted";
}

function sanitizeErrorMessage(raw: unknown, fallback: string) {
  if (typeof raw !== "string" || !raw.trim()) return fallback;
  if (/trace|traceid|request id|diagnostic/i.test(raw)) return fallback;
  return raw;
}

function buildSyncError(data: any, fallback: string) {
  const message = sanitizeErrorMessage(data?.error, fallback);
  return { message };
}


function outcomeBadge(outcome: string) {
  switch (outcome) {
    case "COMPLETED":
      return "bg-emerald-500/15 text-emerald-700 border-emerald-400/30";
    case "NO_ANSWER":
      return "bg-amber-500/15 text-amber-700 border-amber-400/30";
    case "BUSY":
      return "bg-orange-500/15 text-orange-700 border-orange-400/30";
    case "CANCELLED":
      return "bg-slate-400/20 text-slate-700 border-slate-400/30";
    default:
      return "bg-rose-500/15 text-rose-700 border-rose-400/30";
  }
}

function riskBadge(risk: string) {
  if (risk === "blocked") return "bg-rose-500/15 text-rose-700 border-rose-400/30";
  if (risk === "needs_review") return "bg-amber-500/15 text-amber-700 border-amber-400/30";
  return "bg-emerald-500/15 text-emerald-700 border-emerald-400/30";
}

const BarsChart = React.memo(function BarsChart({
  rows,
  metric,
}: {
  rows: StatsRow[];
  metric: MetricKey;
}) {
  const valueForRow = React.useCallback(
    (row: StatsRow) => {
      if (metric === "conversion") {
        return row.count ? Math.round((row.bookings / row.count) * 100) : 0;
      }
      return row[metric];
    },
    [metric]
  );
  const max = React.useMemo(() => Math.max(...rows.map((r) => valueForRow(r)), 1), [rows, valueForRow]);
  return (
    <div className="space-y-2">
      {rows.map((row) => {
        const value = valueForRow(row);
        return (
          <div key={row.label} className="grid grid-cols-[90px_1fr_50px] items-center gap-3 text-sm">
            <span className="text-xs text-zinc-500">{row.label}</span>
            <div className="h-2 rounded-full bg-zinc-100">
              <div
                className="h-2 rounded-full bg-emerald-500"
                style={{
                  width: `${Math.round((value / max) * 100)}%`,
                  backgroundColor: "var(--brand-primary)",
                }}
              />
            </div>
            <span className="text-xs text-zinc-600">{value}</span>
          </div>
        );
      })}
    </div>
  );
});

function buildQuery(filters: Filters, extra?: Record<string, string>) {
  const sp = new URLSearchParams();
  sp.set("from", filters.from);
  sp.set("to", filters.to);
  if (filters.agent) sp.set("agent", filters.agent);
  if (filters.outcome) sp.set("outcome", filters.outcome);
  if (filters.q) sp.set("q", filters.q);
  if (filters.staffId) sp.set("staffId", filters.staffId);
  if (filters.serviceId) sp.set("serviceId", filters.serviceId);
  if (filters.businessHoursOnly) sp.set("businessHoursOnly", "true");
  if (filters.riskRadar) sp.set("riskRadar", "true");
  if (extra) {
    Object.entries(extra).forEach(([key, value]) => sp.set(key, value));
  }
  return sp.toString();
}

export default function CallsAnalyticsClient({
  orgName,
  orgSlug,
  timezone,
  agents,
  staffOptions,
  serviceOptions,
  entitlements,
  initialView,
  initialFilters,
  initialAiSummariesEnabled,
}: {
  orgName: string;
  orgSlug: string;
  timezone: string;
  agents: string[];
  staffOptions: Array<{ id: string; name: string }>;
  serviceOptions: Array<{ id: string; name: string | null }>;
  entitlements: OrgEntitlements;
  initialView: string;
  initialFilters: Filters;
  initialAiSummariesEnabled: boolean;
}) {
  const pollBaseMs = 30_000;
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();

  const [view, setView] = React.useState(initialView === "reports" ? "reports" : "inbox");
  const [filters, setFilters] = React.useState<Filters>(initialFilters);
  const [calls, setCalls] = React.useState<CallItem[]>([]);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [pollDelay, setPollDelay] = React.useState(pollBaseMs);
  const [error, setError] = React.useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = React.useState<number | null>(null);
  const [lastWebhookAt, setLastWebhookAt] = React.useState<string | null>(null);
  const [syncing, setSyncing] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [selectedMissing, setSelectedMissing] = React.useState(false);
  const [detail, setDetail] = React.useState<CallDetail | null>(null);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [showTranscript, setShowTranscript] = React.useState(false);
  const [rescueDraft, setRescueDraft] = React.useState<RescueDraft | null>(null);
  const [rescueLoading, setRescueLoading] = React.useState(false);
  const [stats, setStats] = React.useState<StatsResponse | null>(null);
  const [statsDebug, setStatsDebug] = React.useState<StatsApiResponse["debug"] | null>(null);
  const [statsLoading, setStatsLoading] = React.useState(false);
  const [statsUpdatedAt, setStatsUpdatedAt] = React.useState<number | null>(null);
  const [metric, setMetric] = React.useState<MetricKey>("count");
  const [aiSummariesEnabled, setAiSummariesEnabled] = React.useState(initialAiSummariesEnabled);
  const [savingAiSetting, setSavingAiSetting] = React.useState(false);
  const [showDetailMobile, setShowDetailMobile] = React.useState(false);
  const [manualSyncing, setManualSyncing] = React.useState(false);
  const [syncError, setSyncError] = React.useState<{ message: string } | null>(null);
  const detailAbortRef = React.useRef<AbortController | null>(null);
  const detailRequestRef = React.useRef(0);
  const listRequestRef = React.useRef(0);
  const statsRequestRef = React.useRef(0);
  const selectedIdRef = React.useRef<string | null>(null);
  const interactionRef = React.useRef(0);
  const syncBackoffRef = React.useRef(0);
  const syncTimerRef = React.useRef<number | null>(null);
  const listAbortRef = React.useRef<AbortController | null>(null);
  const syncAbortRef = React.useRef<AbortController | null>(null);
  const manualSyncAbortRef = React.useRef<AbortController | null>(null);
  const memoryAbortRef = React.useRef<AbortController | null>(null);
  const statsAbortRef = React.useRef<AbortController | null>(null);
  const aiSettingAbortRef = React.useRef<AbortController | null>(null);
  const rescueAbortRef = React.useRef<AbortController | null>(null);
  const [nowTick, setNowTick] = React.useState(() => Date.now());
  const [clientMemory, setClientMemory] = React.useState<{
    preferredDays?: string[];
    preferredTimes?: string[];
    tonePreference?: string;
    notes?: string | null;
  } | null>(null);
  const isMountedRef = React.useRef(true);

  React.useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const safeSet = React.useCallback((fn: () => void) => {
    if (!isMountedRef.current) return;
    fn();
  }, []);

  const queryString = React.useMemo(() => buildQuery(filters), [filters]);

  const updateView = (next: "inbox" | "reports") => {
    setView(next);
    const sp = new URLSearchParams(searchParams.toString());
    sp.set("view", next);
    router.replace(`/analytics/calls?${sp.toString()}`);
  };

  const loadCalls = React.useCallback(
    async ({ cursor, append, silent }: { cursor?: string; append?: boolean; silent?: boolean } = {}) => {
      listRequestRef.current += 1;
      const requestId = listRequestRef.current;
      if (!silent) safeSet(() => setLoading(true));
      safeSet(() => setSyncing(true));
      safeSet(() => setError(null));
      if (listAbortRef.current) listAbortRef.current.abort();
      const controller = new AbortController();
      listAbortRef.current = controller;
      try {
        const qs = cursor ? buildQuery(filters, { cursor }) : queryString;
        const res = await fetch(`/api/org/calls?${qs}`, { cache: "no-store", signal: controller.signal });
        const data = await res.json().catch(() => ({}));
        if (isAbortResponse(res, data)) return;
        if (!res.ok || (data && data.ok === false)) {
          throw new Error(data.error || "Failed to load calls");
        }
        const items = (data.items as CallItem[]) || [];
        if (!isMountedRef.current || listRequestRef.current !== requestId) return;
        safeSet(() => {
          setCalls((prev) => {
            if (append) return [...prev, ...items];
            const prevMap = new Map(prev.map((call) => [call.id, call]));
            return items.map((item) => ({ ...(prevMap.get(item.id) || {}), ...item }));
          });
          setNextCursor(data.nextCursor || null);
          setLastWebhookAt(typeof data.lastWebhookAt === "string" ? data.lastWebhookAt : null);
          setPollDelay(pollBaseMs);
          setLastUpdatedAt(Date.now());
          if (!append && selectedIdRef.current) {
            const exists = items.some((item) => item.id === selectedIdRef.current);
            if (!exists) {
              setSelectedMissing(true);
            } else {
              setSelectedMissing(false);
            }
          }
        });
      } catch (e: any) {
        if (e?.name !== "AbortError") {
          safeSet(() => {
            setError(sanitizeErrorMessage(e?.message, "Failed to load calls"));
            setPollDelay((prev) => Math.min(prev * 2, 60000));
          });
        }
      } finally {
        if (isMountedRef.current && listRequestRef.current === requestId) {
          safeSet(() => {
            setSyncing(false);
            if (!silent) setLoading(false);
          });
        }
      }
    },
    [filters, pollBaseMs, queryString, safeSet]
  );

  const loadDetail = React.useCallback(async (id: string) => {
    detailRequestRef.current += 1;
    const requestId = detailRequestRef.current;
    if (detailAbortRef.current) detailAbortRef.current.abort();
    const controller = new AbortController();
    detailAbortRef.current = controller;
    safeSet(() => setDetailLoading(true));
    try {
      const res = await fetch(`/api/org/calls/${id}`, { cache: "no-store", signal: controller.signal });
      const data = await res.json().catch(() => ({}));
      if (isAbortResponse(res, data)) return;
      if (!res.ok || (data && data.ok === false)) {
        throw new Error(data.error || "Failed to load call detail");
      }
      if (!isMountedRef.current || detailRequestRef.current !== requestId) return;
      safeSet(() => setDetail(data.call as CallDetail));
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      toast.show(sanitizeErrorMessage(e?.message, "Failed to load call detail"), "error");
    } finally {
      if (isMountedRef.current && detailRequestRef.current === requestId) {
        safeSet(() => setDetailLoading(false));
      }
    }
  }, [safeSet, toast]);

  const loadStats = React.useCallback(async () => {
    statsRequestRef.current += 1;
    const requestId = statsRequestRef.current;
    safeSet(() => setStatsLoading(true));
    if (statsAbortRef.current) statsAbortRef.current.abort();
    const controller = new AbortController();
    statsAbortRef.current = controller;
    try {
      const res = await fetch(`/api/org/calls/stats?${queryString}`, { cache: "no-store", signal: controller.signal });
      const data = (await res.json().catch(() => ({}))) as StatsApiResponse;
      if (isAbortResponse(res, data)) return;
      if (!res.ok || (data && (data as any).ok === false)) {
        throw new Error(sanitizeErrorMessage((data as any).error, "Failed to load stats"));
      }
      if (!isMountedRef.current || statsRequestRef.current !== requestId) return;
      safeSet(() => {
        setStats(data.data || null);
        setStatsDebug(data.debug || null);
        setStatsUpdatedAt(Date.now());
      });
    } catch (e: any) {
      if (e?.name !== "AbortError") {
        toast.show(sanitizeErrorMessage(e?.message, "Failed to load stats"), "error");
      }
    } finally {
      if (isMountedRef.current && statsRequestRef.current === requestId) {
        safeSet(() => setStatsLoading(false));
      }
    }
  }, [queryString, safeSet, toast]);

  React.useEffect(() => {
    if (view !== "inbox") return;
    setCalls([]);
    setNextCursor(null);
    setShowDetailMobile(false);
    loadCalls();
  }, [filters, loadCalls, view]);

  React.useEffect(() => {
    if (view !== "inbox") return;
    const timer = window.setInterval(() => {
      if (detailLoading) return;
      if (Date.now() - interactionRef.current < 2000) return;
      loadCalls({ silent: true });
    }, pollDelay);
    return () => window.clearInterval(timer);
  }, [detailLoading, loadCalls, pollDelay, view]);

  React.useEffect(() => {
    if (view !== "inbox") return;
    const backoffSteps = [2000, 5000, 10000, 30000];

    const schedule = (delay: number) => {
      if (syncTimerRef.current) window.clearTimeout(syncTimerRef.current);
      syncTimerRef.current = window.setTimeout(() => run(false), delay);
    };

    async function run(force: boolean) {
      if (syncAbortRef.current) syncAbortRef.current.abort();
      const controller = new AbortController();
      syncAbortRef.current = controller;
      try {
        if (!force) {
          const lastTs = lastWebhookAt ? Date.parse(lastWebhookAt) : 0;
          const tooOld = !lastTs || Date.now() - lastTs > 10 * 60 * 1000;
          if (!tooOld) {
            schedule(4 * 60 * 1000);
            return;
          }
        }
        const res = await fetch("/api/org/calls/sync", { method: "POST", signal: controller.signal });
        const data = await res.json().catch(() => ({}));
        if (isAbortResponse(res, data)) return;
        if (!res.ok || (data && data.ok === false)) {
          safeSet(() => setSyncError(buildSyncError(data, "Sync failed")));
          const idx = Math.min(syncBackoffRef.current + 1, backoffSteps.length - 1);
          syncBackoffRef.current = idx;
          schedule(backoffSteps[idx]);
          return;
        }
        safeSet(() => setSyncError(null));
        syncBackoffRef.current = 0;
        schedule(4 * 60 * 1000);
      } catch (err: any) {
        if (err?.name === "AbortError") return;
        safeSet(() => setSyncError({ message: sanitizeErrorMessage(err?.message, "Sync failed") }));
        const idx = Math.min(syncBackoffRef.current + 1, backoffSteps.length - 1);
        syncBackoffRef.current = idx;
        schedule(backoffSteps[idx]);
      }
    }

    run(true);
    return () => {
      if (syncAbortRef.current) syncAbortRef.current.abort();
      if (syncTimerRef.current) window.clearTimeout(syncTimerRef.current);
    };
  }, [view, lastWebhookAt]);

  const runManualSync = React.useCallback(async () => {
    if (manualSyncAbortRef.current) manualSyncAbortRef.current.abort();
    if (syncAbortRef.current) syncAbortRef.current.abort();
    const controller = new AbortController();
    manualSyncAbortRef.current = controller;
    safeSet(() => setManualSyncing(true));
    try {
      const res = await fetch("/api/org/calls/sync", { method: "POST", signal: controller.signal });
      const data = await res.json().catch(() => ({}));
      if (isAbortResponse(res, data)) return;
      if (!res.ok || (data && data.ok === false)) {
        const errPayload = buildSyncError(data, "Sync failed");
        safeSet(() => setSyncError(errPayload));
        throw new Error(errPayload.message);
      }
      safeSet(() => setSyncError(null));
      syncBackoffRef.current = 0;
      await loadCalls({ silent: true });
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      toast.show(sanitizeErrorMessage(e?.message, "Sync failed"), "error");
    } finally {
      safeSet(() => setManualSyncing(false));
    }
  }, [loadCalls, safeSet, toast]);

  React.useEffect(() => {
    if (view !== "reports") return;
    loadStats();
    const timer = window.setInterval(() => {
      loadStats();
    }, 45_000);
    return () => window.clearInterval(timer);
  }, [loadStats, view]);

React.useEffect(() => {
  if (view !== "inbox") return;

  // derive locally so TS knows it's always defined
  const isProcessing = (() => {
    if (!lastWebhookAt) return true;
    const lastTs = Date.parse(lastWebhookAt);
    if (!Number.isFinite(lastTs)) return true;
    return nowTick - lastTs > 10 * 60 * 1000;
  })();

  if (!isProcessing) return;

  const timer = window.setTimeout(() => {
    if (detailLoading) return;
    if (Date.now() - interactionRef.current < 2000) return;
    loadCalls({ silent: true });
  }, 2000);

  return () => window.clearTimeout(timer);
}, [detailLoading, lastWebhookAt, nowTick, loadCalls, view]);

  React.useEffect(() => {
    if (!selectedId) {
      if (detailAbortRef.current) detailAbortRef.current.abort();
      if (rescueAbortRef.current) rescueAbortRef.current.abort();
      setDetail(null);
      setDetailLoading(false);
      setRescueDraft(null);
      setRescueLoading(false);
      setSelectedMissing(false);
      return;
    }
    setDetail(null);
    setRescueDraft(null);
    setRescueLoading(false);
    setSelectedMissing(false);
    void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  React.useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  React.useEffect(() => {
    setShowTranscript(false);
  }, [detail?.id]);

  React.useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  React.useEffect(() => {
    const customerId = detail?.appointment?.customerId || null;
    if (!customerId) {
      safeSet(() => setClientMemory(null));
      return;
    }
    if (memoryAbortRef.current) memoryAbortRef.current.abort();
    const controller = new AbortController();
    memoryAbortRef.current = controller;
    async function loadMemory() {
      try {
        const res = await fetch(`/api/org/clients/${customerId}/profile`, { cache: "no-store", signal: controller.signal });
        const data = await res.json().catch(() => ({}));
        if (isAbortResponse(res, data)) return;
        if (!res.ok || !data?.ok) {
          safeSet(() => setClientMemory(null));
          return;
        }
        if (!isMountedRef.current) return;
        safeSet(() => setClientMemory(data.profile || null));
      } catch (e: any) {
        if (e?.name === "AbortError") return;
        safeSet(() => setClientMemory(null));
      }
    }
    loadMemory();
    return () => controller.abort();
  }, [detail?.appointment?.customerId, safeSet]);

  function applyPreset(days: number) {
    const end = new Date();
    const start = new Date(end.getTime() - days * 86400000);
    const toInput = (d: Date) => d.toISOString().slice(0, 10);
    setFilters((prev) => ({ ...prev, from: toInput(start), to: toInput(end) }));
  }

  async function saveAiSetting(next: boolean) {
    if (aiSettingAbortRef.current) aiSettingAbortRef.current.abort();
    const controller = new AbortController();
    aiSettingAbortRef.current = controller;
    safeSet(() => setSavingAiSetting(true));
    try {
      const res = await fetch("/api/org/calls/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ enableAiSummaries: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (isAbortResponse(res, data)) return;
      if (!res.ok) throw new Error(data.error || "Failed to update setting");
      if (!isMountedRef.current) return;
      safeSet(() => setAiSummariesEnabled(next));
      toast.show("AI summary setting updated.", "success");
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      toast.show(e?.message || "Failed to update setting", "error");
    } finally {
      safeSet(() => setSavingAiSetting(false));
    }
  }

  async function copyToClipboard(value: string, message: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.show(message, "success");
    } catch {
      toast.show("Copy failed", "error");
    }
  }

  async function loadRescueDraft(rewrite: boolean) {
    if (!detail?.id) return;
    if (rescueAbortRef.current) rescueAbortRef.current.abort();
    const controller = new AbortController();
    rescueAbortRef.current = controller;
    safeSet(() => setRescueLoading(true));
    try {
      const res = await fetch("/api/org/calls/rescue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ callId: detail.id, rewrite }),
      });
      const data = await res.json().catch(() => ({}));
      if (isAbortResponse(res, data)) return;
      if (!res.ok || !data?.ok) throw new Error(data.error || "Failed to build rescue draft");
      if (!isMountedRef.current) return;
      safeSet(() => setRescueDraft(data.draft as RescueDraft));
    } catch (e: any) {
      if (e?.name !== "AbortError") toast.show(e?.message || "Failed to build rescue draft", "error");
    } finally {
      safeSet(() => setRescueLoading(false));
    }
  }

  const detailPanel = detail ? (
    <div className="space-y-4">
      {selectedMissing ? (
        <Card className="border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
          This call is no longer in the current filter range.
        </Card>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Badge className={riskBadge(detail.risk)}>{detail.risk.replace("_", " ")}</Badge>
        <Badge variant="neutral">{detail.category.replace("_", " ")}</Badge>
        <Badge className={outcomeBadge(detail.outcome)}>{detail.outcome.replace(/_/g, " ")}</Badge>
        <Badge variant="neutral">{detail.priority}</Badge>
      </div>

      <Card className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Caller</p>
            <p className="mt-1 text-lg font-semibold text-zinc-900">
              {formatCallerPhone(detail.callerPhone, detail.businessPhone)}
            </p>
            <p className="text-xs text-zinc-500">{formatDateTime(detail.startedAt)} · {formatDuration(detail.startedAt, detail.endedAt)}</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            {detail.recordingUrl && (
              <a
                href={detail.recordingUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-medium text-emerald-700 underline"
              >
                Open recording
              </a>
            )}
            <Button
              variant="secondary"
              onClick={() => copyToClipboard(JSON.stringify(detail.rawJson, null, 2), "Call JSON copied.")}
            >
              Copy call JSON
            </Button>
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Summary</p>
        <p className="mt-2 text-sm text-zinc-900">{detail.summary.system}</p>
        {detail.summary.ai && (
          <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            <div className="text-[11px] uppercase tracking-[0.2em] text-emerald-700">AI-refined summary</div>
            <p className="mt-1">{detail.summary.ai}</p>
          </div>
        )}
      </Card>

      {detail.outcome === "NO_ANSWER" && (
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">One-click rescue</p>
            <Badge variant="warning">Missed call</Badge>
          </div>
          <p className="text-sm text-zinc-600">
            Send an apology + booking link draft. Draft-only unless you enable sending.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" onClick={() => loadRescueDraft(false)} disabled={rescueLoading}>
              {rescueLoading ? "Building..." : "Build draft"}
            </Button>
            {entitlements.features.emailAi && (
              <Button variant="secondary" onClick={() => loadRescueDraft(true)} disabled={rescueLoading}>
                {rescueLoading ? "Rewriting..." : "AI rewrite"}
              </Button>
            )}
          </div>
          {rescueDraft && (
            <div className="space-y-3 text-sm text-zinc-700">
              <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2">
                <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">SMS draft</div>
                <p className="mt-2 whitespace-pre-wrap">{rescueDraft.sms}</p>
                <div className="mt-2">
                  <Button
                    variant="secondary"
                    onClick={() => copyToClipboard(rescueDraft.sms, "SMS draft copied.")}
                  >
                    Copy SMS
                  </Button>
                </div>
              </div>
              <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2">
                <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Email draft</div>
                <div className="mt-2 text-xs text-zinc-500">Subject: {rescueDraft.emailSubject}</div>
                <p className="mt-2 whitespace-pre-wrap">{rescueDraft.emailBody}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    onClick={() =>
                      copyToClipboard(
                        `Subject: ${rescueDraft.emailSubject}\n\n${rescueDraft.emailBody}`,
                        "Email draft copied."
                      )
                    }
                  >
                    Copy email
                  </Button>
                  {rescueDraft.aiRewritten && (
                    <Badge variant="info">AI rewrite</Badge>
                  )}
                </div>
              </div>
            </div>
          )}
        </Card>
      )}

      <Card className="p-4">
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Steps</p>
        <div className="mt-3 space-y-2 text-sm text-zinc-700">
          {detail.steps.map((step) => (
            <div key={step} className="flex items-start gap-2">
              <span className="mt-1 h-2 w-2 rounded-full bg-emerald-500" />
              <span>{step}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-4">
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Key fields</p>
        <div className="mt-3 grid gap-2 text-sm text-zinc-700 sm:grid-cols-2">
          {Object.keys(detail.fields).length === 0 && (
            <span className="text-xs text-zinc-500">No structured fields detected.</span>
          )}
          {Object.entries(detail.fields).map(([key, value]) => (
            <div key={key} className="rounded-lg border border-zinc-200 px-3 py-2">
              <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">{key}</div>
              <div className="mt-1 text-sm text-zinc-800">{value}</div>
            </div>
          ))}
        </div>
      </Card>

      {detail.transcript && (
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Transcript</p>
            <Button variant="secondary" onClick={() => setShowTranscript((prev) => !prev)}>
              {showTranscript ? "Hide" : "Show"}
            </Button>
          </div>
          {showTranscript && (
            <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-700">{detail.transcript}</p>
          )}
        </Card>
      )}

      <IntentActionsPanel
        text={detail.transcript || detail.summary.system}
        category={detail.category}
        risk={detail.risk}
        orgSlug={orgSlug}
        memory={clientMemory || undefined}
      />

      {detail.appointment && (
        <Card className="p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Booking created</p>
          <div className="mt-2 text-sm text-zinc-700">
            <div className="font-medium text-zinc-900">{detail.appointment.customerName}</div>
            <div>{detail.appointment.serviceName || "Service"} · {detail.appointment.staffName || "Staff"}</div>
            <div>{formatDateTime(detail.appointment.startsAt)}</div>
          </div>
        </Card>
      )}
    </div>
  ) : detailLoading ? (
    <Card className="p-6 space-y-3">
      <div className="h-4 w-32 rounded bg-zinc-100 animate-pulse" />
      <div className="h-6 w-48 rounded bg-zinc-100 animate-pulse" />
      <div className="h-24 rounded bg-zinc-100 animate-pulse" />
    </Card>
  ) : (
    <Card className="p-6 text-sm text-zinc-600">
      Select a call to view details.
    </Card>
  );

  const safeStats = React.useMemo<StatsResponse>(() => {
    const totals = stats?.totals || { count: 0, minutes: 0, missed: 0, answered: 0, bookings: 0 };
    return {
      totals: {
        count: Number.isFinite(totals.count) ? totals.count : 0,
        minutes: Number.isFinite(totals.minutes) ? totals.minutes : 0,
        missed: Number.isFinite(totals.missed) ? totals.missed : 0,
        answered: Number.isFinite(totals.answered) ? totals.answered : 0,
        bookings: Number.isFinite(totals.bookings) ? totals.bookings : 0,
      },
      weekly: Array.isArray(stats?.weekly) ? stats!.weekly.map((row) => ({
        label: row.label,
        count: Number.isFinite(row.count) ? row.count : 0,
        minutes: Number.isFinite(row.minutes) ? row.minutes : 0,
        missed: Number.isFinite(row.missed) ? row.missed : 0,
        answered: Number.isFinite(row.answered) ? row.answered : 0,
        bookings: Number.isFinite(row.bookings) ? row.bookings : 0,
      })) : [],
      monthly: Array.isArray(stats?.monthly) ? stats!.monthly.map((row) => ({
        label: row.label,
        count: Number.isFinite(row.count) ? row.count : 0,
        minutes: Number.isFinite(row.minutes) ? row.minutes : 0,
        missed: Number.isFinite(row.missed) ? row.missed : 0,
        answered: Number.isFinite(row.answered) ? row.answered : 0,
        bookings: Number.isFinite(row.bookings) ? row.bookings : 0,
      })) : [],
      timezone: stats?.timezone || timezone,
      lastWebhookAt: stats?.lastWebhookAt ?? null,
    };
  }, [stats, timezone]);

  const metrics = safeStats.totals;
  const metricLabels: Record<MetricKey, string> = {
    count: "Calls",
    minutes: "Minutes",
    missed: "Missed",
    answered: "Answered",
    bookings: "Bookings",
    conversion: "Conversion %",
  };

  const weeklySeries = React.useMemo(() => safeStats.weekly.slice(-8), [safeStats.weekly]);
  const monthlySeries = React.useMemo(() => safeStats.monthly.slice(-6), [safeStats.monthly]);
  const lastWebhookEffective = lastWebhookAt || safeStats.lastWebhookAt || null;
  const callsProcessing = React.useMemo(() => {
    if (!lastWebhookEffective) return true;
    const lastTs = Date.parse(lastWebhookEffective);
    if (!Number.isFinite(lastTs)) return true;
    return nowTick - lastTs > 10 * 60 * 1000;
  }, [lastWebhookEffective, nowTick]);
  const syncUnavailable = view === "inbox" && (!lastWebhookEffective || Boolean(syncError));

  const inboxView = (
    <div className="space-y-6">
      {syncUnavailable && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-sm">
          <div className="font-semibold">Analytics (Beta) — Sync temporarily unavailable. Data may be delayed.</div>
          <div className="mt-1 text-xs text-amber-800">
            Feature coming soon / may be incomplete while we polish.
          </div>
        </div>
      )}
      <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1">
            <label className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">From</label>
            <Input
              type="date"
              value={filters.from}
              onChange={(e) => setFilters((prev) => ({ ...prev, from: e.target.value }))}
            />
          </div>
          <div className="grid gap-1">
            <label className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">To</label>
            <Input
              type="date"
              value={filters.to}
              onChange={(e) => setFilters((prev) => ({ ...prev, to: e.target.value }))}
            />
          </div>
          <div className="grid gap-1">
            <label className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Agent</label>
            <Select
              value={filters.agent}
              onChange={(e) => setFilters((prev) => ({ ...prev, agent: e.target.value }))}
            >
              <option value="">All agents</option>
              {agents.map((agent) => (
                <option key={agent} value={agent}>
                  {agent}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid gap-1">
            <label className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Outcome</label>
            <Select
              value={filters.outcome}
              onChange={(e) => setFilters((prev) => ({ ...prev, outcome: e.target.value }))}
            >
              <option value="">All outcomes</option>
              <option value="COMPLETED">Completed</option>
              <option value="NO_ANSWER">No answer</option>
              <option value="BUSY">Busy</option>
              <option value="FAILED">Failed</option>
              <option value="CANCELLED">Cancelled</option>
            </Select>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => applyPreset(1)}>Today</Button>
            <Button variant="secondary" onClick={() => applyPreset(7)}>7d</Button>
            <Button variant="secondary" onClick={() => applyPreset(30)}>30d</Button>
            <Button variant="secondary" onClick={() => applyPreset(90)}>90d</Button>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                const qs = buildQuery(filters);
                window.location.assign(`/api/org/export/calls?${qs}`);
                toast.show("Export started.", "success");
              }}
            >
              Export CSV
            </Button>
            <Button
              variant="primary"
              onClick={() => loadCalls()}
              disabled={loading}
            >
              {loading ? "Refreshing..." : "Refresh"}
            </Button>
            <Button
              variant="secondary"
              onClick={runManualSync}
              disabled={manualSyncing}
            >
              {manualSyncing ? "Syncing..." : "Force sync"}
            </Button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Input
            placeholder="Search transcript or summary..."
            value={filters.q}
            onChange={(e) => setFilters((prev) => ({ ...prev, q: e.target.value }))}
            className="max-w-sm"
          />
          <label className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-zinc-500">
            <input
              type="checkbox"
              checked={filters.riskRadar}
              onChange={(e) => setFilters((prev) => ({ ...prev, riskRadar: e.target.checked }))}
            />
            Risk radar
          </label>
          {error && <span className="text-xs text-rose-600">{error}</span>}
          <Badge variant="neutral">{calls.length} calls</Badge>
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span className={`inline-flex h-2 w-2 rounded-full ${syncing ? "bg-emerald-500" : "bg-zinc-300"}`} />
            {callsProcessing ? "Processing calls..." : syncing ? "Syncing..." : "Live"}
            <span>·</span>
            <span>Auto-refresh ~{Math.round(pollDelay / 1000)}s</span>
            {lastUpdatedAt && (
              <>
                <span>·</span>
                <span>Last updated {Math.max(1, Math.floor((nowTick - lastUpdatedAt) / 1000))}s ago</span>
              </>
            )}
            <span>·</span>
            <span>Auto-action threshold {entitlements.automation.minConfidence ?? 92}%</span>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <Card className="p-3">
          <div
            className="max-h-[70vh] space-y-2 overflow-y-auto pr-1"
            onScroll={() => {
              interactionRef.current = Date.now();
            }}
          >
            {loading && calls.length === 0 ? (
              <div className="space-y-2">
                {skeletonKeys.map((key) => (
                  <div key={key} className="h-16 rounded-lg bg-zinc-100 animate-pulse" />
                ))}
              </div>
            ) : calls.length === 0 ? (
              <EmptyState title="No calls yet" body="Make a test call or adjust your filters." />
            ) : (
              calls.map((call) => (
                <button
                  key={call.id}
                  onClick={() => {
                    interactionRef.current = Date.now();
                    setSelectedId(call.id);
                    setShowDetailMobile(true);
                  }}
                  className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                    selectedId === call.id ? "border-emerald-300 bg-emerald-50/70" : "border-zinc-200 hover:bg-zinc-50"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <Badge className={outcomeBadge(call.outcome)}>{call.outcome.replace(/_/g, " ")}</Badge>
                    <span className="text-xs text-zinc-500">{formatTime(call.startedAt)}</span>
                  </div>
                  <div className="mt-2 text-sm font-semibold text-zinc-900">
                    {formatCallerPhone(call.callerPhone, call.businessPhone)}
                  </div>
                  <div className="mt-1 text-xs text-zinc-500 line-clamp-2">{call.summary}</div>
                  {call.riskRadar?.flagged && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-amber-700">
                      <Badge variant="warning" title={call.riskRadar.flags.join(", ")}>
                        Risk radar
                      </Badge>
                      {call.riskRadar.flags.slice(0, 2).map((flag) => (
                        <span key={flag}>{flag}</span>
                      ))}
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                    <span>{call.category.replace("_", " ")}</span>
                    <span>•</span>
                    <span>{call.priority}</span>
                    <span>•</span>
                    <span>{formatDuration(call.startedAt, call.endedAt)}</span>
                  </div>
                </button>
              ))
            )}
          </div>
          {nextCursor && (
            <div className="mt-3 flex justify-center">
              <Button
                variant="secondary"
                onClick={() => loadCalls({ cursor: nextCursor, append: true })}
              >
                Load more
              </Button>
            </div>
          )}
        </Card>

        <div className="hidden lg:block">
          {detailLoading ? (
            <Card className="p-6 text-sm text-zinc-600">Loading call detail...</Card>
          ) : (
            detailPanel
          )}
        </div>

        {showDetailMobile && (
          <div className="fixed inset-0 z-50 bg-white lg:hidden">
            <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
              <Button variant="ghost" onClick={() => setShowDetailMobile(false)}>
                Back
              </Button>
              <span className="text-sm font-medium text-zinc-800">Call detail</span>
              <span />
            </div>
            <div className="overflow-y-auto p-4">
              {detailLoading ? <Card className="p-6 text-sm text-zinc-600">Loading...</Card> : detailPanel}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const reportsView = (
    <div className="space-y-6">
      <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="grid gap-1 text-xs font-medium uppercase tracking-widest text-zinc-500">
            From
            <Input
              type="date"
              value={filters.from}
              onChange={(e) => setFilters((prev) => ({ ...prev, from: e.target.value }))}
            />
          </label>
          <label className="grid gap-1 text-xs font-medium uppercase tracking-widest text-zinc-500">
            To
            <Input
              type="date"
              value={filters.to}
              onChange={(e) => setFilters((prev) => ({ ...prev, to: e.target.value }))}
            />
          </label>
          <label className="grid gap-1 text-xs font-medium uppercase tracking-widest text-zinc-500">
            Outcome
            <Select
              value={filters.outcome}
              onChange={(e) => setFilters((prev) => ({ ...prev, outcome: e.target.value }))}
            >
              <option value="">All outcomes</option>
              <option value="COMPLETED">Completed</option>
              <option value="NO_ANSWER">No answer</option>
              <option value="BUSY">Busy</option>
              <option value="FAILED">Failed</option>
              <option value="CANCELLED">Cancelled</option>
            </Select>
          </label>
          <label className="grid gap-1 text-xs font-medium uppercase tracking-widest text-zinc-500">
            Staff
            <Select
              value={filters.staffId}
              onChange={(e) => setFilters((prev) => ({ ...prev, staffId: e.target.value }))}
            >
              <option value="">All staff</option>
              {staffOptions.map((staff) => (
                <option key={staff.id} value={staff.id}>
                  {staff.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="grid gap-1 text-xs font-medium uppercase tracking-widest text-zinc-500">
            Service
            <Select
              value={filters.serviceId}
              onChange={(e) => setFilters((prev) => ({ ...prev, serviceId: e.target.value }))}
            >
              <option value="">All services</option>
              {serviceOptions.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name || "Service"}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-zinc-500">
            <input
              type="checkbox"
              checked={filters.businessHoursOnly}
              onChange={(e) => setFilters((prev) => ({ ...prev, businessHoursOnly: e.target.checked }))}
            />
            Business hours only
          </label>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500">
        {callsProcessing && <span>Processing calls…</span>}
        {statsUpdatedAt && (
          <span>Last updated {Math.max(1, Math.floor((nowTick - statsUpdatedAt) / 1000))}s ago</span>
        )}
        {safeStats.lastWebhookAt && (
          <>
            <span>·</span>
            <span>Last webhook {formatDateTime(safeStats.lastWebhookAt)}</span>
          </>
        )}
        {statsDebug && (
          <>
            <span>·</span>
            <span>
              Debug range {statsDebug.from.slice(0, 10)} → {statsDebug.to.slice(0, 10)} · rows {statsDebug.rows.filtered}/{statsDebug.rows.total}
            </span>
          </>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Total calls</p>
          <p className="mt-2 text-2xl font-semibold text-zinc-900">{metrics?.count ?? 0}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Answered</p>
          <p className="mt-2 text-2xl font-semibold text-zinc-900">{metrics?.answered ?? 0}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Missed</p>
          <p className="mt-2 text-2xl font-semibold text-zinc-900">{metrics?.missed ?? 0}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Bookings</p>
          <p className="mt-2 text-2xl font-semibold text-zinc-900">{metrics?.bookings ?? 0}</p>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ["count", "Call count"],
            ["minutes", "Total minutes"],
            ["missed", "Missed"],
            ["answered", "Answered"],
            ["bookings", "Bookings"],
            ["conversion", "Conversion %"],
          ] as const
        ).map(([key, label]) => (
          <Button
            key={key}
            variant={metric === key ? "primary" : "secondary"}
            onClick={() => setMetric(key)}
          >
            {label}
          </Button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <Button variant="secondary" onClick={() => loadStats()} disabled={statsLoading}>
            {statsLoading ? "Refreshing..." : "Refresh stats"}
          </Button>
          <Button
            variant={aiSummariesEnabled ? "primary" : "secondary"}
            onClick={() => saveAiSetting(!aiSummariesEnabled)}
            disabled={savingAiSetting}
          >
            {aiSummariesEnabled ? "AI summaries on" : "AI summaries off"}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
              Weekly {metricLabels[metric]}
            </p>
            <span className="text-xs text-zinc-500">{safeStats.timezone}</span>
          </div>
          <div className="mt-4">
            {statsLoading ? (
              <div className="h-40 rounded-lg bg-zinc-100 animate-pulse" />
            ) : safeStats.weekly.length ? (
              <BarsChart rows={weeklySeries} metric={metric} />
            ) : (
              <p className="text-sm text-zinc-500">No data available.</p>
            )}
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
              Monthly {metricLabels[metric]}
            </p>
            <span className="text-xs text-zinc-500">{safeStats.timezone}</span>
          </div>
          <div className="mt-4">
            {statsLoading ? (
              <div className="h-40 rounded-lg bg-zinc-100 animate-pulse" />
            ) : safeStats.monthly.length ? (
              <BarsChart rows={monthlySeries} metric={metric} />
            ) : (
              <p className="text-sm text-zinc-500">No data available.</p>
            )}
          </div>
        </Card>
      </div>
    </div>
  );

return (
  <div className="space-y-6">
    {toast.node}

    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Call analytics</p>
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">
          Calls for {orgName}
        </h1>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant={view === "inbox" ? "primary" : "secondary"}
          onClick={() => updateView("inbox")}
        >
          Calls inbox
        </Button>
        <Button
          variant={view === "reports" ? "primary" : "secondary"}
          onClick={() => updateView("reports")}
        >
          Charts & reports
        </Button>
      </div>
    </header>

    <Card className="border border-amber-200/70 bg-gradient-to-r from-amber-50 via-white to-amber-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Badge variant="info">Analytics (Beta)</Badge>
          <p className="text-sm text-zinc-600">
            We are polishing call analytics - new data can take up to 60s to appear.
          </p>
        </div>
      </div>

      {syncError ? (
        <div className="mt-2 text-xs text-amber-700">Sync temporarily unavailable. Try again shortly.</div>
      ) : null}
    </Card>

    {view === "inbox" ? inboxView : reportsView}
  </div>
);
}
