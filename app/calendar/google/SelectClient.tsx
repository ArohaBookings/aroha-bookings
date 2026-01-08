// app/calendar/google/SelectClient.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type CalendarListItem = {
  id: string;
  summary: string;
  primary: boolean;
  accessRole?: string;
};

type Props = {
  calendars: CalendarListItem[];
  error: string | null;
};

export default function GoogleCalendarSelectClient({ calendars, error }: Props) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(
    calendars.find(c => c.primary)?.id ?? calendars[0]?.id ?? ""
  );
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const hasCalendars = calendars.length > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    if (!selectedId) {
      setSubmitError("Please select a calendar first.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/calendar/google/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ calendarId: selectedId }),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json.ok) {
        const msg =
          json?.error ||
          `Failed to save Google calendar (status ${res.status}).`;
        setSubmitError(msg);
        return;
      }

      // Go back to main calendar once selected
      router.push("/calendar?tz=org");
    } catch (err) {
      console.error("Error saving Google calendar selection:", err);
      setSubmitError("Something went wrong while saving. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Upstream error from listing calendars */}
      {error && (
        <div className="rounded-md border border-amber-300 bg-amber-50 text-amber-900 px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {!error && !hasCalendars && (
        <div className="rounded-md border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-700">
          No writable calendars were returned from Google. Check that:
          <ul className="list-disc list-inside mt-2 text-xs text-zinc-500 space-y-1">
            <li>You are signed into the correct Google account.</li>
            <li>
              You have at least one calendar that you own or have write access
              to.
            </li>
            <li>You granted Calendar permissions when connecting Google.</li>
          </ul>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <fieldset
          disabled={!hasCalendars || !!error || submitting}
          className="space-y-3"
        >
          <legend className="text-sm font-medium text-zinc-800 mb-1">
            Choose a calendar
          </legend>

          <div className="space-y-2 rounded-md border border-zinc-200 bg-white p-3 max-h-72 overflow-auto">
            {hasCalendars ? (
              calendars.map(cal => {
                const isSelected = selectedId === cal.id;
                return (
                  <label
                    key={cal.id}
                    className={`flex items-start gap-2 rounded-md px-2 py-1.5 cursor-pointer border ${
                      isSelected
                        ? "border-indigo-500 bg-indigo-50"
                        : "border-transparent hover:bg-zinc-50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="calendar"
                      value={cal.id}
                      checked={isSelected}
                      onChange={() => setSelectedId(cal.id)}
                      className="mt-1"
                    />
                    <div>
                      <div className="text-sm font-medium text-zinc-900">
                        {cal.summary}
                        {cal.primary && (
                          <span className="ml-2 text-[10px] uppercase tracking-wide rounded-full bg-indigo-100 text-indigo-700 px-1.5 py-0.5">
                            Primary
                          </span>
                        )}
                      </div>
                      {cal.accessRole && (
                        <div className="text-[11px] text-zinc-500 mt-0.5">
                          Access: {cal.accessRole}
                        </div>
                      )}
                    </div>
                  </label>
                );
              })
            ) : (
              <p className="text-xs text-zinc-500">
                No calendars to display.
              </p>
            )}
          </div>
        </fieldset>

        {submitError && (
          <div className="text-xs text-rose-600">{submitError}</div>
        )}

        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => router.push("/calendar")}
            className="text-xs text-zinc-600 hover:text-zinc-900 underline-offset-2 hover:underline"
          >
            Cancel
          </button>

          <button
            type="submit"
            disabled={!hasCalendars || !!error || submitting}
            className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting ? "Saving..." : "Use this calendar"}
          </button>
        </div>
      </form>
    </div>
  );
}
