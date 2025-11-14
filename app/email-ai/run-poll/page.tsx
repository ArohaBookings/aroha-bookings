// app/email-ai/run-poll/page.tsx
"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

type PollResult = {
  ok: boolean;
  scanned: number;
  drafted: number;
  skipped: number;
  draftsImported?: number;
  error?: string;
};
type Counts = { queued: number; drafted: number; sent: number; skipped: number; total: number };
type StatsResp =
  | { ok: false; error: string }
  | { ok: true; orgId: string; counts: Counts; ts: number };

// ─────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────
async function fetchJSON<T>(
  input: RequestInfo,
  init?: RequestInit & { timeoutMs?: number }
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init?.timeoutMs ?? 20000);
  try {
    const res = await fetch(input, {
      ...init,
      signal: init?.signal ?? controller.signal,
      cache: "no-store",
    });
    if (res.status === 401) {
      window.location.href = "/login";
      throw new Error("Not authenticated");
    }
    const json = (await res.json().catch(() => ({}))) as T;
    return { ok: res.ok, status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

async function getStats(): Promise<StatsResp> {
  const r = await fetchJSON<StatsResp>("/api/email-ai/stats", { timeoutMs: 12000 });
  if (!r.ok) return { ok: false, error: (r.json as any)?.error || `stats ${r.status}` };
  return r.json as StatsResp;
}

function diffChanged(a?: Counts | null, b?: Counts | null) {
  if (!a || !b) return false;
  return (
    a.queued !== b.queued ||
    a.drafted !== b.drafted ||
    a.sent !== b.sent ||
    a.skipped !== b.skipped ||
    a.total !== b.total
  );
}

function Toast({ text, ok = true }: { text: string; ok?: boolean }) {
  return (
    <div
      className={`fixed bottom-4 left-1/2 -translate-x-1/2 px-3 py-2 rounded text-sm text-white z-50 ${
        ok ? "bg-zinc-900" : "bg-rose-600"
      }`}
    >
      {text}
    </div>
  );
}

// ─────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────
export default function PollRunnerPage() {
  const router = useRouter();
  const qs = useSearchParams();

  const [busy, setBusy] = React.useState(false);
  const [stage, setStage] =
    React.useState<"idle" | "import" | "scan" | "watch" | "done" | "error">("idle");
  const [msg, setMsg] = React.useState<string>("");

  const [toast, setToast] = React.useState<{ text: string; ok?: boolean } | null>(null);
  const showToast = (text: string, ok = true) => {
    setToast({ text, ok });
    setTimeout(() => setToast(null), 1600);
  };

  const [stats, setStats] = React.useState({
    scanned: 0,
    drafted: 0,
    skipped: 0,
    draftsImported: 0,
  });

  // ✅ minutes (not seconds)
  const [auto, setAuto] = React.useState<boolean>(false);
  const [intervalMin, setIntervalMin] = React.useState<number>(5); // default 5 min
  const [backfill, setBackfill] = React.useState<boolean>(false);
  const [lastRunAt, setLastRunAt] = React.useState<Date | null>(null);

  const [startCounts, setStartCounts] = React.useState<Counts | null>(null);
  const [nowCounts, setNowCounts] = React.useState<Counts | null>(null);

  const intervalRef = React.useRef<NodeJS.Timeout | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const watchRef = React.useRef<NodeJS.Timeout | null>(null);

  const resetStats = () => setStats({ scanned: 0, drafted: 0, skipped: 0, draftsImported: 0 });
  const setProgressStage = (s: typeof stage, text?: string) => {
    setStage(s);
    if (text) setMsg(text);
  };

  const cancelRun = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (watchRef.current) clearTimeout(watchRef.current as unknown as number);
    setProgressStage("idle", "Cancelled");
    setBusy(false);
    showToast("Cancelled", false);
  };

  // One-shot run; ONLY called by button or auto-run timer
  const runOnce = React.useCallback(async () => {
    if (busy) return;
    setBusy(true);
    resetStats();

    const baseline = await getStats();
    if (!baseline.ok) {
      setMsg(`❌ ${baseline.error}`);
      setStage("error");
      setBusy(false);
      return;
    }
    setStartCounts(baseline.counts);
    setNowCounts(baseline.counts);

    try {
      abortRef.current?.abort();
      abortRef.current = new AbortController();

      // 1) Import existing drafts
      setProgressStage("import", "Syncing existing Gmail drafts…");
      const importRes = await fetchJSON<PollResult>("/api/email-ai/poll?importDraftsOnly=1", {
        method: "POST",
        signal: abortRef.current.signal,
        timeoutMs: 25000,
      });
      if (!importRes.ok || !(importRes.json as PollResult).ok) {
        throw new Error(
          (importRes.json as PollResult)?.error || `Import failed (${importRes.status})`
        );
      }
      const importJson = importRes.json as PollResult;
      setStats((p) => ({ ...p, draftsImported: importJson.draftsImported ?? 0 }));
      setMsg(`Imported ${importJson.draftsImported ?? 0} drafts`);

      // 2) Scan inbox
      setProgressStage("scan", backfill ? "Scanning inbox (90 days lookback)…" : "Scanning inbox (14 days lookback)…");
      const scanUrl = `/api/email-ai/poll${backfill ? "?backfill=1" : ""}`;
      const scanRes = await fetchJSON<PollResult>(scanUrl, {
        method: "POST",
        signal: abortRef.current.signal,
        timeoutMs: 60000,
      });
      if (!scanRes.ok || !(scanRes.json as PollResult).ok) {
        throw new Error((scanRes.json as PollResult)?.error || `Scan failed (${scanRes.status})`);
      }
      const j = scanRes.json as PollResult;
      setStats({ scanned: j.scanned, drafted: j.drafted, skipped: j.skipped, draftsImported: importJson.draftsImported ?? 0 });
      setMsg(`✅ Scanned ${j.scanned}, drafted ${j.drafted}, skipped ${j.skipped}`);

      // 3) Watch counts briefly
      setProgressStage("watch", "Finalizing…");
      let tries = 0;
      const maxTries = 12; // ~24s
      const tick = async () => {
        tries++;
        const s = await getStats();
        if (s.ok) {
          setNowCounts(s.counts);
          if (diffChanged(baseline.ok ? baseline.counts : null, s.counts)) {
            setProgressStage("done", "Updates detected");
            setLastRunAt(new Date());
            setBusy(false);
            showToast("New items ready in Review Queue");
            setTimeout(() => router.push("/email-ai/review"), 1000);
            return;
          }
        }
        if (tries >= maxTries) {
          setProgressStage("done", "No visible changes (yet)");
          setLastRunAt(new Date());
          setBusy(false);
          return;
        }
        watchRef.current = setTimeout(tick, 2000);
      };
      tick();
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      setMsg(`❌ ${e?.message || "Poll failed"}`);
      setProgressStage("error");
      setBusy(false);
      showToast("Poll failed", false);
    }
  }, [backfill, busy, router]);

  // ── Persistence for Auto-run + Interval (minutes)
  React.useEffect(() => {
    const savedAuto = localStorage.getItem("poll:auto") === "1";
    const savedMin = Number(localStorage.getItem("poll:intervalMin") || "5");
    setAuto(savedAuto);
    setIntervalMin(Number.isFinite(savedMin) && savedMin > 0 ? savedMin : 5);
  }, []);
  React.useEffect(() => {
    localStorage.setItem("poll:auto", auto ? "1" : "0");
  }, [auto]);
  React.useEffect(() => {
    localStorage.setItem("poll:intervalMin", String(intervalMin));
  }, [intervalMin]);

  // ── Auto-run scheduler (minutes). Does NOTHING unless auto is ON.
  React.useEffect(() => {
    function clearTimer() {
      if (intervalRef.current) {
        clearInterval(intervalRef.current as unknown as number);
        intervalRef.current = null;
      }
    }
    clearTimer();
    if (!auto) return;
    const ms = Math.max(1, intervalMin) * 60 * 1000; // minutes → ms
    intervalRef.current = setInterval(() => {
      if (document.visibilityState === "visible") void runOnce();
    }, ms);
    return () => clearTimer();
  }, [auto, intervalMin, runOnce]);

  // ❌ No auto-run on mount anymore.
  //    Optional one-time autorun: allow ?autorun=1 for demos
  React.useEffect(() => {
    if (qs.get("autorun") === "1") void runOnce();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Progress bar %
  const stageIndex =
    stage === "idle" ? 0 : stage === "import" ? 1 : stage === "scan" ? 2 : stage === "watch" ? 2.6 : stage === "done" ? 3 : 3;
  const totalStages = 3;
  const percent = Math.min(100, Math.round((stageIndex / totalStages) * 100));
  const changed = diffChanged(startCounts, nowCounts);

  return (
    <div className="p-6 space-y-4 max-w-3xl">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Run poll</h1>
        <div className="flex items-center gap-2">
          <Link href="/email-ai/review" className="px-3 py-1.5 rounded bg-zinc-900 text-white text-sm">Review Queue →</Link>
          <Link href="/email-ai/logs" className="px-3 py-1.5 rounded border text-sm">Logs →</Link>
        </div>
      </div>

      <div className="rounded border bg-white p-3 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={runOnce}
            disabled={busy}
            className="rounded bg-zinc-900 text-white px-3 py-1.5 text-sm disabled:opacity-60"
          >
            {busy ? "Running…" : "Run now"}
          </button>

          {busy ? (
            <button onClick={cancelRun} className="rounded border px-3 py-1.5 text-sm">Cancel</button>
          ) : null}

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            Auto-run
          </label>

          <div className="flex items-center gap-2 text-sm">
            <span>Every</span>
            <input
              type="number"
              min={1}
              step={1}
              value={intervalMin}
              onChange={(e) => setIntervalMin(Math.max(1, Number(e.target.value || 5)))}
              className="w-20 border rounded px-2 py-1"
            />
            <span>min</span>
          </div>

          <label className="flex items-center gap-2 text-sm ml-auto">
            <input type="checkbox" className="h-4 w-4" checked={backfill} onChange={(e) => setBackfill(e.target.checked)} />
            Backfill 90 days
          </label>
        </div>

        {/* Progress bar */}
        <div className="space-y-1">
          <div className="h-2 w-full bg-zinc-200 rounded overflow-hidden">
            {busy && (stage === "import" || stage === "scan") ? (
              <div className="h-full bg-zinc-900 animate-progress rounded" style={{ width: "40%" }} />
            ) : (
              <div className="h-full bg-zinc-900 rounded transition-[width] duration-500" style={{ width: `${percent}%` }} />
            )}
          </div>
          <div className="flex items-center justify-between text-xs text-zinc-600">
            <span>
              {stage === "idle" && "Idle"}
              {stage === "import" && "Step 1/3: Importing drafts"}
              {stage === "scan" && "Step 2/3: Scanning inbox & creating drafts"}
              {stage === "watch" && "Step 3/3: Finalizing & verifying updates"}
              {stage === "done" && (changed ? "Done — updates detected" : "Done — no changes detected")}
              {stage === "error" && "Error"}
            </span>
            <span>{busy ? (stage === "watch" ? `${percent}%` : "Working…") : `${percent}%`}</span>
          </div>
        </div>

        {/* Status line */}
        <div className={stage === "error" ? "text-sm text-rose-600" : "text-sm text-zinc-700"}>{msg || "—"}</div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
          <div className="rounded border p-2 bg-zinc-50">
            <div className="text-zinc-500 text-xs">Imported drafts</div>
            <div className="font-medium">{stats.draftsImported}</div>
          </div>
          <div className="rounded border p-2 bg-zinc-50">
            <div className="text-zinc-500 text-xs">Scanned</div>
            <div className="font-medium">{stats.scanned}</div>
          </div>
          <div className="rounded border p-2 bg-zinc-50">
            <div className="text-zinc-500 text-xs">Drafted</div>
            <div className="font-medium">{stats.drafted}</div>
          </div>
          <div className="rounded border p-2 bg-zinc-50">
            <div className="text-zinc-500 text-xs">Skipped</div>
            <div className="font-medium">{stats.skipped}</div>
          </div>
        </div>

        {/* Before / After */}
        <div className="grid grid-cols-2 gap-2 text-xs text-zinc-600">
          <div className="rounded bg-zinc-50 p-2">
            <div className="font-medium">Before</div>
            <div>Inbox: {startCounts?.queued ?? "—"}</div>
            <div>Drafts: {startCounts?.drafted ?? "—"}</div>
            <div>Sent: {startCounts?.sent ?? "—"}</div>
            <div>Skipped: {startCounts?.skipped ?? "—"}</div>
            <div>Total: {startCounts?.total ?? "—"}</div>
          </div>
          <div className="rounded bg-zinc-50 p-2">
            <div className="font-medium">Now</div>
            <div>Inbox: {nowCounts?.queued ?? "—"}</div>
            <div>Drafts: {nowCounts?.drafted ?? "—"}</div>
            <div>Sent: {nowCounts?.sent ?? "—"}</div>
            <div>Skipped: {nowCounts?.skipped ?? "—"}</div>
            <div>Total: {nowCounts?.total ?? "—"}</div>
          </div>
        </div>

        <div className="text-xs text-zinc-500">
          {lastRunAt ? <>Last run: {lastRunAt.toLocaleString()}</> : "Not run yet on this page."}
        </div>
      </div>

      {toast ? <Toast text={toast.text} ok={toast.ok} /> : null}

      <style>{`
        @keyframes kf-progress {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(250%); }
        }
        .animate-progress { animation: kf-progress 1.2s linear infinite; }
      `}</style>
    </div>
  );
}
