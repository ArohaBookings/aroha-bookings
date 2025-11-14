// app/email-ai/logs/page.tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import Link from "next/link";
import LogsClient from "./LogsClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const fetchCache = "force-no-store";

/* ────────────── tiny SSR bits ────────────── */
const cls = (...c: (string | false | null | undefined)[]) =>
  c.filter(Boolean).join(" ");

const pillTone: Record<string, string> = {
  inquiry: "bg-emerald-100 text-emerald-800",
  job: "bg-blue-100 text-blue-800",
  support: "bg-sky-100 text-sky-800",
  spam: "bg-zinc-200 text-zinc-800",
  other: "bg-zinc-100 text-zinc-700",
  draft_created: "bg-indigo-100 text-indigo-800",
  drafted: "bg-indigo-100 text-indigo-800", // legacy
  auto_sent: "bg-indigo-200 text-indigo-900",
  sent: "bg-indigo-200 text-indigo-900", // legacy
  queued_for_review: "bg-amber-100 text-amber-800",
  skipped_blocked: "bg-rose-100 text-rose-800",
  skipped_manual: "bg-rose-100 text-rose-800",
  skipped: "bg-rose-100 text-rose-800", // legacy
};

function Pill({ children, kind }: { children: React.ReactNode; kind?: string }) {
  const k = kind ?? "other";
  return (
    <span
      className={cls(
        "inline-flex items-center rounded px-2 py-0.5 text-xs font-medium",
        pillTone[k] ?? pillTone.other
      )}
    >
      {children}
    </span>
  );
}

/* Shape we seed to the client */
export type LogRow = {
  id: string;
  orgId: string | null;
  createdAt: string; // ISO
  receivedAt: string | null; // ISO
  emailEpochMs: number | null; // fallback timestamp
  subject: string | null;
  snippet: string | null;
  classification: string; // normalized
  action: string | null; // normalized
  confidence: number | null; // 0..1
  gmailThreadId: string | null;
  gmailMsgId: string | null;
};

