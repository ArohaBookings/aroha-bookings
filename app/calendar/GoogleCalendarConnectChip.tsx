"use client";

import * as React from "react";

type Props = {
  isGoogleConnected: boolean;
  googleAccountEmail: string | null;
  orgId: string;
  lastSyncAt?: string | null;
  lastError?: string | null;
  needsReconnect?: boolean;
};

type Status =
  | { kind: "idle" }
  | { kind: "info"; message: string }
  | { kind: "error"; message: string };

function formatTime(value?: string | null) {
  if (!value) return "No sync yet";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "No sync yet";
  try {
    return d.toLocaleTimeString();
  } catch {
    return "No sync yet";
  }
}

function formatSyncHint(value?: string | null) {
  if (!value) return "No sync yet";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "No sync yet";
  try {
    return `Last sync ${d.toLocaleString()}`;
  } catch {
    return "No sync yet";
  }
}

export function GoogleCalendarConnectChip({
  isGoogleConnected,
  googleAccountEmail,
  orgId,
  lastSyncAt,
  lastError,
  needsReconnect,
}: Props) {
  const [status, setStatus] = React.useState<Status>({ kind: "idle" });
  const busyRef = React.useRef(false);

  const label = React.useMemo(() => {
    if (!isGoogleConnected) return "Connect Google";
    return needsReconnect ? "Reconnect Google" : "Google sync on";
  }, [isGoogleConnected, needsReconnect]);

  const title = React.useMemo(() => {
    if (!isGoogleConnected) return "Connect Google Calendar to sync bookings automatically.";
    const acct = googleAccountEmail ? ` (${googleAccountEmail})` : "";
    return `Synced to Google${acct}. ${formatSyncHint(lastSyncAt)}.`;
  }, [isGoogleConnected, googleAccountEmail, lastSyncAt]);

  const dotClass = React.useMemo(() => {
    if (!isGoogleConnected) return "bg-zinc-400";
    return needsReconnect ? "bg-amber-500" : "bg-emerald-500";
  }, [isGoogleConnected, needsReconnect]);

  const baseClass =
    "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors";
  const enabledClass = isGoogleConnected
    ? "border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100"
    : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50";
  const disabledClass = !orgId ? " opacity-70 cursor-not-allowed" : "";

  const handleClick = React.useCallback(() => {
    if (!orgId) return;
    if (busyRef.current) return;
    busyRef.current = true;

    try {
      setStatus({ kind: "idle" });
      // If you ever want to pass orgId through, do it here:
      // window.location.assign(`/calendar/connect?orgId=${encodeURIComponent(orgId)}`);
      window.location.assign("/calendar/connect");
    } catch {
      setStatus({ kind: "error", message: "Unable to open Google connect." });
      busyRef.current = false;
    }
  }, [orgId]);

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!orgId}
      title={title}
      className={baseClass + " " + enabledClass + disabledClass}
    >
      <span className={"h-1.5 w-1.5 rounded-full " + dotClass} aria-hidden />

      <span>{label}</span>

      {isGoogleConnected && (
        <span className="hidden sm:inline text-[10px] text-zinc-500 ml-1">
          · {formatTime(lastSyncAt)}
        </span>
      )}

      {lastError ? (
        <span className="text-[10px] text-rose-600 ml-1">· Needs attention</span>
      ) : null}

      {status.kind !== "idle" ? (
        <span className={"text-[10px] ml-1 " + (status.kind === "error" ? "text-rose-600" : "text-zinc-500")}>
          · {status.message}
        </span>
      ) : null}
    </button>
  );
}
