// app/email-ai/review/page.tsx
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import Link from "next/link";
import ReviewClient from "./ReviewClient";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import { readGmailIntegration } from "@/lib/orgSettings";

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

  const [settings, orgSettings] = orgId
    ? await Promise.all([
        prisma.emailAISettings.findUnique({
          where: { orgId },
          select: { minConfidenceToSend: true },
        }),
        prisma.orgSettings.findUnique({
          where: { orgId },
          select: { data: true },
        }),
      ])
    : [null, null];
  const confidenceThreshold = settings?.minConfidenceToSend ?? 0.65;
  const gmailConnected = readGmailIntegration((orgSettings?.data as Record<string, unknown>) || {}).connected;
  const showDebug = process.env.NODE_ENV !== "production";

  // --- read filters from query
  const params = await searchParams;
  const beforeISO = strFromParam(params?.before);
  const q = (strFromParam(params?.q) || "").trim();
  const classFilter = strFromParam(params?.class) as
    | "booking_request"
    | "reschedule"
    | "cancellation"
    | "pricing"
    | "complaint"
    | "faq"
    | "admin"
    | "spam"
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
  subject: gmailConnected ? (r.subject ?? null) : null,
  snippet: gmailConnected ? (r.snippet ?? null) : null,
  gmailMsgId: gmailConnected ? (r.gmailMsgId ?? null) : null,
  gmailThreadId: gmailConnected ? (r.gmailThreadId ?? null) : null,
  rawMeta: gmailConnected ? (r.rawMeta as unknown) : {}, // JsonValue → unknown for UI use
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



