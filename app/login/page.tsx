// app/login/page.tsx
"use client";

import { signIn } from "next-auth/react";
import { useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const sp = useSearchParams();

  // If NextAuth sent back an error in the URL (?error=CredentialsSignin, etc)
  const urlError = sp.get("error");

  // we only allow internal callbackUrls like "/dashboard" (no full URLs)
  const rawCb = sp.get("callbackUrl") || "/dashboard";
  const callbackUrl = useMemo(() => {
    try {
      // treat absolute URLs as unsafe; keep internal paths only
      if (rawCb.startsWith("http://") || rawCb.startsWith("https://")) return "/dashboard";
      // ensure it starts with a slash
      return rawCb.startsWith("/") ? rawCb : "/dashboard";
    } catch {
      return "/dashboard";
    }
  }, [rawCb]);

  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(urlError ? "Please sign in again." : null);

  const onSubmit = useCallback(async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (loading) return; // block double submits
    setLoading(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") || "").trim().toLowerCase();
    const password = String(form.get("password") || "");

    if (!email || !password) {
      setError("Please enter your email and password.");
      setLoading(false);
      return;
    }

    // Use redirect: false so we can sanitize & route ourselves
    const res = await signIn("credentials", {
      email,
      password,
      redirect: false,
      callbackUrl, // still passed for consistency (NextAuth may use it)
    });

    if (!res) {
      setError("Unexpected error. Please try again.");
      setLoading(false);
      return;
    }

    if (res.error) {
      setError("Invalid email or password.");
      setLoading(false);
      return;
    }

    // Success — push to safe internal callback
    router.replace(callbackUrl);
    // no need to setLoading(false); we’re navigating
  }, [callbackUrl, loading, router]);

  return (
    <main className="min-h-[70vh] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold text-center">Sign in</h1>
        <p className="mt-2 text-center text-sm text-zinc-600">
          Welcome back — please enter your details.
        </p>

        <form onSubmit={onSubmit} className="mt-6 grid gap-4" autoComplete="on">
          <div>
            <label className="block text-sm font-medium mb-1">Email</label>
            <input
              name="email"
              type="email"
              inputMode="email"
              autoCapitalize="none"
              autoComplete="email"
              placeholder="you@example.com"
              className="w-full border rounded-lg p-2.5 focus:outline-none focus:ring-2 focus:ring-zinc-300"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Password</label>
            <div className="flex items-stretch">
              <input
                name="password"
                type={showPw ? "text" : "password"}
                autoComplete="current-password"
                placeholder="••••••••"
                className="w-full border rounded-l-lg p-2.5 focus:outline-none focus:ring-2 focus:ring-zinc-300"
                required
              />
              <button
                type="button"
                onClick={() => setShowPw((s) => !s)}
                className="px-3 text-sm border border-l-0 rounded-r-lg hover:bg-zinc-50"
                aria-pressed={showPw}
                aria-label={showPw ? "Hide password" : "Show password"}
              >
                {showPw ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          <button
            disabled={loading}
            className="mt-2 w-full rounded-lg bg-black py-2.5 text-white hover:bg-zinc-800 disabled:opacity-60"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>

          {error && (
            <p className="text-sm text-red-600 text-center">{error}</p>
          )}
        </form>

        <div className="mt-4 text-center text-sm">
          <a href="/register" className="text-blue-600 underline">
            Don’t have an account? Register
          </a>
        </div>

        {/* Small print / tip */}
        <p className="mt-4 text-center text-xs text-zinc-500">
          By continuing, you agree to the Terms and acknowledge the Privacy Policy.
        </p>
      </div>
    </main>
  );
}
