// app/reset-password/page.tsx
"use client";

import { FormEvent, Suspense, useCallback, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[50vh] grid place-items-center">
          Loading…
        </div>
      }
    >
      <ResetInner />
    </Suspense>
  );
}

function ResetInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const token = sp.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (submitting) return;

      if (!token) {
        setError("Invalid or missing reset token.");
        return;
      }

      if (!password || password.length < 8) {
        setError("Password must be at least 8 characters.");
        return;
      }

      if (password !== confirm) {
        setError("Passwords do not match.");
        return;
      }

      setSubmitting(true);
      setError(null);

      try {
        const res = await fetch("/api/auth/reset-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, password }),
        });

        const data = await res.json().catch(() => null);

        if (!res.ok || !data?.ok) {
          throw new Error(data?.error || "Unable to reset password.");
        }

        setDone(true);
        // small delay then send them to login
        setTimeout(() => {
          router.replace("/login");
        }, 1500);
      } catch (err: any) {
        setError(err.message || "Something went wrong.");
      } finally {
        setSubmitting(false);
      }
    },
    [token, password, confirm, submitting, router]
  );

  if (!token) {
    return (
      <main className="w-full max-w-sm mx-auto pt-10">
        <h1 className="text-2xl font-bold text-center">Reset password</h1>
        <p className="mt-4 text-center text-sm text-red-600">
          This link is invalid. Please request a new reset email.
        </p>
        <div className="mt-4 text-center text-sm">
          <a href="/forgot-password" className="text-blue-600 underline">
            Request new link
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="w-full max-w-sm mx-auto pt-10">
      <h1 className="text-2xl font-bold text-center">Choose a new password</h1>
      <p className="mt-2 text-center text-sm text-zinc-600">
        Your new password will replace the old one for this account.
      </p>

      {done ? (
        <div className="mt-6 rounded-md bg-emerald-50 border border-emerald-200 p-4 text-sm text-emerald-900">
          Password updated. Redirecting you to login…
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-6 grid gap-4" noValidate>
          <div>
            <label htmlFor="password" className="block text-sm font-medium mb-1">
              New password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              className="w-full border rounded-lg p-2.5 focus:ring-2 focus:ring-zinc-300"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
              required
            />
            <p className="mt-1 text-xs text-zinc-500">
              At least 8 characters.
            </p>
          </div>

          <div>
            <label htmlFor="confirm" className="block text-sm font-medium mb-1">
              Confirm password
            </label>
            <input
              id="confirm"
              type="password"
              autoComplete="new-password"
              className="w-full border rounded-lg p-2.5 focus:ring-2 focus:ring-zinc-300"
              placeholder="••••••••"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={submitting}
              required
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-black py-2.5 text-white hover:bg-zinc-800 disabled:opacity-60"
          >
            {submitting ? "Updating…" : "Update password"}
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
