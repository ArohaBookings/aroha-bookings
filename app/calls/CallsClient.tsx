// app/calls/CallsClient.tsx
"use client";

import React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { Badge, Button, Card, EmptyState, Input, Select } from "@/components/ui";
import { formatCallerPhone } from "@/lib/phone/format";

export type CallRow = {
  id: string;
  callId: string;
  agentId: string;
  startedAt: string;
  endedAt: string | null;
  callerPhone: string;
  businessPhone?: string | null;
  transcript: string | null;
  recordingUrl: string | null;
  outcome: string;
  appointmentId: string | null;
  rawJson: Prisma.JsonValue;
  appointment: {
    id: string;
    startsAt: string;
    endsAt: string;
    customerName: string;
    serviceName: string | null;
    staffName: string | null;
  } | null;
};

const OUTCOMES = ["", "COMPLETED", "NO_ANSWER", "BUSY", "FAILED", "CANCELLED"] as const;

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("en-NZ", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-NZ", { day: "2-digit", month: "short", year: "numeric" });
}

function minutesBetween(startIso: string, endIso?: string | null) {
  if (!endIso) return null;
  const start = new Date(startIso);
  const end = new Date(endIso);
  const mins = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
  return Number.isFinite(mins) ? mins : null;
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

function highlightMatches(text: string, query: string) {
  if (!query) return text;
  const q = query.toLowerCase();
  const parts: React.ReactNode[] = [];
  let last = 0;
  let idx = text.toLowerCase().indexOf(q, last);
  while (idx !== -1) {
    if (idx > last) parts.push(text.slice(last, idx));
    parts.push(
      <mark key={`${idx}-${q}`} className="rounded bg-yellow-200/80 px-1">
        {text.slice(idx, idx + q.length)}
      </mark>
    );
    last = idx + q.length;
    idx = text.toLowerCase().indexOf(q, last);
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function safeJsonPretty(raw: Prisma.JsonValue) {
  try {
    return JSON.stringify(raw, null, 2);
  } catch {
    return "{}";
  }
}

function buildHighlighted(
  text: string,
  query: string,
  activeIndex: number | null,
  startIndex: number
) {
  if (!query) return { nodes: [text], count: 0 };
  const q = query.toLowerCase();
  const lower = text.toLowerCase();
  const nodes: React.ReactNode[] = [];
  let count = 0;
  let last = 0;
  let idx = lower.indexOf(q, last);
  while (idx !== -1) {
    if (idx > last) nodes.push(text.slice(last, idx));
    const currentIndex = startIndex + count;
    nodes.push(
      <mark
        key={`${idx}-${currentIndex}`}
        data-match-index={currentIndex}
        className={`rounded px-1 ${activeIndex === currentIndex ? "bg-amber-300" : "bg-yellow-200/80"}`}
      >
        {text.slice(idx, idx + q.length)}
      </mark>
    );
    count += 1;
    last = idx + q.length;
    idx = lower.indexOf(q, last);
  }
  if (last < text.length) nodes.push(text.slice(last));
  return { nodes, count };
}

function buildSearchParams(current: URLSearchParams, updates: Record<string, string | null>) {
  const next = new URLSearchParams(current.toString());
  Object.entries(updates).forEach(([key, value]) => {
    if (!value) next.delete(key);
    else next.set(key, value);
  });
  return next;
}

function presetRange(days: number) {
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  const toInput = (d: Date) => d.toISOString().slice(0, 10);
  return { from: toInput(start), to: toInput(end) };
}

export default function CallsClient({
  orgName,
  calls,
  agents,
  filters,
}: {
  orgName: string;
  calls: CallRow[];
  agents: string[];
  filters: { from: string; to: string; agent: string; outcome: string; q: string };
}): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [from, setFrom] = React.useState(filters.from);
  const [to, setTo] = React.useState(filters.to);
  const [agent, setAgent] = React.useState(filters.agent);
  const [outcome, setOutcome] = React.useState(filters.outcome);
  const [query, setQuery] = React.useState(filters.q);
  const [drawerQuery, setDrawerQuery] = React.useState("");
  const [matchIndex, setMatchIndex] = React.useState(0);
  const transcriptRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    async function syncCalls() {
      try {
        await fetch("/api/org/calls/sync", { method: "POST", signal: controller.signal });
      } catch {
        // ignore
      }
    }
    syncCalls();
    const timer = window.setInterval(syncCalls, 5 * 60 * 1000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, []);

  React.useEffect(() => {
    setFrom(filters.from);
    setTo(filters.to);
    setAgent(filters.agent);
    setOutcome(filters.outcome);
    setQuery(filters.q);
  }, [filters.from, filters.to, filters.agent, filters.outcome, filters.q]);

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      if (query === (searchParams.get("q") || "")) return;
      const next = buildSearchParams(searchParams, { q: query || null });
      router.push(`${pathname}?${next.toString()}`);
    }, 320);
    return () => window.clearTimeout(timer);
  }, [query, router, pathname, searchParams]);

  const selectedCallId = searchParams.get("callId") || "";
  const callsById = React.useMemo(() => new Map(calls.map((c) => [c.callId, c])), [calls]);
  const selected = selectedCallId ? callsById.get(selectedCallId) ?? null : null;

  React.useEffect(() => {
    setDrawerQuery("");
    setMatchIndex(0);
  }, [selectedCallId]);

  const kpis = React.useMemo(() => {
    const total = calls.length;
    const answered = calls.filter((c) => c.outcome === "COMPLETED").length;
    const bookings = calls.filter((c) => c.appointmentId).length;
    const durations = calls
      .map((c) => minutesBetween(c.startedAt, c.endedAt))
      .filter((v): v is number => v !== null);
    const avgDuration =
      durations.reduce((sum, v) => sum + v, 0) / Math.max(durations.length, 1);
    return {
      total,
      answeredRate: total ? Math.round((answered / total) * 100) : 0,
      bookings,
      avgDuration: Number.isFinite(avgDuration) ? avgDuration.toFixed(1) : "0.0",
    };
  }, [calls]);

  const effectiveQuery = drawerQuery || query;
  const transcriptMatchCount = React.useMemo(() => {
    if (!selected?.transcript || !effectiveQuery) return 0;
    const q = effectiveQuery.toLowerCase();
    const text = selected.transcript.toLowerCase();
    let idx = text.indexOf(q);
    let count = 0;
    while (idx !== -1) {
      count += 1;
      idx = text.indexOf(q, idx + q.length);
    }
    return count;
  }, [selected?.transcript, effectiveQuery]);

  const activeMatchIndex =
    transcriptMatchCount > 0 ? (matchIndex % transcriptMatchCount + transcriptMatchCount) % transcriptMatchCount : null;

  React.useEffect(() => {
    if (activeMatchIndex === null) return;
    const el = transcriptRef.current?.querySelector<HTMLElement>(
      `[data-match-index="${activeMatchIndex}"]`
    );
    if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeMatchIndex, selected?.callId]);

  function pushFilters(nextFilters: Record<string, string | null>) {
    const next = buildSearchParams(searchParams, nextFilters);
    router.push(`${pathname}?${next.toString()}`);
  }

  function applyPreset(days: number) {
    const range = presetRange(days);
    setFrom(range.from);
    setTo(range.to);
    pushFilters({ from: range.from, to: range.to });
  }

  function clearFilters() {
    const range = presetRange(14);
    setFrom(range.from);
    setTo(range.to);
    setAgent("");
    setOutcome("");
    setQuery("");
    pushFilters({ from: range.from, to: range.to, agent: null, outcome: null, q: null });
  }

  function openDrawer(callId: string) {
    const next = buildSearchParams(searchParams, { callId });
    router.push(`${pathname}?${next.toString()}`);
  }

  function closeDrawer() {
    const next = buildSearchParams(searchParams, { callId: null });
    router.push(`${pathname}?${next.toString()}`);
  }

  function copyCallId() {
    if (!selected) return;
    navigator.clipboard.writeText(selected.callId).catch(() => {});
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Calls</p>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">{orgName}</h1>
          <p className="mt-1 text-sm text-zinc-500">Last 14 days by default</p>
        </div>
        <Badge variant="neutral">{calls.length} results (max 200)</Badge>
      </header>

      <section className="grid gap-3 md:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Total calls</p>
          <p className="mt-2 text-2xl font-semibold text-zinc-900">{kpis.total}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Answered rate</p>
          <p className="mt-2 text-2xl font-semibold text-zinc-900">{kpis.answeredRate}%</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Bookings</p>
          <p className="mt-2 text-2xl font-semibold text-zinc-900">{kpis.bookings}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Avg duration</p>
          <p className="mt-2 text-2xl font-semibold text-zinc-900">{kpis.avgDuration}m</p>
        </Card>
      </section>

      <Card className="bg-gradient-to-br from-white via-white to-zinc-50 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-2 rounded-full border border-zinc-200 bg-white px-2 py-1">
            {[1, 7, 14, 30].map((days) => (
              <Button
                variant="secondary"
                key={days}
                type="button"
                onClick={() => applyPreset(days)}
                className="rounded-full px-3 py-1 text-xs"
              >
                {days === 1 ? "Today" : `${days}d`}
              </Button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                pushFilters({ from: e.target.value });
              }}
              className="h-9 text-sm"
            />
            <span className="text-xs text-zinc-500">to</span>
            <Input
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                pushFilters({ to: e.target.value });
              }}
              className="h-9 text-sm"
            />
          </div>

          <Select
            value={agent}
            onChange={(e) => {
              setAgent(e.target.value);
              pushFilters({ agent: e.target.value || null });
            }}
            className="h-9 text-sm"
          >
            <option value="">All agents</option>
            {agents.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>

          <Select
            value={outcome}
            onChange={(e) => {
              setOutcome(e.target.value);
              pushFilters({ outcome: e.target.value || null });
            }}
            className="h-9 text-sm"
          >
            {OUTCOMES.map((opt) => (
              <option key={opt} value={opt}>
                {opt ? opt.replace("_", " ") : "All outcomes"}
              </option>
            ))}
          </Select>

          <div className="relative flex-1 min-w-[220px]">
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search transcripts..."
              className="h-9 w-full text-sm"
            />
          </div>

          <Button
            variant="secondary"
            type="button"
            onClick={clearFilters}
            className="ml-auto text-xs"
          >
            Clear filters
          </Button>
        </div>
      </Card>

      <Card padded={false} className="overflow-hidden">
        <div className="sticky top-0 z-10 grid grid-cols-[0.8fr_1fr_1fr_1.1fr_1fr_0.7fr_0.7fr] gap-3 border-b border-zinc-100 bg-white/95 px-4 py-3 text-xs font-semibold uppercase tracking-widest text-zinc-500 backdrop-blur">
          <span>Outcome</span>
          <span>Start</span>
          <span>Duration</span>
          <span>Caller</span>
          <span>Agent</span>
          <span>Booking</span>
          <span>Action</span>
        </div>
        {calls.length === 0 ? (
          <div className="px-6 py-8">
            <EmptyState
              title="No calls match these filters"
              body="Try expanding your date range or clearing the transcript search."
            />
          </div>
        ) : (
          <div className="divide-y divide-zinc-100">
            {calls.map((call) => {
              const duration = minutesBetween(call.startedAt, call.endedAt);
              return (
                <button
                  key={call.id}
                  type="button"
                  onClick={() => openDrawer(call.callId)}
                  className="grid w-full grid-cols-[0.8fr_1fr_1fr_1.1fr_1fr_0.7fr_0.7fr] gap-3 px-4 py-3 text-left text-sm transition hover:bg-zinc-50"
                >
                  <Badge className={`w-fit ${outcomeBadge(call.outcome)}`}>
                    {call.outcome.replace("_", " ")}
                  </Badge>
                  <div>
                    <p className="text-zinc-900">{formatDateTime(call.startedAt)}</p>
                    <p className="text-xs text-zinc-500">{formatDate(call.startedAt)}</p>
                  </div>
                  <span className="text-zinc-700">{duration !== null ? `${duration}m` : "—"}</span>
                  <div className="flex flex-col">
                    <span className="font-medium text-zinc-900">
                      {formatCallerPhone(call.callerPhone, call.businessPhone)}
                    </span>
                    <span className="text-xs text-zinc-500">{call.callId.slice(0, 10)}...</span>
                  </div>
                  <span className="text-zinc-700">{call.agentId}</span>
                  <span className="text-xs text-zinc-500">
                    {call.appointmentId ? "Booked" : "—"}
                  </span>
                  <span className="text-xs font-semibold text-emerald-700">View</span>
                </button>
              );
            })}
          </div>
        )}
      </Card>

      <div
        className={`fixed inset-0 z-40 transition ${selected ? "pointer-events-auto" : "pointer-events-none"}`}
        aria-hidden={!selected}
      >
        <div
          className={`absolute inset-0 bg-black/30 transition-opacity duration-200 ease-out ${
            selected ? "opacity-100" : "opacity-0"
          }`}
          onClick={closeDrawer}
        />
        <aside
          className={`absolute right-0 top-0 h-full w-full max-w-xl transform bg-white shadow-2xl transition-transform duration-200 ease-out ${
            selected ? "translate-x-0" : "translate-x-full"
          }`}
        >
          {!selected ? null : (
            <div className="flex h-full flex-col">
              <div className="border-b border-zinc-200 px-6 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs ${outcomeBadge(selected.outcome)}`}>
                      {selected.outcome.replace("_", " ")}
                    </span>
                    <p className="text-xs text-zinc-500">{selected.callId}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={copyCallId}
                      className="rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100"
                    >
                      Copy ID
                    </button>
                    <button
                      type="button"
                      onClick={closeDrawer}
                      className="rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100"
                    >
                      Close
                    </button>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-xs text-zinc-600">
                  <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-2">
                    <p className="uppercase text-[10px] text-zinc-500">Started</p>
                    <p className="mt-1 text-sm text-zinc-900">{formatDateTime(selected.startedAt)}</p>
                  </div>
                  <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-2">
                    <p className="uppercase text-[10px] text-zinc-500">Ended</p>
                    <p className="mt-1 text-sm text-zinc-900">
                      {selected.endedAt ? formatDateTime(selected.endedAt) : "—"}
                    </p>
                  </div>
                  <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-2">
                    <p className="uppercase text-[10px] text-zinc-500">Duration</p>
                    <p className="mt-1 text-sm text-zinc-900">
                      {minutesBetween(selected.startedAt, selected.endedAt) ?? "—"}m
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
                <section className="rounded-xl border border-zinc-200 bg-white p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Caller</p>
                      <p className="mt-1 text-lg font-semibold text-zinc-900">
                        {formatCallerPhone(selected.callerPhone, selected.businessPhone)}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="rounded-lg border border-zinc-200 px-3 py-2 text-xs text-zinc-600 hover:bg-zinc-100"
                    >
                      Create/Link customer
                    </button>
                  </div>
                </section>

                <section className="rounded-xl border border-zinc-200 bg-white p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Booking</p>
                  {selected.appointment ? (
                    <div className="mt-2 space-y-1 text-sm text-zinc-700">
                      <p className="font-medium text-zinc-900">
                        {selected.appointment.serviceName || "Booking"}
                      </p>
                      <p>{selected.appointment.customerName}</p>
                      <p className="text-xs text-zinc-500">
                        {formatDateTime(selected.appointment.startsAt)} → {formatDateTime(selected.appointment.endsAt)}
                      </p>
                      <a
                        href={`/calendar?appointmentId=${selected.appointment.id}`}
                        className="text-xs font-semibold text-emerald-700 hover:underline"
                      >
                        View appointment
                      </a>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-zinc-500">No booking linked.</p>
                  )}
                </section>

                <section className="rounded-xl border border-zinc-200 bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Transcript</p>
                    <div className="flex items-center gap-2">
                      <input
                        value={drawerQuery}
                        onChange={(e) => {
                          setDrawerQuery(e.target.value);
                          setMatchIndex(0);
                        }}
                        placeholder="Find in transcript"
                        className="h-8 w-40 rounded-lg border border-zinc-200 px-2 text-xs text-zinc-700"
                      />
                      <span className="text-[11px] text-zinc-500">
                        {transcriptMatchCount ? `${(activeMatchIndex ?? 0) + 1}/${transcriptMatchCount}` : "0/0"}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          transcriptMatchCount &&
                          setMatchIndex((v) => (v - 1 + transcriptMatchCount) % transcriptMatchCount)
                        }
                        className="rounded border border-zinc-200 px-2 py-1 text-[11px] text-zinc-600"
                      >
                        Prev
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          transcriptMatchCount &&
                          setMatchIndex((v) => (v + 1) % transcriptMatchCount)
                        }
                        className="rounded border border-zinc-200 px-2 py-1 text-[11px] text-zinc-600"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                  <div ref={transcriptRef} className="mt-3 max-h-56 overflow-auto text-sm text-zinc-700">
                    {selected.transcript ? (
                      (() => {
                        let cursor = 0;
                        return selected.transcript.split("\n").map((line, idx) => {
                          const trimmed = line.trim();
                          if (!trimmed) return null;
                          const built = buildHighlighted(trimmed, effectiveQuery, activeMatchIndex, cursor);
                          cursor += built.count;
                          return (
                            <p key={`${idx}-${trimmed.slice(0, 12)}`}>
                              {built.nodes}
                            </p>
                          );
                        });
                      })()
                    ) : (
                      <p className="text-zinc-400">No transcript captured.</p>
                    )}
                  </div>
                </section>

                <section className="rounded-xl border border-zinc-200 bg-white p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Recording</p>
                  {selected.recordingUrl ? (
                    <div className="mt-3 space-y-2">
                      <audio controls className="w-full">
                        <source src={selected.recordingUrl} />
                      </audio>
                      <a
                        href={selected.recordingUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-semibold text-emerald-700 hover:underline"
                      >
                        Open recording
                      </a>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-zinc-500">No recording available.</p>
                  )}
                </section>

                <details className="rounded-xl border border-zinc-200 bg-white p-4 text-xs text-zinc-600">
                  <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
                    Raw payload
                  </summary>
                  <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-zinc-950 p-3 text-[11px] text-zinc-100">
{safeJsonPretty(selected.rawJson)}
                  </pre>
                </details>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
