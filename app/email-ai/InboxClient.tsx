"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { signIn, useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Skeleton from "@/components/Skeleton";
import BrandLogo from "@/components/BrandLogo";
import IntentActionsPanel from "@/components/IntentActionsPanel";
import type { BrandingConfig } from "@/lib/branding";

type InboxItem = {
  id: string;
  createdAt: string;
  receivedAt: string | null;
  subject: string | null;
  snippet: string | null;
  gmailThreadId: string | null;
  gmailMsgId: string | null;
  action: string | null;
  confidence: number | null;
  classification: string | null;
  rawMeta: any;
};

type InboxSettings = {
  enableAutoDraft: boolean;
  enableAutoSend: boolean;
  autoSendAllowedCategories: string[];
  autoSendMinConfidence: number;
  neverAutoSendCategories: string[];
  businessHoursOnly: boolean;
  dailySendCap: number;
  requireApprovalForFirstN: number;
  automationPaused: boolean;
};

type SyncState = {
  lastAttemptAt?: number | null;
  lastSuccessAt?: number | null;
  lastErrorAt?: number | null;
  lastError?: string | null;
};

type TokenResp = {
  ok: boolean;
  connected: boolean;
  email: string | null;
  expires_at: number | null;
  had_google_provider?: boolean;
  has_refresh_token?: boolean;
  reason?: string | null;
  error?: string;
};

type OrgIdentity = {
  org: { id: string; name: string; slug: string; address?: string; phone?: string; email?: string };
  branding: BrandingConfig;
  demoMode: boolean;
  entitlements?: { features?: { emailAi?: boolean } };
};

type LogDetail = {
  id: string;
  subject: string;
  snippet: string;
  action: string;
  classification: string;
  confidence: number | null;
  gmailThreadId: string | null;
  suggested?: { subject?: string; body?: string } | null;
  thread?: Array<{ id: string; date: string; from: string; body: string }>;
  meta?: { from?: string; replyTo?: string };
  ai?: { reasons?: string[]; usedSnippets?: string[] };
};