if (!gmailConnected) {
  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-zinc-900">Connect Gmail to view emails</h2>
        <p className="mt-2 text-sm text-zinc-600">
          Gmail is disconnected for this organisation. Reconnect to view message content and drafts.
        </p>

        <div className="mt-4">
          <Link
            href="/email-ai/connect"
            className="inline-flex items-center justify-center rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Connect Gmail
          </Link>
        </div>
      </Card>
    </div>
  );
}

  return (
    <div className="p-6 space-y-5 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Email AI — Review Queue</h1>
          <p className="text-sm text-zinc-600">
            Drafts the AI prepared for your approval. Filters persist in the URL.
          </p>
          <div className="mt-2 text-xs text-zinc-500">
            Confidence threshold: {(confidenceThreshold * 100).toFixed(0)}%
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <Badge variant="warning">Inbox (review queue)</Badge>
            <Link href="/email-ai/logs">
              <Badge>Drafts</Badge>
            </Link>
            <Link href="/email-ai/logs">
              <Badge>Auto-sent</Badge>
            </Link>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/email-ai/logs"
            className="rounded-md bg-black px-3 py-1.5 text-white"
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
        <Input
          name="q"
          defaultValue={q}
          placeholder="Search subject/snippet…"
          className="w-72"
        />
        <Select name="class" defaultValue={classFilter ?? ""}>
          <option value="">All categories</option>
          <option value="booking_request">Booking request</option>
          <option value="reschedule">Reschedule</option>
          <option value="cancellation">Cancellation</option>
          <option value="pricing">Pricing</option>
          <option value="complaint">Complaint</option>
          <option value="faq">FAQ</option>
          <option value="admin">Admin</option>
          <option value="spam">Spam</option>
          <option value="other">Other</option>
        </Select>
        <Select
          name="minConf"
          defaultValue={minConfPct != null ? String(minConfPct) : ""}
        >
          <option value="">Any confidence</option>
          <option value="80">≥ 80%</option>
          <option value="60">≥ 60%</option>
          <option value="40">≥ 40%</option>
        </Select>

        <Button variant="secondary" type="submit">
          Apply
        </Button>
        <Link href="/email-ai/review" className="px-2 py-1.5 text-zinc-600 underline">
          Reset
        </Link>

        <div className="ml-auto text-xs text-zinc-500">
          <span id="count-label">{items.length}</span> on this page
        </div>
      </form>

      {/* Bulk actions (wired in ReviewClient) */}
      <Card className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input id="chk-all" type="checkbox" className="h-4 w-4" />
            Select all on page
          </label>
          <Badge id="selected-count">0 selected</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button
            id="bulk-send"
            variant="primary"
            disabled
            title="Enter to send (⌘/Ctrl+Enter on a focused item)"
          >
            Send selected
          </Button>
          <Button
            id="bulk-skip"
            variant="secondary"
            disabled
          >
            Skip selected
          </Button>
        </div>
      </Card>

      {/* Items */}
      {items.length === 0 ? (
        <EmptyState
          title="Nothing to review right now."
          body="Sync runs automatically when Google is connected. Check back shortly."
        />
      ) : (
        <ul id="queue-list" className="space-y-3">
          {items.map((i) => {
            const suggested =
              ((i.rawMeta as any)?.suggested as { subject?: string; body?: string }) ||
              null;
            const aiError = ((i.rawMeta as any)?.aiError as string | undefined) || null;

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
                className="list-none"
                data-id={i.id}
                data-suggested={suggested ? JSON.stringify(suggested) : ""}
                data-class={i.classification ?? "other"}
                data-conf={confPct != null ? String(confPct) : ""}
              >
                <Card padded={false} className="p-4">
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
                <div className="mt-2">
                  <div className="h-1.5 w-full rounded-full bg-zinc-100">
                    <div
                      className="h-1.5 rounded-full bg-zinc-900"
                      style={{ width: `${confPct ?? 0}%` }}
                    />
                  </div>
                  <div className="mt-1 text-[11px] text-zinc-500">
                    Threshold: {(confidenceThreshold * 100).toFixed(0)}% ·{" "}
                    {confPct != null && confPct < confidenceThreshold * 100
                      ? "Escalated for review"
                      : "Above threshold"}
                  </div>
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
                          <span className="js-suggested-subject">{suggested.subject}</span>
                        </div>
                      ) : null}
                      {suggested.body ? (
                        <pre className="mt-2 text-sm whitespace-pre-wrap js-suggested-body">
                          {suggested.body}
                        </pre>
                      ) : null}
                    </div>
                  ) : null}
                  {!suggested && aiError ? (
                    <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                      AI unavailable. Please review manually.
                      {showDebug && isSuperAdmin ? (
                        <div className="mt-1 text-[11px] text-amber-800">{aiError}</div>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="mt-3 rounded border border-zinc-200 bg-white p-3 text-xs text-zinc-600">
                    <div className="font-medium text-zinc-700">Why this reply was queued</div>
                    <div className="mt-1">
                      {confPct != null && confPct < confidenceThreshold * 100
                        ? "Confidence below threshold, so it needs your approval."
                        : "Manual review required by rule or policy."}
                    </div>
                    <div className="mt-1 text-[11px] text-zinc-500">
                      Matched: {i.classification ?? "other"} · Action: {i.action ?? "queued_for_review"}
                    </div>
                  </div>
                </details>

                {/* Actions */}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    variant="primary"
                    className="js-approve"
                    data-id={i.id}
                    title="Send suggested reply"
                  >
                    Send suggested reply
                  </Button>
                  {suggested ? (
                    <Button
                      variant="secondary"
                      className="js-rewrite"
                      data-id={i.id}
                      title="Rewrite suggested reply"
                    >
                      Rewrite
                    </Button>
                  ) : null}

                  {/* Use an internal page so cookies (NextAuth) always apply */}
                  <Link
                  href={`/email-ai/review/${encodeURIComponent(i.id)}/edit`}
                  className="px-3 py-1.5 rounded border"
                  title="Open internal editor with the suggestion"
                   >
                    Edit &amp; send…
                    </Link>

                  <Button
                    variant="secondary"
                    className="js-skip"
                    data-id={i.id}
                    title="Skip this email"
                  >
                    Skip
                  </Button>
                </div>
                </Card>
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
