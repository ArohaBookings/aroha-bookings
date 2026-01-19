"use client";

import React from "react";
import Link from "next/link";
import Input from "@/components/ui/Input";
import IntentActionsPanel from "@/components/IntentActionsPanel";

type MessageItem = {
  id: string;
  channel: "instagram" | "whatsapp" | "sms";
  fromName: string;
  fromHandle: string;
  preview: string;
  body: string;
  receivedAt: string;
  category: string;
  priority: "low" | "normal" | "high" | "urgent";
  risk: "safe" | "needs_review" | "blocked";
  confidence: number;
  status: "new" | "draft_ready" | "needs_review" | "sent";
  draft?: string | null;
  usedSnippets?: string[];
  quickActions?: string[];
};

type MessagesSettings = {
  enableAutoDraft: boolean;
  enableAutoSend: boolean;
  minConfidence: number;
  blockedCategories: string[];
  dailySendCap: number;
  businessHoursOnly: boolean;
  requireApprovalForFirstN: number;
};

const FILTERS = [
  { id: "all", label: "All" },
  { id: "needs_review", label: "Needs review" },
  { id: "draft_ready", label: "Draft ready" },
  { id: "auto_send", label: "Auto-send eligible" },
  { id: "blocked", label: "Blocked" },
] as const;

function badgeClass(risk: MessageItem["risk"]) {
  if (risk === "blocked") return "bg-rose-100 text-rose-700 border-rose-200";
  if (risk === "needs_review") return "bg-amber-100 text-amber-700 border-amber-200";
  return "bg-emerald-100 text-emerald-700 border-emerald-200";
}

