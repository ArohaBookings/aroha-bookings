// app/forgot-password/page.tsx
"use client";

import { FormEvent, Suspense, useCallback, useState } from "react";

export default function ForgotPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[50vh] grid place-items-center">
          Loading…
        </div>
      }
    >
      <ForgotInner />
    </Suspense>
  );
}

function ForgotInner() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (submitting) return;

      const trimmed = email.trim().toLowerCase();
      if (!trimmed) {
        setError("Please enter your email.");
        return;
      }

      setSubmitting(true);
      setError(null);

      try {
        const res = await fetch("/api/auth/forgot-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: trimmed }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error || "Something went wrong.");
        }

        // Always show same success message (no user enumeration)
        setDone(true);
      } catch (err: any) {
        setError(err.message || "Something went wrong. Please try again.");
      } finally {
        setSubmitting(false);
      }
    },
    [email, submitting]
  );

  return (
    <main className="w-full max-w-sm mx-auto pt-10">
      <h1 className="text-2xl font-bold text-center">Reset your password</h1>
      <p className="mt-2 text-center text-sm text-zinc-600">
        Enter the email you use to sign in. If an account exists, we’ll send a reset link.
      </p>

      {done ? (
        <div className="mt-6 rounded-md bg-emerald-50 border border-emerald-200 p-4 text-sm text-emerald-900">
          If an account exists for <span className="font-medium">{email}</span>, a reset link has
          been sent. Check your inbox (and spam).
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-6 grid gap-4" noValidate>
          <div>
            <label htmlFor="email" className="block text-sm font-medium mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              className="w-full border rounded-lg p-2.5 focus:ring-2 focus:ring-zinc-300"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
              required
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-black py-2.5 text-white hover:bg-zinc-800 disabled:opacity-60"
          >
            {submitting ? "Sending link…" : "Send reset link"}
          </button>

          {error && (
            <p role="alert" className="text-sm text-red-600 text-center">
              {error}
            </p>
          )}
        </form>
      )}

      <div className="mt-4 text-center text-sm">
        <a href="/login" className="text-blue-600 underline">
          Back to login
        </a>
      </div>
    </main>
  );
}