const FILTERS = [
  { key: "all", label: "All" },
  { key: "needs_review", label: "Needs review" },
  { key: "auto_send", label: "Auto-send eligible" },
  { key: "sent", label: "Sent by AI" },
  { key: "blocked", label: "Blocked" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

type SortKey = "priority" | "newest";

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function formatWhen(iso: string) {
  const date = new Date(iso);
  const rel = new Intl.RelativeTimeFormat("en-NZ", { numeric: "auto" });
  const diff = Math.round((date.getTime() - Date.now()) / 60000);
  const minutes = Math.abs(diff);
  const label =
    minutes < 60
      ? rel.format(diff, "minute")
      : minutes < 1440
      ? rel.format(Math.round(diff / 60), "hour")
      : rel.format(Math.round(diff / 1440), "day");
  return `${date.toLocaleString()} • ${label}`;
}

function getAI(item: InboxItem) {
  const ai = (item.rawMeta as any)?.ai ?? {};
  const category = ai.category || item.classification || "other";
  const priority = ai.priority || "normal";
  const risk = ai.risk || "safe";
  const reasons = Array.isArray(ai.reasons) ? ai.reasons : [];
  const confidence =
    typeof ai.confidence === "number"
      ? ai.confidence
      : typeof item.confidence === "number"
      ? item.confidence
      : null;
  return { category, priority, risk, reasons, confidence };
}

function priorityScore(priority: string) {
  if (priority === "urgent") return 3;
  if (priority === "high") return 2;
  if (priority === "normal") return 1;
  return 0;
}

const DEMO_ITEMS: InboxItem[] = [
  {
    id: "demo_1",
    createdAt: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
    receivedAt: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
    subject: "Can I book a cut tomorrow at 3?",
    snippet: "Hey! Do you have anything tomorrow around 3pm?",
    gmailThreadId: null,
    gmailMsgId: null,
    action: "queued_for_review",
    confidence: 0.94,
    classification: "booking_request",
    rawMeta: { from: "Demo Client <demo@example.com>", ai: { category: "booking_request", priority: "high", risk: "safe", confidence: 0.94, reasons: ["Contains booking intent"] } },
  },
  {
    id: "demo_2",
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    receivedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    subject: "Pricing for tint + blow wave?",
    snippet: "Could you share pricing for tint + blow wave? Cheers!",
    gmailThreadId: null,
    gmailMsgId: null,
    action: "draft_created",
    confidence: 0.9,
    classification: "pricing",
    rawMeta: { from: "Demo Client <demo2@example.com>", ai: { category: "pricing", priority: "normal", risk: "safe", confidence: 0.9, reasons: ["Pricing keyword"] } },
  },
  {
    id: "demo_3",
    createdAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
    receivedAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
    subject: "Need to reschedule Friday",
    snippet: "Hi team, can we reschedule our Friday appointment?",
    gmailThreadId: null,
    gmailMsgId: null,
    action: "queued_for_review",
    confidence: 0.88,
    classification: "reschedule",
    rawMeta: { from: "Demo Client <demo3@example.com>", ai: { category: "reschedule", priority: "normal", risk: "needs_review", confidence: 0.88, reasons: ["Reschedule request"] } },
  },
];

function actionLabel(action: string | null) {
  const map: Record<string, string> = {
    queued_for_review: "Needs review",
    draft_created: "Drafted",
    draft_preview: "Draft preview",
    auto_sent: "Auto-sent",
    sent: "Sent",
    skipped_blocked: "Blocked",
    skipped_manual: "Archived",
    rewrite_requested: "Rewrite requested",
  };
  return (action && map[action]) || action || "Updated";
}

function actionTone(action: string | null): "neutral" | "success" | "warning" | "info" {
  if (action === "auto_sent" || action === "sent") return "success";
  if (action === "queued_for_review" || action === "rewrite_requested" || action === "skipped_blocked") {
    return "warning";
  }
  if (action === "draft_created" || action === "draft_preview") return "info";
  return "neutral";
}

export default function InboxClient() {
  const { data: session, status } = useSession();
  const authed = status === "authenticated";
  const loadingSession = status === "loading";
  const router = useRouter();
  const params = useSearchParams();

  const [items, setItems] = useState<InboxItem[]>([]);
  const [settings, setSettings] = useState<InboxSettings | null>(null);
  const [syncState, setSyncState] = useState<SyncState>({});
  const [tokenState, setTokenState] = useState<TokenResp | null>(null);
  const [identity, setIdentity] = useState<OrgIdentity | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sort, setSort] = useState<SortKey>("priority");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<LogDetail | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [labelInput, setLabelInput] = useState("");
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showCommand, setShowCommand] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [clientSignals, setClientSignals] = useState<{
    summary?: string;
    flags?: Array<{ type: string; label: string }>;
    guardrailSummary?: string;
    suggestedGuardrails?: Array<{ type: string; label: string }>;
  } | null>(null);
  const [clientSignalsBusy, setClientSignalsBusy] = useState(false);
  const [customerTimeline, setCustomerTimeline] = useState<
    { events: Array<{ type: string; at: string; detail: string }> } | null
  >(null);
  const [timelineBusy, setTimelineBusy] = useState(false);
  const [holdSuggestions, setHoldSuggestions] = useState<
    | {
        label: string;
        orgSlug: string;
        slots: Array<{ start: string; end: string; staffId?: string | null; explanation?: string }>;
      }
    | null
  >(null);
  const [holdBusy, setHoldBusy] = useState(false);
  const [holdMessage, setHoldMessage] = useState<string | null>(null);

  const qParam = params?.get("q") ?? "";
  const [query, setQuery] = useState(qParam);

  useEffect(() => {
    setQuery(qParam);
  }, [qParam]);

  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef(15000);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const draftSubjectRef = useRef<HTMLInputElement | null>(null);
  const draftBodyRef = useRef<HTMLTextAreaElement | null>(null);

  const commandRef = useRef<HTMLInputElement | null>(null);

  const loadToken = useCallback(async () => {
    if (!authed) return;
    try {
      const res = await fetch("/api/email-ai/token", { cache: "no-store" });
      if (!res.ok) return;
      const j = (await res.json()) as TokenResp;
      setTokenState(j);
    } catch {
      // ignore
    }
  }, [authed]);

  const loadIdentity = useCallback(async () => {
    if (!authed) return;
    try {
      const res = await fetch("/api/org/identity", { cache: "no-store" });
      if (!res.ok) return;
      const j = (await res.json()) as OrgIdentity & { ok?: boolean };
      if ((j as any).ok === false) return;
      setIdentity(j as OrgIdentity);
    } catch {
      // ignore
    }
  }, [authed]);

  const loadInbox = useCallback(async (q?: string) => {
    if (!authed) return;
    setLoading(true);
    try {
      const url = new URL("/api/email-ai/inbox", window.location.origin);
      if (q) url.searchParams.set("q", q);
      const res = await fetch(url.toString(), { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load inbox");
      const j = await res.json();
      setItems(Array.isArray(j.items) ? j.items : []);
      setSettings(j.inboxSettings ?? null);
      setSyncState(j.syncState ?? {});
    } catch (err: any) {
      setSyncError(err?.message || "Failed to load inbox");
    } finally {
      setLoading(false);
    }
  }, [authed]);

  const updateInboxSettings = useCallback(
    async (patch: Partial<InboxSettings>) => {
      if (!authed) return;
      setSettingsBusy(true);
      try {
        const res = await fetch("/api/email-ai/inbox-settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        const j = await res.json();
        if (res.ok && j?.ok) {
          setSettings(j.settings ?? null);
        }
      } finally {
        setSettingsBusy(false);
      }
    },
    [authed]
  );

  const runSync = useCallback(async () => {
    if (!authed || !tokenState?.connected) return;
    setSyncing(true);
    setSyncError(null);
    try {
      const res = await fetch("/api/email-ai/poll", {
        method: "POST",
        cache: "no-store",
      });
      if (!res.ok) {
        const msg = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(msg?.error || "Sync failed");
      }
      await loadInbox(query);
      await loadToken();
      backoffRef.current = 15000;
    } catch (err: any) {
      setSyncError(err?.message || "Sync failed");
      backoffRef.current = Math.min(backoffRef.current * 2, 120000);
    } finally {
      setSyncing(false);
    }
  }, [authed, loadInbox, loadToken, query, tokenState?.connected]);

  useEffect(() => {
    if (!authed) return;
    loadToken();
    loadInbox(query);
    loadIdentity();
  }, [authed, loadInbox, loadToken, query]);

  useEffect(() => {
    if (!identity?.demoMode) return;
    if (!loading && items.length === 0) {
      setItems(DEMO_ITEMS);
    }
  }, [identity?.demoMode, items.length, loading]);

  useEffect(() => {
    if (!authed || !tokenState?.connected) return;
    if (pollRef.current) clearTimeout(pollRef.current);

    const loop = async () => {
      await runSync();
      pollRef.current = setTimeout(loop, backoffRef.current);
    };

    pollRef.current = setTimeout(loop, 2000);
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [authed, runSync, tokenState?.connected]);

  useEffect(() => {
    if (!activeId) return;
    let ignore = false;
    setDetail(null);
    const loadDetail = async () => {
      try {
        const res = await fetch(`/api/email-ai/log/${encodeURIComponent(activeId)}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error("Failed to load email");
        const j = (await res.json()) as LogDetail;
        if (!ignore) setDetail(j);
      } catch {
        if (!ignore) setDetail(null);
      }
    };
    loadDetail();
    return () => {
      ignore = true;
    };
  }, [activeId]);

  useEffect(() => {
    if (!detail?.meta?.from) {
      setClientSignals(null);
      setCustomerTimeline(null);
      setHoldSuggestions(null);
      return;
    }
    const match = detail.meta.from.match(/<([^>]+)>/);
    const email = (match?.[1] || detail.meta.from).trim().toLowerCase();
    if (!email || !email.includes("@")) {
      setClientSignals(null);
      setCustomerTimeline(null);
      setHoldSuggestions(null);
      return;
    }
    let ignore = false;
    setClientSignalsBusy(true);
    setTimelineBusy(true);
    (async () => {
      try {
        const lookup = await fetch(`/api/org/clients/lookup?email=${encodeURIComponent(email)}`, {
          cache: "no-store",
        });
        if (!lookup.ok) {
          if (!ignore) setClientSignals(null);
          return;
        }
        const lookupJson = await lookup.json();
        const customerId = lookupJson?.customer?.id as string | undefined;
        if (!customerId) {
          if (!ignore) setClientSignals(null);
          return;
        }
        const signalsRes = await fetch(`/api/org/clients/${customerId}/signals`, {
          cache: "no-store",
        });
        if (!signalsRes.ok) {
          if (!ignore) setClientSignals(null);
          return;
        }
        const signalsJson = await signalsRes.json();
        if (!ignore) {
          setClientSignals({
            summary: signalsJson.summary,
            flags: signalsJson.flags,
            guardrailSummary: signalsJson.guardrailSummary,
            suggestedGuardrails: signalsJson.suggestedGuardrails,
          });
        }
        const timelineRes = await fetch(`/api/org/clients/timeline?email=${encodeURIComponent(email)}`, {
          cache: "no-store",
        });
        if (timelineRes.ok) {
          const timelineJson = await timelineRes.json();
          if (!ignore && timelineJson?.timeline) {
            setCustomerTimeline({ events: timelineJson.timeline.events || [] });
          }
        }
        const suggestionRes = await fetch("/api/org/booking-holds/suggest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `${detail.subject || ""}\n${detail.snippet || ""}`,
          }),
        });
        if (suggestionRes.ok) {
          const suggestionJson = await suggestionRes.json();
          if (!ignore && suggestionJson?.ok) {
            setHoldSuggestions({
              label: suggestionJson.label,
              orgSlug: suggestionJson.orgSlug,
              slots: suggestionJson.slots || [],
            });
          }
        }
      } finally {
        if (!ignore) setClientSignalsBusy(false);
        if (!ignore) setTimelineBusy(false);
      }
    })();
    return () => {
      ignore = true;
    };
  }, [detail]);

  const filteredItems = useMemo(() => {
    const data = items.slice();
    const filtered = data.filter((item) => {
      const ai = getAI(item);
      if (filter === "needs_review") return item.action === "queued_for_review" || ai.risk === "needs_review";
      if (filter === "auto_send") {
        if (!settings) return false;
        return (
          ai.risk === "safe" &&
          settings.autoSendAllowedCategories.includes(ai.category) &&
          !settings.neverAutoSendCategories.includes(ai.category) &&
          typeof ai.confidence === "number" &&
          ai.confidence * 100 >= settings.autoSendMinConfidence
        );
      }
      if (filter === "sent") return item.action === "auto_sent" || item.action === "sent";
      if (filter === "blocked") return ai.risk === "blocked" || item.action === "skipped_blocked";
      return true;
    });

    filtered.sort((a, b) => {
      if (sort === "newest") return Date.parse(b.createdAt) - Date.parse(a.createdAt);
      const pa = priorityScore(getAI(a).priority);
      const pb = priorityScore(getAI(b).priority);
      if (pb !== pa) return pb - pa;
      return Date.parse(b.createdAt) - Date.parse(a.createdAt);
    });

    return filtered;
  }, [filter, items, settings, sort]);

  const activityRows = useMemo(() => {
    return items
      .filter((item) => item.action)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, 6)
      .map((item) => ({
        id: item.id,
        action: item.action,
        subject: item.subject || "(no subject)",
        when: formatWhen(item.receivedAt || item.createdAt),
      }));
  }, [items]);

  const selectedCount = selected.size;

  const toggleSelectAll = (on: boolean) => {
    const ids = filteredItems.map((item) => item.id);
    const next = new Set(selected);
    if (on) ids.forEach((id) => next.add(id));
    else ids.forEach((id) => next.delete(id));
    setSelected(next);
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const doAction = async (op: "approve" | "save_draft" | "skip", id: string, payload?: { subject?: string; body?: string }) => {
    await fetch("/api/email-ai/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op, id, ...payload }),
    });
    await loadInbox(query);
  };

  const bulkAction = async (op: "approve" | "skip") => {
    const ids = Array.from(selected);
    if (!ids.length) return;
    await Promise.all(ids.map((id) => doAction(op, id)));
    setSelected(new Set());
  };

  const applyLabel = async () => {
    const ids = Array.from(selected);
    if (!ids.length || !labelInput.trim()) return;
    await fetch("/api/email-ai/label", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, label: labelInput.trim() }),
    });
    setLabelInput("");
    await loadInbox(query);
  };

  const statusLabel = tokenState?.connected
    ? syncing
      ? "Syncing"
      : syncError || syncState.lastError
      ? "Error"
      : "Connected"
    : "Paused";

  const statusTone: "neutral" | "success" | "warning" | "info" =
    statusLabel === "Connected"
      ? "success"
      : statusLabel === "Syncing"
      ? "info"
      : statusLabel === "Error"
      ? "warning"
      : "neutral";

  const lastSyncLabel = syncState.lastSuccessAt
    ? new Date(syncState.lastSuccessAt).toLocaleString()
    : "—";

  const automationActive = !!(!settings?.automationPaused && (settings?.enableAutoSend || settings?.enableAutoDraft));
  const activeItem = items.find((i) => i.id === activeId) || null;
  const activeAi = activeItem ? getAI(activeItem) : null;

  const commands = useMemo(
    () => [
      {
        label: "Approve & Send",
        shortcut: "A",
        action: () => {
          if (!detail) return;
          const subject = draftSubjectRef.current?.value;
          const body = draftBodyRef.current?.value;
          doAction("approve", detail.id, { subject, body });
        },
      },
      {
        label: "Archive (Mark done)",
        shortcut: "E",
        action: () => activeId && doAction("skip", activeId),
      },
      {
        label: "Focus search",
        shortcut: "/",
        action: () => searchRef.current?.focus(),
      },
      {
        label: "Toggle sort: Priority",
        shortcut: "P",
        action: () => setSort("priority"),
      },
      {
        label: "Toggle sort: Newest",
        shortcut: "N",
        action: () => setSort("newest"),
      },
      {
        label: "Inbox settings",
        shortcut: "S",
        action: () => router.push("/email-ai/settings"),
      },
    ],
    [activeId, detail, doAction, router]
  );

  const filteredCommands = useMemo(() => {
    const q = commandQuery.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((cmd) => cmd.label.toLowerCase().includes(q));
  }, [commandQuery, commands]);

  useEffect(() => {
    if (!showCommand) return;
    setTimeout(() => commandRef.current?.focus(), 0);
  }, [showCommand]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      const inInput = tag === "input" || tag === "textarea" || (e.target as HTMLElement | null)?.isContentEditable;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShowCommand(true);
        return;
      }

      if (e.key === "/" && !inInput) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }

      if (inInput) return;

      if (e.key === "j") {
        const idx = filteredItems.findIndex((item) => item.id === activeId);
        const next = idx < 0 ? 0 : Math.min(filteredItems.length - 1, idx + 1);
        const target = filteredItems[next];
        if (target) setActiveId(target.id);
      }

      if (e.key === "k") {
        const idx = filteredItems.findIndex((item) => item.id === activeId);
        const prev = idx <= 0 ? 0 : idx - 1;
        const target = filteredItems[prev];
        if (target) setActiveId(target.id);
      }

      if (e.key === "e") {
        if (activeId) doAction("skip", activeId);
      }

      if (e.key === "a") {
        if (!detail) return;
        const subject = draftSubjectRef.current?.value;
        const body = draftBodyRef.current?.value;
        doAction("approve", detail.id, { subject, body });
      }

      if (e.key === "r") {
        draftBodyRef.current?.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [activeId, detail, doAction, filteredItems]);

  if (loadingSession) {
    return <div className="p-6">Checking session…</div>;
  }

  if (!authed) {
    return (
      <div className="p-6 space-y-4">
        <h1 className="text-2xl font-semibold">Email AI Inbox</h1>
        <p className="text-zinc-600">Please sign in to view your inbox.</p>
      </div>
    );
  }

  if (identity?.entitlements?.features?.emailAi === false) {
    return (
      <div className="p-6 space-y-4">
        <h1 className="text-2xl font-semibold">Email AI Inbox</h1>
        <p className="text-zinc-600">
          Email AI is not included in your current plan.{" "}
          <a className="underline" href="/settings">
            Upgrade to enable
          </a>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex-1 min-w-[220px]">
          <div className="flex items-center gap-3">
            <BrandLogo
              branding={identity?.branding}
              mode="full"
              showWordmark={false}
              showWordmarkText={false}
              size={36}
              className="max-w-[180px]"
            />
            <div>
              <h1 className="text-2xl font-semibold text-zinc-900">Email AI Inbox</h1>
              <p className="text-sm text-zinc-600">
                Live sync, deterministic-first classification, and supervised sending.
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={statusTone}>{statusLabel}</Badge>
          <div className="text-xs text-zinc-500">Last sync: {lastSyncLabel}</div>
          {!tokenState?.connected && (
            <Button variant="primary" onClick={() => signIn("google", { callbackUrl: "/email-ai" })}>
              Connect Google
            </Button>
          )}
        </div>
      </div>

      {tokenState?.connected && (
        <Card className="flex flex-wrap items-center gap-3 text-xs text-zinc-600">
          <div>Google: {tokenState.email || "Connected"}</div>
          <div>Sync interval: {Math.round(backoffRef.current / 1000)}s</div>
          <div>Auto-send threshold {settings?.autoSendMinConfidence ?? 92}%</div>
          {syncError && <span className="text-rose-600">{syncError}</span>}
          {syncState.lastError && !syncError && (
            <span className="text-rose-600">{syncState.lastError}</span>
          )}
        </Card>
      )}
      {!tokenState?.connected && (
        <Card className="text-sm text-zinc-600">
          Google is disconnected. Connect to enable live sync and autonomous drafting.
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[220px]">
          <Input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sender, subject, snippet…"
          />
        </div>
        <Button
          variant="secondary"
          onClick={() => {
            const url = new URL(window.location.href);
            if (query.trim()) url.searchParams.set("q", query.trim());
            else url.searchParams.delete("q");
            router.replace(url.pathname + url.search);
            loadInbox(query.trim());
          }}
        >
          Search
        </Button>
        <Button variant="ghost" onClick={() => loadInbox(query.trim())}>
          Refresh
        </Button>
        <Button variant="ghost" onClick={() => setShowShortcuts(true)}>
          Shortcuts
        </Button>
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">Sort</span>
          <Button
            variant={sort === "priority" ? "primary" : "secondary"}
            onClick={() => setSort("priority")}
          >
            Priority
          </Button>
          <Button
            variant={sort === "newest" ? "primary" : "secondary"}
            onClick={() => setSort("newest")}
          >
            Newest
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((chip) => (
          <button
            key={chip.key}
            type="button"
            onClick={() => setFilter(chip.key)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs font-medium",
              filter === chip.key
                ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300"
            )}
          >
            {chip.label}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-zinc-900">Automation guardrails</div>
            <Badge variant={settings?.automationPaused ? "warning" : automationActive ? "success" : "neutral"}>
              {settings?.automationPaused ? "Paused" : automationActive ? "Automation live" : "Manual mode"}
            </Badge>
          </div>
          <div className="mt-2 text-xs text-zinc-600 space-y-1">
            <div>Daily send cap: {settings?.dailySendCap ?? "—"}</div>
            <div>Min confidence: {settings?.autoSendMinConfidence ?? "—"}%</div>
            <div>Approval runway: {settings?.requireApprovalForFirstN ?? "—"} emails</div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              variant={settings?.automationPaused ? "secondary" : "destructive"}
              disabled={settingsBusy}
              onClick={() =>
                updateInboxSettings({
                  automationPaused: !settings?.automationPaused,
                })
              }
            >
              {settings?.automationPaused ? "Resume automation" : "Pause automation"}
            </Button>
            <Button variant="secondary" onClick={() => router.push("/email-ai/settings")}>
              Edit rules
            </Button>
          </div>
        </Card>

        <Card>
          <div className="text-sm font-medium text-zinc-900">Activity timeline</div>
          <div className="mt-3 space-y-2 text-xs text-zinc-600">
            {activityRows.length === 0 ? (
              <div>No recent inbox activity yet.</div>
            ) : (
              activityRows.map((row) => (
                <div key={row.id} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-zinc-800">{row.subject}</div>
                    <div className="text-[11px] text-zinc-500">{row.when}</div>
                  </div>
                  <Badge variant={actionTone(row.action)}>{actionLabel(row.action)}</Badge>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      <Card className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-zinc-600">
          <input
            type="checkbox"
            checked={selectedCount > 0 && selectedCount === filteredItems.length}
            onChange={(e) => toggleSelectAll(e.target.checked)}
            className="h-4 w-4"
          />
          Select all
        </label>
        <Badge variant="neutral">{selectedCount} selected</Badge>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="primary" disabled={!selectedCount} onClick={() => bulkAction("approve")}
          >
            Approve drafts
          </Button>
          <Button variant="secondary" disabled={!selectedCount} onClick={() => bulkAction("skip")}>
            Mark done / archive
          </Button>
          <div className="flex items-center gap-2">
            <Input
              value={labelInput}
              onChange={(e) => setLabelInput(e.target.value)}
              placeholder="Apply label"
              className="w-32"
            />
            <Button variant="ghost" disabled={!selectedCount} onClick={applyLabel}>
              Apply
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[420px,1fr]">
        <Card padded={false} className={cn("overflow-hidden", activeId ? "hidden lg:block" : "block")}> 
          <div className="border-b px-4 py-2 text-xs text-zinc-500">
            {filteredItems.length} messages
          </div>
          <div className="max-h-[72vh] overflow-auto divide-y">
            {loading ? (
              <div className="p-4 space-y-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="space-y-2">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-4 w-56" />
                    <Skeleton className="h-3 w-40" />
                  </div>
                ))}
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="p-4 text-sm text-zinc-500">No messages match this filter.</div>
            ) : (
              filteredItems.map((item) => {
                const ai = getAI(item);
                const isActive = item.id === activeId;
                const when = formatWhen(item.receivedAt || item.createdAt);
                const conf = typeof ai.confidence === "number" ? Math.round(ai.confidence * 100) : null;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveId(item.id)}
                    className={cn(
                      "w-full text-left px-4 py-3 hover:bg-zinc-50",
                      isActive ? "bg-emerald-50" : "bg-white"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={selected.has(item.id)}
                        onChange={() => toggleSelect(item.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="mt-1 h-4 w-4"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs text-zinc-500">{when}</div>
                        <div className="truncate font-medium text-zinc-900">
                          {item.subject || "(no subject)"}
                        </div>
                        <div className="truncate text-xs text-zinc-500">
                          {(item.rawMeta as any)?.from || item.snippet || ""}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-600">
                            {ai.category}
                          </span>
                          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-600">
                            {ai.priority}
                          </span>
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5",
                              ai.risk === "blocked"
                                ? "bg-rose-100 text-rose-700"
                                : ai.risk === "needs_review"
                                ? "bg-amber-100 text-amber-700"
                                : "bg-emerald-100 text-emerald-700"
                            )}
                          >
                            {ai.risk}
                          </span>
                          {conf != null && (
                            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-600">
                              {conf}%
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </Card>

        <Card padded={false} className={cn("overflow-hidden", activeId ? "block" : "hidden lg:block")}> 
          <div className="flex items-center justify-between border-b px-4 py-2">
            <div className="text-sm font-medium text-zinc-900">
              {detail?.subject || "Select an email"}
            </div>
            <button
              type="button"
              className="text-xs text-zinc-500 lg:hidden"
              onClick={() => setActiveId(null)}
            >
              Back to list
            </button>
          </div>
          <div className="max-h-[72vh] overflow-auto p-4 space-y-4 text-sm text-zinc-700">
            {!detail ? (
              <div className="text-zinc-500">
                {activeId ? "Loading message…" : "Select a message to view."}
              </div>
            ) : (
              <>
                {detail.thread && detail.thread.length > 0 && (
                  <div className="space-y-3">
                    {detail.thread.map((m) => (
                      <div key={m.id} className="rounded-xl border border-zinc-200 bg-white p-3">
                        <div className="text-xs text-zinc-500">{m.date} — {m.from}</div>
                        <div className="mt-2 whitespace-pre-wrap text-sm text-zinc-800">{m.body}</div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="rounded-xl border border-zinc-200 bg-white p-3 text-xs text-zinc-600">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-zinc-700">One-click booking holds</div>
                    {holdSuggestions?.label ? (
                      <span className="text-[11px] text-zinc-500">{holdSuggestions.label}</span>
                    ) : null}
                  </div>
                  {holdSuggestions?.slots?.length ? (
                    <div className="mt-2 grid gap-2 sm:grid-cols-3">
                      {holdSuggestions.slots.map((slot) => (
                        <button
                          key={slot.start}
                          type="button"
                          className="rounded-lg border border-zinc-200 px-2 py-2 text-left hover:border-emerald-300 hover:bg-emerald-50"
                          onClick={async () => {
                            setHoldBusy(true);
                            setHoldMessage(null);
                            try {
                              const res = await fetch("/api/org/booking-holds", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                  start: slot.start,
                                  end: slot.end,
                                  staffId: slot.staffId || null,
                                  note: detail.subject || "",
                                }),
                              });
                              const j = await res.json();
                              if (!res.ok || !j.ok) {
                                setHoldMessage(j.error || "Failed to hold slot.");
                                return;
                              }
                              setHoldMessage("Hold created for 15 minutes.");
                              const bookingLink = holdSuggestions.orgSlug
                                ? `${window.location.origin}/book/${holdSuggestions.orgSlug}`
                                : "";
                              if (bookingLink && draftBodyRef.current) {
                                const existing = draftBodyRef.current.value || "";
                                draftBodyRef.current.value = `${existing}\n\nI've held ${new Date(
                                  slot.start
                                ).toLocaleString()} for you — confirm here: ${bookingLink}`;
                              }
                            } finally {
                              setHoldBusy(false);
                            }
                          }}
                        >
                          <div className="text-[11px] text-zinc-500">Hold</div>
                          <div className="text-sm font-semibold text-zinc-900">
                            {new Date(slot.start).toLocaleString()}
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-2 text-[11px] text-zinc-500">
                      No obvious time intent detected yet.
                    </div>
                  )}
                  {holdMessage && <div className="mt-2 text-[11px] text-emerald-700">{holdMessage}</div>}
                  {holdBusy && <div className="mt-2 text-[11px] text-zinc-500">Creating hold…</div>}
                </div>

                <IntentActionsPanel
                  text={detail.snippet || detail.subject || ""}
                  category={activeAi?.category}
                  risk={activeAi?.risk}
                  orgSlug={identity?.org?.slug || null}
                />

                <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3" key={detail.id}>
                  <div className="text-xs font-semibold text-zinc-600">Draft</div>
                  <div className="mt-2 space-y-2">
                    <Input
                      ref={draftSubjectRef}
                      defaultValue={detail.suggested?.subject || detail.subject}
                      id="draft-subject"
                      placeholder="Subject"
                    />
                    <textarea
                      id="draft-body"
                      ref={draftBodyRef}
                      defaultValue={detail.suggested?.body || detail.snippet}
                      className="w-full min-h-[200px] rounded-xl border border-zinc-200 p-3 text-sm text-zinc-700"
                    />
                  </div>
                </div>

                <div className="rounded-xl border border-zinc-200 bg-white p-3 text-xs text-zinc-600">
                  <div className="font-semibold text-zinc-700">Why this draft</div>
                  <div className="mt-1">
                    {detail.ai?.reasons?.join(" • ") || "Deterministic signals plus AI assistance."}
                  </div>
                  {detail.ai?.usedSnippets?.length ? (
                    <div className="mt-2 text-[11px] text-zinc-500">
                      Used snippets: {detail.ai.usedSnippets.join(", ")}
                    </div>
                  ) : null}
                </div>
                <div className="rounded-xl border border-zinc-200 bg-white p-3 text-xs text-zinc-600">
                  <div className="font-semibold text-zinc-700">Client intelligence</div>
                  {clientSignalsBusy && <div className="mt-1 text-zinc-500">Loading signals…</div>}
                  {!clientSignalsBusy && !clientSignals && (
                    <div className="mt-1 text-zinc-500">No client signals found.</div>
                  )}
                  {clientSignals && (
                    <div className="mt-2 space-y-2">
                      {clientSignals.summary ? <div>{clientSignals.summary}</div> : null}
                      {clientSignals.flags?.length ? (
                        <div className="flex flex-wrap gap-2">
                          {clientSignals.flags.map((flag) => (
                            <span
                              key={flag.type}
                              className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-700"
                            >
                              {flag.label}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      {clientSignals.guardrailSummary ? (
                        <div className="text-[11px] text-zinc-500">{clientSignals.guardrailSummary}</div>
                      ) : null}
                    </div>
                  )}
                </div>
                <div className="rounded-xl border border-zinc-200 bg-white p-3 text-xs text-zinc-600">
                  <div className="font-semibold text-zinc-700">Customer timeline</div>
                  {timelineBusy && <div className="mt-1 text-zinc-500">Loading timeline…</div>}
                  {!timelineBusy && (!customerTimeline || customerTimeline.events.length === 0) && (
                    <div className="mt-1 text-zinc-500">No timeline activity found.</div>
                  )}
                  {customerTimeline?.events?.length ? (
                    <div className="mt-2 space-y-2">
                      {customerTimeline.events.slice(-6).map((event) => (
                        <div key={`${event.type}-${event.at}`} className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1">
                          <div className="text-[11px] font-semibold">{event.type.replace(/_/g, " ")}</div>
                          <div className="text-[11px] text-zinc-500">
                            {new Date(event.at).toLocaleString()}
                          </div>
                          <div className="text-[11px]">{event.detail}</div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </>
            )}
          </div>

          {detail && (
            <div className="border-t p-3 flex flex-wrap gap-2">
              <Button
                variant="primary"
                onClick={() => {
                  const subject = draftSubjectRef.current?.value;
                  const body = draftBodyRef.current?.value;
                  doAction("approve", detail.id, { subject, body });
                }}
              >
                Approve & Send
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  const subject = draftSubjectRef.current?.value;
                  const body = draftBodyRef.current?.value;
                  doAction("save_draft", detail.id, { subject, body });
                }}
              >
                Save Draft
              </Button>
              <Button variant="ghost" onClick={() => doAction("skip", detail.id)}>
                Discard
              </Button>
            </div>
          )}
        </Card>
      </div>

      {showShortcuts && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-zinc-900">Inbox shortcuts</div>
              <button className="text-xs text-zinc-500" onClick={() => setShowShortcuts(false)}>
                Close
              </button>
            </div>
            <div className="mt-4 space-y-2 text-sm text-zinc-600">
              <div className="flex items-center justify-between">
                <span>Next message</span>
                <span className="font-semibold text-zinc-900">J</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Previous message</span>
                <span className="font-semibold text-zinc-900">K</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Archive</span>
                <span className="font-semibold text-zinc-900">E</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Approve &amp; send</span>
                <span className="font-semibold text-zinc-900">A</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Reply focus</span>
                <span className="font-semibold text-zinc-900">R</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Search</span>
                <span className="font-semibold text-zinc-900">/</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Command palette</span>
                <span className="font-semibold text-zinc-900">⌘K</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {showCommand && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-24">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl">
            <div className="border-b px-4 py-3">
              <input
                ref={commandRef}
                value={commandQuery}
                onChange={(e) => setCommandQuery(e.target.value)}
                placeholder="Type a command…"
                className="w-full text-sm outline-none"
                onKeyDown={(e) => {
                  if (e.key === "Escape") setShowCommand(false);
                }}
              />
            </div>
            <div className="max-h-64 overflow-auto p-2">
              {filteredCommands.map((cmd) => (
                <button
                  key={cmd.label}
                  type="button"
                  onClick={() => {
                    cmd.action();
                    setShowCommand(false);
                    setCommandQuery("");
                  }}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-100"
                >
                  <span>{cmd.label}</span>
                  <span className="text-xs text-zinc-400">{cmd.shortcut}</span>
                </button>
              ))}
              {filteredCommands.length === 0 && (
                <div className="px-3 py-4 text-sm text-zinc-500">No commands found.</div>
              )}
            </div>
            <div className="border-t px-4 py-2 text-xs text-zinc-500">
              Press Esc to close
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
