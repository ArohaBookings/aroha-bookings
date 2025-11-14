// app/email-ai/review/page.tsx
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import Link from "next/link";
import ReviewClient from "./ReviewClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/** Next App Router: searchParams is async in server components */
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function numFromParam(v: string | string[] | undefined): number | undefined {
  if (!v) return undefined;
  const s = Array.isArray(v) ? v[0] : v;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function strFromParam(v: string | string[] | undefined): string | undefined {
  if (!v) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

function buildUrl(base: string, params: Record<string, string | undefined>) {
  const u = new URL(base, "http://x"); // dummy origin to use URL API
  Object.entries(params).forEach(([k, v]) => {
    if (v == null || v === "") u.searchParams.delete(k);
    else u.searchParams.set(k, v);
  });
  return u.pathname + (u.search ? u.search : "");
}

export default async function ReviewQueuePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth();
  if (!session?.user?.email) {
    return (
      <div className="p-6">
        Please sign in.{" "}
        <Link className="text-indigo-600 underline" href="/login">
          Go to login
        </Link>
      </div>
    );
  }

  // Resolve org (first one for this user)
  const isSuperAdmin = Boolean((session as any)?.isSuperAdmin);
  const membership = await prisma.membership.findFirst({
    where: { user: { email: session.user.email } },
    select: { orgId: true },
    orderBy: { orgId: "asc" },
  });
  const orgId: string | null = membership?.orgId ?? null;
  if (!orgId && !isSuperAdmin) {
    return <div className="p-6">No organisation linked to this user.</div>;
  }

  // --- read filters from query
  const params = await searchParams;
  const beforeISO = strFromParam(params?.before);
  const q = (strFromParam(params?.q) || "").trim();
  const classFilter = strFromParam(params?.class) as
    | "inquiry"
    | "job"
    | "support"
    | "other"
    | undefined;
  const minConfPct = numFromParam(params?.minConf); // e.g. 60 => 0.6

  const beforeDate = beforeISO ? new Date(beforeISO) : null;

  // where clause (server-side)
  const where: any = {
    action: { in: ["queued_for_review", "draft_created"] },
    ...(beforeDate ? { createdAt: { lt: beforeDate } } : {}),
  };
  if (orgId) where.orgId = orgId;
  if (classFilter) where.classification = classFilter;
  if (minConfPct != null) where.confidence = { gte: Math.max(0, Math.min(1, minConfPct / 100)) };
  if (q) {
    // very simple text search across subject/snippet
    where.OR = [
      { subject: { contains: q, mode: "insensitive" } },
      { snippet: { contains: q, mode: "insensitive" } },
    ];
  }

// newest first (we still order by createdAt to keep pagination stable,
// ---- types we want to use in the UI
type Row = {
  id: string;
  createdAt: Date;
  receivedAt: Date | null;
  subject: string | null;
  snippet: string | null;
  gmailMsgId: string | null;
  gmailThreadId: string | null;
  rawMeta: unknown;
  action: string | null;
  confidence: number | null;
  classification: string | null;
  orgId: string;
};

// ---- fetch using Prisma's own typing, then coerce to Row explicitly
const prismaRows = await (prisma as any).emailAILog.findMany({
  where,
  orderBy: { createdAt: "desc" },
  take: 50,
  select: {
    id: true,
    createdAt: true,
    receivedAt: true,
    subject: true,
    snippet: true,
    gmailMsgId: true,
    gmailThreadId: true,
    rawMeta: true,           // Prisma.JsonValue
    action: true,
    confidence: true,
    classification: true,
    orgId: true,
  },
});

// explicit mapping keeps TS happy and future-proof
const items: Row[] = prismaRows.map((r) => ({
  id: r.id,
  createdAt: r.createdAt,
  receivedAt: r.receivedAt ?? null,
  subject: r.subject ?? null,
  snippet: r.snippet ?? null,
  gmailMsgId: r.gmailMsgId ?? null,
  gmailThreadId: r.gmailThreadId ?? null,
  rawMeta: r.rawMeta as unknown, // JsonValue → unknown for UI use
  action: r.action ?? null,
  confidence: typeof r.confidence === "number" ? r.confidence : null,
  classification: r.classification ?? null,
  orgId: r.orgId,
}));

const nextCursor =
  items.length === 50
    ? items[items.length - 1]!.createdAt.toISOString()
    : null;

// Prefer receivedAt, then rawMeta.emailEpochMs, then createdAt
const renderWhen = (i: Row) => {
  const emailEpoch =
    typeof (i.rawMeta as any)?.emailEpochMs === "number"
      ? (i.rawMeta as any).emailEpochMs
      : undefined;

  const epoch =
    i.receivedAt?.getTime?.() ??
    emailEpoch ??
    i.createdAt.getTime();

  const d = new Date(epoch);
  const abs = d.toLocaleString();
  const rel = timeSince(d);
  return `${abs} • ${rel}`;
};

function timeSince(date: Date) {
  const diffSec = Math.max(1, Math.floor((Date.now() - date.getTime()) / 1000));
  const steps: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, "second"],        // < 60s → seconds
    [60, "minute"],        // < 60m → minutes
    [24, "hour"],          // < 24h → hours
    [7, "day"],            // < 7d  → days
    [4.345, "week"],       // < ~1m → weeks
    [12, "month"],         // < 1y  → months
    [Infinity, "year"],    // else  → years
  ];
  let unit: Intl.RelativeTimeFormatUnit = "second";
  let value = diffSec;
  for (const [k, u] of steps) {
    if (value < k) { unit = u; break; }
    value = Math.floor(value / k);
  }
  const rtf = new Intl.RelativeTimeFormat("en-NZ", { numeric: "auto" });
  return rtf.format(-value, unit); // e.g. “5 minutes ago”
}


  // build URLs that preserve filters
  const makeUrl = (extra: Record<string, string | undefined>) =>
    buildUrl(
      "/email-ai/review",
      {
        q: q || undefined,
        class: classFilter || undefined,
        minConf: minConfPct != null ? String(minConfPct) : undefined,
        before: beforeISO || undefined,
        ...extra,
      }
    );

  return (
    <div className="p-6 space-y-5 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Email AI — Review Queue</h1>
          <p className="text-sm text-zinc-600">
            Drafts the AI prepared for your approval. Filters persist in the URL.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/email-ai/logs"
            className="px-3 py-1.5 rounded bg-zinc-900 text-white"
          >
            View Logs
          </Link>
        </div>
      </div>

      {/* Toolbar (server-driven filters via URL) */}
      <form
        action="/email-ai/review"
        method="get"
        className="flex items-center gap-2 text-sm"
      >
        <input
          name="q"
          defaultValue={q}
          placeholder="Search subject/snippet…"
          className="border rounded px-3 py-1.5 w-72"
        />
        <select
          name="class"
          defaultValue={classFilter ?? ""}
          className="border rounded px-2 py-1.5"
        >
          <option value="">All classes</option>
          <option value="inquiry">Inquiry</option>
          <option value="job">Job</option>
          <option value="support">Support</option>
          <option value="other">Other</option>
        </select>
        <select
          name="minConf"
          defaultValue={minConfPct != null ? String(minConfPct) : ""}
          className="border rounded px-2 py-1.5"
        >
          <option value="">Any confidence</option>
          <option value="80">≥ 80%</option>
          <option value="60">≥ 60%</option>
          <option value="40">≥ 40%</option>
        </select>

        <button className="px-3 py-1.5 rounded border" type="submit">
          Apply
        </button>
        <Link href="/email-ai/review" className="px-2 py-1.5 text-zinc-600 underline">
          Reset
        </Link>

        <div className="ml-auto text-xs text-zinc-500">
          <span id="count-label">{items.length}</span> on this page
        </div>
      </form>

      {/* Bulk actions (wired in ReviewClient) */}
      <div className="flex items-center justify-between border rounded p-3 bg-white">
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input id="chk-all" type="checkbox" className="h-4 w-4" />
            Select all on page
          </label>
          <span id="selected-count" className="text-sm text-zinc-600">
            0 selected
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            id="bulk-send"
            className="px-3 py-1.5 rounded bg-indigo-600 text-white disabled:opacity-50"
            disabled
            title="Enter to send (⌘/Ctrl+Enter on a focused item)"
          >
            Send selected
          </button>
          <button
            id="bulk-skip"
            className="px-3 py-1.5 rounded border disabled:opacity-50"
            disabled
          >
            Skip selected
          </button>
        </div>
      </div>

      {/* Items */}
      {items.length === 0 ? (
        <div className="rounded border border-dashed p-10 text-center text-zinc-600 bg-white">
          Nothing to review right now. Click <b>Refresh</b> in your browser or run a poll:
          <code className="ml-1 rounded bg-zinc-100 px-1">POST /api/email-ai/poll</code>
        </div>
      ) : (
        <ul id="queue-list" className="space-y-3">
          {items.map((i) => {
            const suggested =
              ((i.rawMeta as any)?.suggested as { subject?: string; body?: string }) ||
              null;

            // confidence badge
            const confPct =
              typeof i.confidence === "number" ? Math.round(i.confidence * 100) : null;
            const confBadge =
              confPct == null
                ? "—"
                : confPct >= 80
                ? "bg-green-100 text-green-700"
                : confPct >= 60
                ? "bg-amber-100 text-amber-700"
                : "bg-red-100 text-red-700";

            return (
              <li
                key={i.id}
                className="rounded border bg-white p-4"
                data-id={i.id}
                data-suggested={suggested ? JSON.stringify(suggested) : ""}
                data-class={i.classification ?? "other"}
                data-conf={confPct != null ? String(confPct) : ""}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <input type="checkbox" className="row-chk mt-1.5 h-4 w-4" />
                    <div>
                      <div className="text-xs text-zinc-500">{renderWhen(i)}</div>
                      <div className="mt-0.5 font-medium">
                        {i.subject ?? "(no subject)"}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-600">
                        <span className="inline-flex items-center gap-1">
                          Class:
                          <span className="rounded-full bg-zinc-100 px-2 py-0.5">
                            {i.classification ?? "other"}
                          </span>
                        </span>
                        <span className="inline-flex items-center gap-1">
                          Conf:
                          <span className={`rounded-full px-2 py-0.5 ${confBadge}`}>
                            {confPct == null ? "—" : `${confPct}%`}
                          </span>
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    {i.gmailThreadId ? (
                      <a
                        href={`https://mail.google.com/mail/u/0/#inbox/${encodeURIComponent(
                          i.gmailThreadId
                        )}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-zinc-600 underline"
                        title="Open thread in Gmail"
                      >
                        Open thread
                      </a>
                    ) : null}
                    {(i.rawMeta as any)?.draftId ? (
                      <a
                        href={`https://mail.google.com/mail/u/0/#drafts?compose=${encodeURIComponent(
                          (i.rawMeta as any).draftId
                        )}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-indigo-600 underline"
                        title="Open draft in Gmail"
                      >
                        Edit draft (Gmail)
                      </a>
                    ) : null}
                  </div>
                </div>

                {/* Collapsible preview */}
                <details className="mt-3 group">
                  <summary className="cursor-pointer text-sm text-zinc-700">
                    Preview
                  </summary>
                  <div className="mt-2 text-sm text-zinc-700 whitespace-pre-wrap">
                    {i.snippet || "—"}
                  </div>

                  {/* Suggested reply block */}
                  {suggested ? (
                    <div className="mt-3 rounded border bg-zinc-50 p-3">
                      <div className="text-xs font-medium text-zinc-700">
                        Suggested reply
                      </div>
                      {suggested.subject ? (
                        <div className="mt-1 text-sm">
                          <span className="font-medium">Subject: </span>
                          {suggested.subject}
                        </div>
                      ) : null}
                      {suggested.body ? (
                        <pre className="mt-2 text-sm whitespace-pre-wrap">
                          {suggested.body}
                        </pre>
                      ) : null}
                    </div>
                  ) : null}
                </details>

                {/* Actions */}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    className="js-approve px-3 py-1.5 rounded bg-indigo-600 text-white"
                    data-id={i.id}
                    title="Send suggested reply"
                  >
                    Send suggested reply
                  </button>

                  {/* Use an internal page so cookies (NextAuth) always apply */}
                  <Link
                  href={`/email-ai/review/${encodeURIComponent(i.id)}/edit`}
                  className="px-3 py-1.5 rounded border"
                  title="Open internal editor with the suggestion"
                   >
                    Edit &amp; send…
                    </Link>

                  <button
                    className="js-skip px-3 py-1.5 rounded border text-zinc-600"
                    data-id={i.id}
                    title="Skip this email"
                  >
                    Skip
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Pagination */}
      <div className="pt-2 flex justify-between items-center text-sm">
        <span className="text-zinc-500">
          Tip: ⌘/Ctrl+Enter sends the focused item. S skips.
        </span>
        {nextCursor ? (
          <Link
            href={makeUrl({ before: nextCursor })}
            className="px-3 py-1.5 rounded border"
          >
            Older →
          </Link>
        ) : null}
      </div>

      {/* toast */}
      <div
        id="toast"
        className="hidden fixed bottom-4 left-1/2 -translate-x-1/2 rounded bg-black text-white px-3 py-2 text-sm z-50"
      ></div>

      {/* Client-side helpers (hotkeys, select-all, bulk send/skip, auto-refresh, etc.) */}
      <ReviewClient />
    </div>
  );
}
