"use client";

import React, { useState, useTransition } from "react";

type Props = {
  isGoogleConnected: boolean;
  googleAccountEmail: string | null;
};

/**
 * Tiny client-side chip that:
 * - POSTs /api/calendar/google/select with { calendarId: "primary" } for now.
 * - Shows loading state + simple status.
 * - Reloads page so CalendarPage sees updated googleCalendarId.
 */
export function GoogleCalendarConnectChip({
  isGoogleConnected,
  googleAccountEmail,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);

  async function handleClick() {
    setStatus(null);

    // For now we use "primary". Later you can replace this with a popup
    // that lets the user choose a specific calendar id from google.
    const calendarId = "primary";

    startTransition(async () => {
      try {
        const res = await fetch("/api/calendar/google/select", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ calendarId }),
        });

        const data = await res.json();
        if (!res.ok || !data.ok) {
          console.error("Google select error", data);
          setStatus(data.error || "Failed to connect");
          return;
        }

        setStatus("Connected");
        window.location.reload();
      } catch (err) {
        console.error("Google select network error", err);
        setStatus("Network error");
      }
    });
  }

  const label = isGoogleConnected ? "Google sync on" : "Connect Google";
  const title = isGoogleConnected
    ? `Synced to Google${googleAccountEmail ? ` (${googleAccountEmail})` : ""}. Click to re-link.`
    : "Connect Google Calendar to sync bookings automatically.";

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      title={title}
      className={
        (isGoogleConnected
          ? "inline-flex items-center gap-2 rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-900"
          : "inline-flex items-center gap-2 rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50") +
        (pending ? " opacity-70 cursor-wait" : "")
      }
    >
      <span
        className={
          "w-1.5 h-1.5 rounded-full " +
          (isGoogleConnected ? "bg-emerald-500" : "bg-zinc-400")
        }
        aria-hidden
      />
      {pending ? "Connecting..." : label}
      {status && !pending && (
        <span className="text-[10px] text-zinc-500 ml-1">· {status}</span>
      )}
    </button>
  );
}
