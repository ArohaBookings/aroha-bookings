//app/support/resend-setup/ResendSetupForm.tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";

type Status = "idle" | "loading" | "success" | "error";

export default function ResendSetupForm() {
  const searchParams = useSearchParams();

  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string>("");
  const [lastSentTo, setLastSentTo] = useState<string | null>(null);
  const [lastSentAt, setLastSentAt] = useState<Date | null>(null);

  // Prefill from ?email= query or from previous attempt (localStorage)
  useEffect(() => {
    const qpEmail = searchParams?.get("email")?.trim() ?? "";
    if (qpEmail) {
      setEmail(qpEmail.toLowerCase());
      return;
    }

    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem("resend-setup:last-email") ?? "";
      if (stored) setEmail(stored);
    }
  }, [searchParams]);

  const validateEmail = useCallback((value: string): string | null => {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) return "Email is required.";
    // Basic sanity check, not trying to be perfect
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmed)) return "Please enter a valid email address.";
    return null;
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    setMessage("");
    const trimmed = email.trim().toLowerCase();
    const validationError = validateEmail(trimmed);
    if (validationError) {
      setStatus("error");
      setMessage(validationError);
      return;
    }

    setStatus("loading");

    try {
      const res = await fetch("/api/support/resend-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data?.ok) {
        setStatus("error");
        setMessage(
          data?.error ??
            "We couldn’t find a purchase under that email. Make sure you’re using the same email you used at checkout.",
        );
        return;
      }

      // Success
      setStatus("success");
      setMessage(
        "If we found a matching purchase, we’ve sent a fresh setup link to that email. Check your inbox (and spam folder) in the next couple of minutes.",
      );

      setLastSentTo(trimmed);
      const now = new Date();
      setLastSentAt(now);

      if (typeof window !== "undefined") {
        window.localStorage.setItem("resend-setup:last-email", trimmed);
        window.localStorage.setItem(
          "resend-setup:last-sent-at",
          now.toISOString(),
        );
      }
    } catch (err) {
      console.error("resend-setup client error:", err);
      setStatus("error");
      setMessage("Something went wrong on our side. Please try again shortly.");
    }
  }

  // Restore last “sent” info from localStorage on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    const lastEmail = window.localStorage.getItem("resend-setup:last-email");
    const lastSentIso = window.localStorage.getItem(
      "resend-setup:last-sent-at",
    );

    if (lastEmail) setLastSentTo(lastEmail);
    if (lastSentIso) {
      const parsed = new Date(lastSentIso);
      if (!Number.isNaN(parsed.getTime())) setLastSentAt(parsed);
    }
  }, []);

  const isLoading = status === "loading";

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 max-w-md rounded-lg border border-zinc-200 bg-white/80 p-5 shadow-sm"
    >
      <div>
        <label
          htmlFor="resend-email"
          className="block text-sm font-medium text-zinc-800 mb-1"
        >
          Email used at checkout
        </label>
        <input
          id="resend-email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full h-10 rounded-md border border-zinc-300 px-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500/60"
        />
        <p className="mt-1 text-xs text-zinc-500">
          Use the same email you used when purchasing{" "}
          <span className="font-medium">Aroha Calls / Aroha Bookings</span> on
          Shopify.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isLoading}
          className="inline-flex items-center justify-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isLoading ? "Sending…" : "Resend my setup link"}
        </button>

        {lastSentTo && (
          <p className="text-[11px] text-zinc-500">
            Last sent to{" "}
            <span className="font-medium text-zinc-700">{lastSentTo}</span>
            {lastSentAt && (
              <>
                {" "}
                at{" "}
                {lastSentAt.toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </>
            )}
            .
          </p>
        )}
      </div>

      {status !== "idle" && message && (
        <div
          className={`rounded-md border px-3 py-2 text-xs ${
            status === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {message}
        </div>
      )}

      <p className="text-[11px] text-zinc-500">
        If you still don’t see a setup email after a few minutes, reach out to{" "}
        <a
          href="mailto:support@arohacalls.com"
          className="underline text-indigo-600"
        >
          support@arohacalls.com
        </a>
        , and we can manually link your account.
      </p>
    </form>
  );
}