/* ────────────── page ────────────── */
export default async function EmailAILogsPage() {
  const session = await auth();
  if (!session?.user?.email) {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-semibold mb-2">Email AI — Logs</h1>
        <p className="text-zinc-600">Please sign in.</p>
      </main>
    );
  }

  const isSuperAdmin = Boolean((session as any)?.isSuperAdmin);

  const membership = await prisma.membership.findFirst({
    where: { user: { email: session.user.email } },
    select: { orgId: true, org: { select: { name: true } } },
    orderBy: { orgId: "asc" },
  });

  const orgId: string | null = membership?.orgId ?? null;
  const orgName: string = membership?.org?.name ?? (orgId ?? "(all orgs)");

  if (!orgId && !isSuperAdmin) {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-semibold mb-2">Email AI — Logs</h1>
        <p className="text-zinc-600">No organisation linked to this user.</p>
      </main>
    );
  }

  // ---- server window (stable cursor by createdAt; sorted by real time after)
  const PAGE = 200;
  const MAX = 2000;
  const rows: any[] = [];
  const baseWhere: any = {};
  if (orgId) baseWhere.orgId = orgId;

  let fetched = 0;
  let cursor: Date | null = null;

  while (fetched < MAX) {
    const batch = await (prisma as any).emailAILog.findMany({
      where: {
        ...baseWhere,
        ...(cursor ? { createdAt: { lt: cursor } } : {}),
      },
      orderBy: { createdAt: "desc" as const },
      take: PAGE,
      select: {
        id: true,
        orgId: true,
        createdAt: true,
        receivedAt: true, // field may be missing in your Prisma types; we cast prisma as any
        subject: true,
        snippet: true,
        classification: true,
        action: true,
        confidence: true,
        gmailThreadId: true,
        gmailMsgId: true,
        rawMeta: true, // Json
      },
    });

    if (!batch.length) break;
    rows.push(...batch);
    fetched += batch.length;
    cursor = batch[batch.length - 1]!.createdAt as Date;
    if (batch.length < PAGE) break;
  }

  // ---- normalize + final “real time” sort (receivedAt -> emailEpochMs -> createdAt)
  const seed: LogRow[] = rows
    .map((r) => {
      const emailEpochMs =
        typeof (r.rawMeta as any)?.emailEpochMs === "number"
          ? (r.rawMeta as any).emailEpochMs
          : null;

      return {
        id: String(r.id),
        orgId: r.orgId ?? null,
        createdAt: (r.createdAt instanceof Date
          ? r.createdAt
          : new Date(r.createdAt)
        ).toISOString(),
        receivedAt: r.receivedAt
          ? (r.receivedAt instanceof Date
              ? r.receivedAt
              : new Date(r.receivedAt)
            ).toISOString()
          : null,
        emailEpochMs,
        subject: r.subject ?? null,
        snippet: r.snippet ?? null,
        classification: (r.classification ?? "other") as string,
        action: r.action ?? null,
        confidence: typeof r.confidence === "number" ? r.confidence : null,
        gmailThreadId: r.gmailThreadId ?? null,
        gmailMsgId: r.gmailMsgId ?? null,
      } as LogRow;
    })
    .sort((a, b) => {
      const stamp = (x: LogRow) =>
        (x.receivedAt ? new Date(x.receivedAt).getTime() : undefined) ??
        (typeof x.emailEpochMs === "number" ? x.emailEpochMs : undefined) ??
        new Date(x.createdAt).getTime();
      return stamp(b) - stamp(a);
    });

  const stats = seed.reduce(
    (acc, r) => {
      acc.total++;
      const act = r.action;
      if (act === "queued_for_review") acc.inbox++;
      if (act === "draft_created" || act === "drafted") acc.drafts++;
      if (act === "auto_sent" || act === "sent") acc.sent++;
      if (
        act === "skipped_blocked" ||
        act === "skipped_manual" ||
        act === "skipped"
      )
        acc.skipped++;
      return acc;
    },
    { total: 0, inbox: 0, drafts: 0, sent: 0, skipped: 0 }
  );

  return (
    <main className="p-0 md:p-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="sticky top-0 z-20 md:rounded md:border bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/70">
        <div className="px-3 md:px-4 py-3 flex flex-wrap items-center gap-3">
          <div className="min-w-[220px]">
            <div className="font-semibold text-lg md:text-xl">
              Email AI — Logs
            </div>
            <div className="text-xs text-zinc-600">
              Org: <b>{orgName}</b>
            </div>
          </div>

          {/* Tabs */}
          <div className="inline-flex border rounded overflow-hidden">
            {["inbox", "drafts", "sent", "skipped", "all"].map((t) => (
              <button
                key={t}
                className="tab px-3 py-1.5 text-sm"
                data-tab={t}
              >
                {t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>

{/* Search / filters */}
<div className="flex items-center gap-2">
  <input
    id="q"
    type="text"
    placeholder="Search subject/snippet…"
    className="border rounded px-3 py-1.5 text-sm w-64"
  />
  <select id="cls" className="border rounded px-2 py-1.5 text-sm">
    <option value="">All classes</option>
    <option value="inquiry">Inquiry</option>
    <option value="job">Job</option>
    <option value="support">Support</option>
    <option value="spam">Spam</option>
    <option value="other">Other</option>
  </select>
  <select id="minc" className="border rounded px-2 py-1.5 text-sm">
    <option value="">Any confidence</option>
    <option value="80">≥ 80 %</option>
    <option value="60">≥ 60 %</option>
    <option value="40">≥ 40 %</option>
  </select>
</div>


          {/* Bulk & nav */}
          <div className="ml-auto flex items-center gap-2">
            <span
              id="sel-n"
              className="text-xs px-2 py-1 bg-zinc-100 rounded"
            >
              0 selected
            </span>
            <button
              id="bulk-approve"
              className="px-3 py-1.5 rounded bg-indigo-600 text-white text-sm disabled:opacity-50"
              disabled
            >
              Bulk Approve
            </button>
            <button
              id="bulk-skip"
              className="px-3 py-1.5 rounded border text-sm disabled:opacity-50"
              disabled
            >
              Bulk Skip
            </button>
            <button id="refresh" className="px-3 py-1.5 border rounded text-sm">
              Refresh
            </button>
            <label className="text-xs md:text-sm flex items-center gap-2">
              <input id="auto" type="checkbox" className="h-4 w-4" />
              Auto-refresh
            </label>
            <Link
              href="/email-ai/review"
              className="px-3 py-1.5 rounded bg-zinc-900 text-white text-sm"
            >
              Review Queue →
            </Link>
          </div>

          {/* Counters */}
          <div className="w-full flex flex-wrap items-center gap-2">
            <span className="px-2 py-1 bg-zinc-100 rounded text-xs">
              Total: {stats.total}
            </span>
            <span className="px-2 py-1 bg-amber-100 text-amber-800 rounded text-xs">
              Inbox: {stats.inbox}
            </span>
            <span className="px-2 py-1 bg-indigo-100 text-indigo-800 rounded text-xs">
              Drafts: {stats.drafts}
            </span>
            <span className="px-2 py-1 bg-indigo-200 text-indigo-900 rounded text-xs">
              Sent: {stats.sent}
            </span>
            <span className="px-2 py-1 bg-rose-100 text-rose-800 rounded text-xs">
              Skipped: {stats.skipped}
            </span>
          </div>
        </div>
      </div>

      {/* Two-pane */}
      <div className="px-3 md:px-4 pt-4 grid grid-cols-1 md:grid-cols-[520px,1fr] gap-4">
        {/* Left list */}
        <div className="rounded border bg-white overflow-hidden">
          <div className="h-10 px-3 border-b flex items-center justify-between text-xs text-zinc-600">
            <div>
              <label className="inline-flex items-center gap-2">
                <input id="all" type="checkbox" className="h-4 w-4" />
                <span>Select all on page</span>
              </label>
              <span className="ml-2">
                • <span id="count">0</span> items
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button id="older" className="underline">
                Load older
              </button>
            </div>
          </div>
          <ul
            id="list"
            className="divide-y divide-zinc-100 max-h-[78vh] overflow-auto"
          />
        </div>

        {/* Right preview / composer */}
        <div className="rounded border bg-white overflow-hidden">
          {/* Header for preview */}
          <div className="h-10 px-4 border-b flex items-center justify-between">
            <div className="text-sm font-medium" id="subj">
              (Select an item)
            </div>
            <div className="flex items-center gap-2" id="pills">
              <Pill>class</Pill>
              <Pill>action</Pill>
            </div>
          </div>

          {/* Message preview area */}
          <div id="body" className="p-4 space-y-4 text-sm text-zinc-800">
            <div className="text-zinc-500">No email selected.</div>
          </div>

          {/* Composer + actions */}
          <div className="border-t p-3 flex flex-wrap items-center gap-2">
            <button
              id="act-suggest"
              className="px-3 py-1.5 rounded bg-amber-600 text-white text-sm disabled:opacity-50"
              disabled
            >
              Suggest reply → Review
            </button>

            <span className="mx-2 text-zinc-300">|</span>

            <button
              id="act-send"
              className="px-3 py-1.5 rounded bg-indigo-600 text-white text-sm disabled:opacity-50"
              disabled
            >
              Send
            </button>

            <button
              id="act-save"
              className="px-3 py-1.5 rounded border text-sm disabled:opacity-50"
              disabled
            >
              Save Draft
            </button>

            <button
              id="act-skip"
              className="px-3 py-1.5 rounded border text-sm text-zinc-700 disabled:opacity-50"
              disabled
            >
              Skip
            </button>

            <a
              id="act-gmail"
              href="#"
              target="_blank"
              rel="noreferrer"
              className="ml-auto text-sm text-indigo-600 underline opacity-50 pointer-events-none"
            >
              Open in Gmail
            </a>
          </div>
        </div>
      </div>

      {/* Client app (all interactivity lives here) */}
      <LogsClient seed={seed} />
    </main>
  );
}
