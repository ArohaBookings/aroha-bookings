// app/email-ai/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession, signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";

/** Shape returned by /api/email-ai/token (see route I gave you) */
type TokenResp = {
  ok: boolean;
  connected: boolean;
  email: string | null;
  /** epoch ms or sec; we normalize below */
  expires_at: number | null;
  /** true/false when backend can tell if Google provider is configured */
  had_google_provider?: boolean;
  /** true if a refresh token is on the server (so access can auto-refresh server-side) */
  has_refresh_token?: boolean;
  /** optional machine reason for why connected=false */
  reason?: string | null;
  error?: string;
};

type ProbeState =
  | { kind: "idle" }
  | { kind: "probing" }
  | { kind: "ok"; data: TokenResp }
  | { kind: "err"; msg: string };

export default function EmailAIPage() {
  const { data: session, status } = useSession();
  const authed = status === "authenticated";
  const loadingSession = status === "loading";

  const router = useRouter();
  const params = useSearchParams();

  const [state, setState] = useState<ProbeState>({ kind: "idle" });
  const [btnBusy, setBtnBusy] = useState(false);

  // read ?connected=1 once so we can show a post-connect hint and then clean URL
  const connectedFlag = useMemo(() => params?.get("connected") === "1", [params]);

  /** normalize epoch seconds → ms */
  const normalizeMs = (n: number | null | undefined) =>
    !n ? null : n < 10_000_000_000 ? n * 1000 : n;

  /** light toast helper */
  const toastRef = useRef<HTMLDivElement | null>(null);
  const showToast = useCallback((msg: string, ok = true) => {
    const el = toastRef.current;
    if (!el) return;
    el.textContent = msg;
    el.style.background = ok ? "#111" : "#b42318";
    el.classList.remove("hidden");
    window.setTimeout(() => el.classList.add("hidden"), 1600);
  }, []);

  /** fetch token probe with small retry + abort safety */
  const probe = useCallback(async () => {
    if (!authed) return;
    const ctrl = new AbortController();
    setState({ kind: "probing" });

    // 2 attempts with small delay; protects against cold server fetch stalls
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const r = await fetch("/api/email-ai/token", {
          cache: "no-store",
          signal: ctrl.signal,
        });

        if (r.status === 401) {
          setState({ kind: "err", msg: "Not authenticated." });
          return;
        }
        const j = (await r.json()) as TokenResp;
        setState({ kind: "ok", data: j });

        // clean query ?connected=1 after first successful read
        if (connectedFlag) {
          const url = new URL(window.location.href);
          url.searchParams.delete("connected");
          // keep other params intact
          const qs = url.searchParams.toString();
          router.replace(url.pathname + (qs ? `?${qs}` : ""));
        }
        return; // success, stop retries
      } catch (e) {
        if (attempt === 2) {
          setState({ kind: "err", msg: "Could not reach token endpoint." });
        } else {
          await new Promise((res) => setTimeout(res, 350)); // brief backoff
        }
      }
    }

    return () => ctrl.abort();
  }, [authed, connectedFlag, router]);

  /** initial load + re-probe when session becomes ready */
  useEffect(() => {
    if (!authed) return;
    probe();
  }, [authed, probe]);

  /** auto-refresh toggle (localStorage persisted) */
  const autoKey = "emailai_autorefresh";
  const [auto, setAuto] = useState<boolean>(() => {
    try {
      return localStorage.getItem(autoKey) === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (!auto) return;
    const id = window.setInterval(() => probe(), 30_000);
    return () => window.clearInterval(id);
  }, [auto, probe]);

  /** Trigger Google connect */
  async function handleConnect() {
    setBtnBusy(true);
    try {
      await signIn("google", {
        callbackUrl: "/email-ai?connected=1",
      });
    } finally {
      setBtnBusy(false);
    }
  }

  /** convenience derived bits */
  const ok = state.kind === "ok" ? state.data : null;
  const connected = !!ok?.connected;
  const expiry = normalizeMs(ok?.expires_at);

  /** connection badge */
  const Badge = ({ on, label }: { on: boolean; label: string }) => (
    <span
      className={
        "inline-flex items-center rounded px-2 py-0.5 text-xs font-medium " +
        (on ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800")
      }
    >
      {label}
    </span>
  );

  return (
    <div className="p-8 max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-semibold">Email AI Assistant</h1>

      {/* session gate */}
      {loadingSession && <p className="text-zinc-700">Checking session…</p>}
      {!loadingSession && !authed && (
        <p className="text-zinc-700">Please log in first.</p>
      )}

      {/* probing state */}
      {authed && state.kind === "probing" && (
        <div className="rounded border bg-white p-4 text-sm text-zinc-700">
          Checking Gmail connection…
        </div>
      )}

      {/* error state */}
      {authed && state.kind === "err" && (
        <div className="rounded border bg-rose-50 p-4 text-sm text-rose-700">
          {state.msg}{" "}
          <button
            className="ml-2 underline"
            onClick={() => {
              showToast("Retrying…");
              probe();
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* disconnected card (only render when we know we're not connected) */}
      {authed && ok && !connected && (
        <div className="rounded border bg-white p-5 space-y-3">
          {ok.had_google_provider === false && (
            <p className="text-red-600 text-sm">
              Google provider not configured (check GOOGLE_CLIENT_ID / SECRET / scopes).
            </p>
          )}

          {ok.error && (
            <p className="text-amber-700 text-sm">Note: {ok.error}</p>
          )}

          {ok.reason && (
            <p className="text-zinc-700 text-sm">
              Status: <b>{ok.reason}</b>
            </p>
          )}

          <p className="text-zinc-700">
            Connect your Gmail so our AI can read &amp; reply to emails for your business.
          </p>

          <div className="flex items-center gap-2">
            <button
              onClick={handleConnect}
              disabled={btnBusy}
              className="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-500 disabled:opacity-60"
            >
              {btnBusy ? "Connecting…" : "Connect Gmail"}
            </button>

            <button
              onClick={() => probe()}
              className="border px-3 py-2 rounded"
              title="Re-check connection"
            >
              Recheck
            </button>

            <label className="ml-auto text-sm flex items-center gap-2">
              <input
                type="checkbox"
                checked={auto}
                onChange={(e) => {
                  const v = e.target.checked;
                  setAuto(v);
                  try {
                    if (v) localStorage.setItem(autoKey, "1");
                    else localStorage.removeItem(autoKey);
                  } catch {}
                }}
              />
              Auto-refresh
            </label>
          </div>

          <p className="text-xs text-zinc-500">
            You’ll grant read/modify/send permissions in Google. You can revoke any time.
          </p>
        </div>
      )}

      {/* connected card */}
      {authed && ok && connected && (
        <div className="rounded border bg-white p-5 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge on={true} label="Connected" />
            <div className="text-sm text-zinc-700">
              Gmail as <b>{ok.email ?? session?.user?.email ?? "unknown"}</b>
            </div>
          </div>

          <div className="text-sm text-zinc-600">
            Token expiry: {expiry ? new Date(expiry).toLocaleString() : "n/a"}
            {ok.has_refresh_token ? (
              <span className="ml-2 text-emerald-700">(auto-refresh enabled)</span>
            ) : (
              <span className="ml-2 text-amber-700">
                (no refresh token; you may need to reconnect with consent)
              </span>
            )}
          </div>

          <div className="pt-2 flex flex-wrap gap-2">
            <button
              onClick={() => router.push("/email-ai/settings")}
              className="border px-3 py-1.5 rounded"
            >
              Open Email-AI Settings
            </button>
            <button
              onClick={() => router.push("/email-ai/run-poll")}
              className="border px-3 py-1.5 rounded"
              title="Trigger a scan now"
            >
              Run Poll
            </button>
            <button
              onClick={() => router.push("/email-ai/review")}
              className="border px-3 py-1.5 rounded"
              title="Approve or edit replies"
            >
              Review Queue
            </button>
            <button
              onClick={() => router.push("/email-ai/logs")}
              className="border px-3 py-1.5 rounded"
              title="See history & outcomes"
            >
              Logs
            </button>
            <button
              onClick={() => {
                showToast("Refreshing…");
                probe();
              }}
              className="border px-3 py-1.5 rounded"
            >
              Refresh status
            </button>

            <label className="ml-auto text-sm flex items-center gap-2">
              <input
                type="checkbox"
                checked={auto}
                onChange={(e) => {
                  const v = e.target.checked;
                  setAuto(v);
                  try {
                    if (v) localStorage.setItem(autoKey, "1");
                    else localStorage.removeItem(autoKey);
                  } catch {}
                }}
              />
              Auto-refresh
            </label>
          </div>

          {/* post-connect hint */}
          {connectedFlag && (
            <p className="text-xs text-zinc-500">
              Tip: Kick off your first scan via <b>Run Poll</b>.
            </p>
          )}

          {/* small “troubleshoot” footer */}
          <details className="mt-2 text-xs text-zinc-600">
            <summary className="cursor-pointer">Troubleshoot</summary>
            <ul className="list-disc ml-5 space-y-1 mt-2">
              <li>
                If this page flips to “Connect Gmail”, you likely lost your session or the access
                token expired and no refresh token is available. Click <b>Refresh status</b> or
                reconnect.
              </li>
              <li>
                Ensure your Google Cloud OAuth consent screen has your test user added and that{" "}
                <code>access_type=offline</code> + <code>prompt=consent</code> are present (they are in this app).
              </li>
              <li>
                If you changed env vars, restart the dev server so NextAuth reloads provider config.
              </li>
            </ul>
          </details>
        </div>
      )}

      {/* toast */}
      <div
        ref={toastRef}
        className="hidden fixed bottom-4 left-1/2 -translate-x-1/2 rounded bg-black text-white px-3 py-2 text-sm z-50"
      />

      {/* tiny diagnostics (helpful while you’re finishing this out) */}
      {authed && ok && (
        <details className="text-xs text-zinc-600">
          <summary className="cursor-pointer">Debug</summary>
          <pre className="mt-2 bg-zinc-50 rounded p-2 overflow-auto">
            {JSON.stringify(ok, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