function channelLabel(channel: MessageItem["channel"]) {
  if (channel === "instagram") return "Instagram";
  if (channel === "whatsapp") return "WhatsApp";
  return "SMS";
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

export default function MessagesClient() {
  const [items, setItems] = React.useState<MessageItem[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<(typeof FILTERS)[number]["id"]>("all");
  const [sort, setSort] = React.useState<"priority" | "newest">("priority");
  const [query, setQuery] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [lastSyncAt, setLastSyncAt] = React.useState<string | null>(null);
  const [settings, setSettings] = React.useState<MessagesSettings | null>(null);
  const [isMobile, setIsMobile] = React.useState(false);
  const [entitlementError, setEntitlementError] = React.useState<string | null>(null);
  const [orgSlug, setOrgSlug] = React.useState<string | null>(null);

  React.useEffect(() => {
    const media = window.matchMedia("(max-width: 1024px)");
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (query) params.set("q", query);
        if (filter) params.set("filter", filter);
        if (sort) params.set("sort", sort);
        const res = await fetch(`/api/messages/inbox?${params.toString()}`, { cache: "no-store" });
        const j = await res.json();
        if (!cancelled && !j?.ok) {
          setEntitlementError(j?.error || "Messages Hub is not included in your plan.");
          return;
        }
        if (!cancelled && j?.ok) {
          setEntitlementError(null);
          setItems(j.items || []);
          setLastSyncAt(j.lastSyncAt || null);
          if (!selectedId && j.items?.length) setSelectedId(j.items[0].id);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [query, filter, sort, selectedId]);

  React.useEffect(() => {
    let cancelled = false;
    async function loadOrg() {
      try {
        const res = await fetch("/api/org/identity", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok && data?.org?.slug) {
          setOrgSlug(String(data.org.slug));
        }
      } catch {
        // ignore
      }
    }
    loadOrg();
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    async function loadSettings() {
      const res = await fetch("/api/messages/settings", { cache: "no-store" });
      const j = await res.json();
      if (!cancelled && j?.ok) setSettings(j.settings);
    }
    loadSettings();
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = items.find((item) => item.id === selectedId) || null;
  const showDetail = !isMobile || Boolean(selected && selectedId);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Messages Hub</h1>
          <p className="text-sm text-zinc-600">
            Unified inbox for Instagram, WhatsApp, and future channels.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/messages/integrations"
            className="rounded-full border border-zinc-200 bg-white px-4 py-1.5 text-sm font-medium text-zinc-700 shadow-sm hover:border-emerald-200 hover:bg-emerald-50"
          >
            Integrations
          </Link>
          <Link
            href="/messages/settings"
            className="rounded-full border border-zinc-200 bg-white px-4 py-1.5 text-sm font-medium text-zinc-700 shadow-sm hover:border-emerald-200 hover:bg-emerald-50"
          >
            Settings
          </Link>
        </div>
      </header>

      {!loading && !entitlementError && items.length === 0 && (
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Coming soon</p>
          <h2 className="mt-2 text-xl font-semibold text-zinc-900">
            AI replies for Instagram, WhatsApp, and Webchat
          </h2>
          <p className="mt-2 text-sm text-zinc-600">
            Draft-first, confidence-based automation with unified timeline and client memory.
          </p>
          <div className="mt-4 grid gap-2 text-sm text-zinc-700 sm:grid-cols-3">
            {[
              { label: "Instagram", note: "Coming soon" },
              { label: "WhatsApp", note: "Coming soon" },
              { label: "Webchat", note: "Coming soon" },
            ].map((item) => (
              <label
                key={item.label}
                className="flex items-center justify-between rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2"
              >
                <span className="flex items-center gap-2">
                  <input type="checkbox" disabled />
                  {item.label}
                </span>
                <span className="text-xs text-zinc-500">{item.note}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-zinc-200 bg-white/80 p-3 shadow-sm">
        <div className="flex items-center gap-2 text-xs text-zinc-600">
          <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400" />
          {lastSyncAt ? `Last sync ${new Date(lastSyncAt).toLocaleTimeString()}` : "Sync pending"}
        </div>
        {settings && (
          <div className="text-xs text-zinc-500">
            Auto-draft {settings.enableAutoDraft ? "on" : "off"} · Auto-send{" "}
            {settings.enableAutoSend ? "on" : "off"} · Min confidence {settings.minConfidence}
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        {entitlementError && (
          <div className="lg:col-span-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            {entitlementError}{" "}
            <Link className="font-semibold underline" href="/settings">
              Upgrade to enable Messages Hub
            </Link>
            .
          </div>
        )}
        <div className={showDetail && isMobile ? "hidden" : "flex flex-col gap-3"}>
          <div className="rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm">
            <div className="flex items-center gap-2">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search messages"
                className="h-9"
              />
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as "priority" | "newest")}
                className="h-9 rounded-md border border-zinc-200 bg-white px-2 text-xs text-zinc-600"
              >
                <option value="priority">Priority</option>
                <option value="newest">Newest</option>
              </select>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  className={
                    "rounded-full border px-3 py-1 text-xs font-medium " +
                    (filter === f.id
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50")
                  }
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
            <div className="px-4 py-3 text-xs uppercase tracking-[0.2em] text-zinc-500 border-b border-zinc-100">
              Conversations
            </div>
            <div className="max-h-[64vh] overflow-y-auto">
              {loading && (
                <div className="p-4 text-sm text-zinc-500">Loading messages…</div>
              )}
              {!loading && items.length === 0 && (
                <div className="p-4 text-sm text-zinc-500">
                  No messages yet. Enable demo mode to preview the hub.
                </div>
              )}
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className={
                    "w-full text-left px-4 py-3 border-b border-zinc-100 hover:bg-zinc-50 " +
                    (selectedId === item.id ? "bg-emerald-50/60" : "")
                  }
                >
                  <div className="flex items-center justify-between">
                    <div className="font-medium text-sm text-zinc-900 truncate">{item.fromName}</div>
                    <div className="text-[11px] text-zinc-500">{formatTime(item.receivedAt)}</div>
                  </div>
                  <div className="mt-1 text-[11px] text-zinc-500">
                    {channelLabel(item.channel)} · {item.fromHandle}
                  </div>
                  <div className="mt-1 text-xs text-zinc-600 line-clamp-2">{item.preview}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {showDetail && (
          <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm p-4 lg:p-6">
            {!selected && (
              <div className="text-sm text-zinc-500">Select a message to view details.</div>
            )}
            {selected && (
              <div className="flex flex-col gap-4">
                {isMobile && (
                  <button
                    type="button"
                    onClick={() => setSelectedId(null)}
                    className="text-xs font-medium text-emerald-700"
                  >
                    ← Back to list
                  </button>
                )}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-lg font-semibold text-zinc-900">{selected.fromName}</div>
                    <div className="text-xs text-zinc-500">
                      {channelLabel(selected.channel)} · {selected.fromHandle}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${badgeClass(selected.risk)}`}
                    >
                      {selected.risk.replace("_", " ")}
                    </span>
                    <span className="rounded-full border border-zinc-200 px-2 py-1 text-[11px] text-zinc-600">
                      {selected.category}
                    </span>
                    <span className="rounded-full border border-zinc-200 px-2 py-1 text-[11px] text-zinc-600">
                      Priority {selected.priority}
                    </span>
                  </div>
                </div>

                <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700">
                  {selected.body}
                </div>

                <IntentActionsPanel
                  text={selected.body}
                  category={selected.category}
                  risk={selected.risk}
                  orgSlug={orgSlug}
                />

                {selected.quickActions && selected.quickActions.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {selected.quickActions.map((action) => (
                      <button
                        key={action}
                        type="button"
                        className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                      >
                        {action}
                      </button>
                    ))}
                  </div>
                )}

                <div className="grid gap-3 rounded-xl border border-zinc-200 bg-white p-4">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-zinc-900">AI draft reply</div>
                    <div className="text-xs text-zinc-500">
                      Confidence {selected.confidence}
                    </div>
                  </div>
                  <textarea
                    className="h-28 w-full rounded-lg border border-zinc-200 p-3 text-sm text-zinc-700"
                    value={selected.draft || ""}
                    readOnly
                    placeholder="Draft reply will appear here"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded-full bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                      disabled={selected.risk !== "safe"}
                    >
                      Approve & send
                    </button>
                    <button
                      type="button"
                      className="rounded-full border border-zinc-200 bg-white px-4 py-1.5 text-xs font-semibold text-zinc-700"
                    >
                      Edit draft
                    </button>
                    <button
                      type="button"
                      className="rounded-full border border-zinc-200 bg-white px-4 py-1.5 text-xs font-semibold text-zinc-700"
                    >
                      Discard
                    </button>
                  </div>
                  {selected.usedSnippets && selected.usedSnippets.length > 0 && (
                    <div className="text-xs text-zinc-500">
                      Used snippets: {selected.usedSnippets.join(", ")}
                    </div>
                  )}
                  {selected.risk !== "safe" && (
                    <div className="text-xs text-amber-700">
                      This message needs human review before sending.
                    </div>
                  )}
                </div>

                <div className="grid gap-3 rounded-xl border border-zinc-200 bg-white p-4">
                  <div className="text-sm font-semibold text-zinc-900">Lead capture</div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <input className="h-9 rounded-md border border-zinc-200 px-3 text-xs" placeholder="Name" />
                    <input className="h-9 rounded-md border border-zinc-200 px-3 text-xs" placeholder="Phone or email" />
                    <input className="h-9 rounded-md border border-zinc-200 px-3 text-xs" placeholder="Preferred time" />
                    <input className="h-9 rounded-md border border-zinc-200 px-3 text-xs" placeholder="Service" />
                  </div>
                  <textarea
                    className="h-20 rounded-md border border-zinc-200 px-3 py-2 text-xs"
                    placeholder="Notes"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700"
                    >
                      Send booking link
                    </button>
                    <button
                      type="button"
                      className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700"
                    >
                      Create hold suggestion
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
