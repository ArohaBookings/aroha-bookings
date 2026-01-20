// app/email-ai/connect/page.tsx
"use client";
import { useEffect, useMemo, useState } from "react";

type TokenProbe = {
  ok: boolean;
  connected: boolean;
  email?: string | null;
  expires_at?: number | null;   // ms epoch
  had_google_provider?: boolean;
  error?: string;
  gmailConnected?: boolean;
};

const NEAR_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

async function fetchProbe(): Promise<TokenProbe> {
  const [settingsRes, tokenRes] = await Promise.all([
    fetch("/api/email-ai/settings", { cache: "no-store" }),
    fetch("/api/email-ai/token", { cache: "no-store" }),
  ]);

  if (settingsRes.status === 401 || tokenRes.status === 401) {
    // session lost → force login
    window.location.href = "/login?callbackUrl=%2Femail-ai";
    return { ok: false, connected: false };
  }
  const settingsJson = await settingsRes.json().catch(() => ({}));
  const tokenJson = await tokenRes.json().catch(() => ({}));
  const gmailConnected = Boolean(settingsJson?.gmailConnected);
  return {
    ...tokenJson,
    ok: Boolean(tokenJson?.ok) && Boolean(settingsJson?.ok),
    connected: gmailConnected,
    gmailConnected,
  };
}

export default function ConnectGmail() {
  const [probe, setProbe] = useState<TokenProbe | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // initial + one quick recheck (covers the moment right after OAuth callback)
  useEffect(() => {
    let canceled = false;
    (async () => {
      try {
        setErr(null);
        setLoading(true);
        const p1 = await fetchProbe();
        if (!canceled) setProbe(p1);

        // If we just returned from Google, the session can land a tick late.
        // Recheck once after a short delay if not connected.
        if (!canceled && !p1.connected) {
          setTimeout(async () => {
            try {
              const p2 = await fetchProbe();
              if (!canceled) setProbe(p2);
            } catch {}
          }, 1200);
        }
      } catch (e: any) {
        if (!canceled) setErr(e?.message || "Failed to check connection");
      } finally {
        if (!canceled) setLoading(false);
      }
    })();
    return () => {
      canceled = true;
    };
  }, []);

  const nearExpiry = useMemo(() => {
    if (!probe?.expires_at) return false;
    return probe.expires_at - Date.now() <= NEAR_EXPIRY_MS;
  }, [probe?.expires_at]);

  if (loading) return <p>Checking…</p>;

  if (probe?.connected) {
    return (
      <div>
        <h2>Gmail connected</h2>
        <p>
          Signed in as <b>{probe.email ?? "unknown"}</b>.
          {nearExpiry && (
            <>
              {" "}
              <span style={{ color: "#b45309" }}>
                (Token expiring soon — click Reconnect)
              </span>
            </>
          )}
        </p>
        <p>
          Token expiry:{" "}
          {probe.expires_at
            ? new Date(probe.expires_at).toLocaleString()
            : "n/a"}
        </p>
        <a
          className="btn"
          href="/api/auth/signin/google?callbackUrl=%2Femail-ai"
          aria-label="Reconnect Google"
        >
          {nearExpiry ? "Reconnect Google" : "Reconnect / Switch account"}
        </a>
      </div>
    );
  }

  return (
    <div>
      <h2>Email AI Assistant</h2>
      {err && <p style={{ color: "#a00" }}>{err}</p>}
      {!probe?.had_google_provider && (
        <p style={{ color: "#a00" }}>
          Google provider not configured. Check GOOGLE_CLIENT_ID / SECRET and
          GOOGLE_GMAIL_SCOPES.
        </p>
      )}
      {probe?.error && <p style={{ color: "#a00" }}>{probe.error}</p>}
      <a className="btn" href="/api/auth/signin/google?callbackUrl=%2Femail-ai">
        Connect Gmail
      </a>
    </div>
  );
}
