"use client";

import { useEffect } from "react";

export default function AnalyticsError({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[analytics] error boundary", error);
  }, [error]);

  return (
    <div className="p-6">
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6">
        <p className="text-xs uppercase tracking-[0.2em] text-rose-500">Analytics error</p>
        <h2 className="mt-2 text-lg font-semibold text-rose-900">Something went wrong.</h2>
        <p className="mt-2 text-sm text-rose-700">
          Try reloading the analytics view. If it keeps happening, reach out and we will fix it fast.
        </p>
        <button
          type="button"
          onClick={() => reset()}
          className="mt-4 rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700"
        >
          Retry
        </button>
      </div>
    </div>
  );
}
