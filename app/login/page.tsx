// app/login/page.tsx
"use client";

import { Suspense, useCallback, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { signIn } from "next-auth/react";

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-[70vh] grid place-items-center">Loading…</div>}>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const router = useRouter();
  const sp = useSearchParams();

  const urlError = sp.get("error");
  const rawCb = sp.get("callbackUrl") || "/dashboard";

  // Sanitize callback to same-origin internal paths only
  const callbackUrl = useMemo(() => {
    try {
      if (!rawCb) return "/dashboard";
      // disallow absolute urls to avoid open redirects
      if (rawCb.startsWith("http://") || rawCb.startsWith("https://")) return "/dashboard";
      // allow only site-internal paths
      return rawCb.startsWith("/") ? rawCb : "/dashboard";
    } catch {
      return "/dashboard";
    }
  }, [rawCb]);

  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(
    urlError ? mapNextAuthError(urlError) : null
  );

  const onSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (loading) return;

      setLoading(true);
      setError(null);

      const fd = new FormData(e.currentTarget);
      const email = String(fd.get("email") || "").trim().toLowerCase();
      const password = String(fd.get("password") || "");

      if (!email || !password) {
        setError("Please enter your email and password.");
        setLoading(false);
        return;
      }

      // NextAuth credential sign-in without auto-redirect
      const res = await signIn("credentials", {
        email,
        password,
        redirect: false,
        callbackUrl, // we’ll navigate safely ourselves
      });

      if (!res) {
        setError("Unexpected error. Please try again.");
        setLoading(false);
        return;
      }

      if (res.error) {
        // Map common NextAuth error codes to friendly copy
        setError(mapNextAuthError(res.error));
        setLoading(false);
        return;
      }

      // Success: navigate and force a refresh so server components (Header) see the new session
      router.replace(callbackUrl);
      router.refresh();
    },
    [callbackUrl, loading, router]
  );

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
              disabled={loading}
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
                disabled={loading}
              />
              <button
                type="button"
                onClick={() => setShowPw((s) => !s)}
                className="px-3 text-sm border border-l-0 rounded-r-lg hover:bg-zinc-50"
                aria-pressed={showPw}
                aria-label={showPw ? "Hide password" : "Show password"}
                disabled={loading}
              >
                {showPw ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="mt-2 w-full rounded-lg bg-black py-2.5 text-white hover:bg-zinc-800 disabled:opacity-60"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>

          {error && <p className="text-sm text-red-600 text-center">{error}</p>}
        </form>

        <div className="mt-4 text-center text-sm">
          <a href="/register" className="text-blue-600 underline">
            Don’t have an account? Register
          </a>
        </div>

        <p className="mt-4 text-center text-xs text-zinc-500">
          By continuing, you agree to the Terms and acknowledge the Privacy Policy.
        </p>
      </div>
    </main>
  );
}

/** Map NextAuth error codes to user-friendly copy */
function mapNextAuthError(code: string): string {
  const c = (code || "").toLowerCase();
  if (c.includes("credentialssignin")) return "Invalid email or password.";
  if (c.includes("accessdenied")) return "Access denied.";
  if (c.includes("configuration")) return "Auth configuration error. Please try again.";
  return "Something went wrong. Please try again.";
}
