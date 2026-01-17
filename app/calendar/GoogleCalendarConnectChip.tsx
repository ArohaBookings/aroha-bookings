"use client";

import React, { useState } from "react";

type Props = {
  isGoogleConnected: boolean;
  googleAccountEmail: string | null;
  orgId: string;
  lastSyncAt?: string | null;
  lastError?: string | null;
  needsReconnect?: boolean;
};

/**
 * Tiny client-side chip that:
 * - Starts OAuth when not connected
 * - Opens calendar selection when connected
 */
export function GoogleCalendarConnectChip({
  isGoogleConnected,
  googleAccountEmail,
  orgId,
  lastSyncAt,
  lastError,
  needsReconnect,
}: Props) {
  const [status, setStatus] = useState<string | null>(null);

  async function handleClick() {
    setStatus(null);

    try {
      window.location.href = "/calendar/connect";
    } catch {
      setStatus("Unable to open Google connect.");
    }
  }

  const label = isGoogleConnected ? (needsReconnect ? "Reconnect Google" : "Google sync on") : "Connect Google";
  const syncHint = lastSyncAt ? `Last sync ${new Date(lastSyncAt).toLocaleString()}` : "No sync yet";
  const title = isGoogleConnected
    ? `Synced to Google${googleAccountEmail ? ` (${googleAccountEmail})` : ""}. ${syncHint}.`
    : "Connect Google Calendar to sync bookings automatically.";

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!orgId}
      title={title}
      className={
        (isGoogleConnected
          ? "inline-flex items-center gap-2 rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-900"
          : "inline-flex items-center gap-2 rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50") +
        (!orgId ? " opacity-70 cursor-not-allowed" : "")
      }
    >
      <span
        className={
          "w-1.5 h-1.5 rounded-full " +
          (isGoogleConnected ? (needsReconnect ? "bg-amber-500" : "bg-emerald-500") : "bg-zinc-400")
        }
        aria-hidden
      />
      {label}
      {isGoogleConnected && (
        <span className="hidden sm:inline text-[10px] text-zinc-500 ml-1">
          · {lastSyncAt ? new Date(lastSyncAt).toLocaleTimeString() : "No sync yet"}
        </span>
      )}
      {lastError && <span className="text-[10px] text-rose-600 ml-1">· Needs attention</span>}
      {status && (
        <span className="text-[10px] text-zinc-500 ml-1">· {status}</span>
      )}
    </button>
  );
}
