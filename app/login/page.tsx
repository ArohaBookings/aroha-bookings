// app/login/page.tsx
"use client";

import { useState, useCallback, Suspense, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { signIn } from "next-auth/react";

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[50vh] grid place-items-center">
          Loading…
        </div>
      }
    >
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const router = useRouter();
  const sp = useSearchParams();

  // Map NextAuth errors to friendly messages
  const urlError = sp.get("error");
  const [error, setError] = useState<string | null>(
    urlError ? mapNextAuthError(urlError) : null
  );

  // Prevent malicious redirects
  const callbackUrlRaw = sp.get("callbackUrl") || "/dashboard";
  const callbackUrl = useMemo(() => {
    if (!callbackUrlRaw) return "/dashboard";
    if (callbackUrlRaw.startsWith("http")) return "/dashboard";
    return callbackUrlRaw.startsWith("/") ? callbackUrlRaw : "/dashboard";
  }, [callbackUrlRaw]);

  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(true);

  const onSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (loading) return;

      setError(null);
      setLoading(true);

      const fd = new FormData(e.currentTarget);
      const email = String(fd.get("email") || "").trim().toLowerCase();
      const password = String(fd.get("password") || "");

      if (!email || !password) {
        setError("Please enter your email and password.");
        setLoading(false);
        return;
      }

      const res = await signIn("credentials", {
        email,
        password,
        redirect: false,
        callbackUrl,
      });

      if (!res) {
        setError("Unexpected error. Please try again.");
        setLoading(false);
        return;
      }

      if (res.error) {
        setError(mapNextAuthError(res.error));
        setLoading(false);
        return;
      }

      router.replace(callbackUrl);
      router.refresh();
    },
    [loading, callbackUrl, router]
  );

  return (
    <main className="w-full max-w-sm mx-auto pt-10">
      <h1 className="text-2xl font-bold text-center">Welcome back</h1>
      <p className="mt-2 text-center text-sm text-zinc-600">
        Sign in to continue
      </p>

      <form
        onSubmit={onSubmit}
        className="mt-6 grid gap-4"
        autoComplete="on"
        noValidate
      >
        {/* Email */}
        <div>
          <label htmlFor="email" className="block text-sm font-medium mb-1">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            autoCapitalize="none"
            inputMode="email"
            className="w-full border rounded-lg p-2.5 focus:ring-2 focus:ring-zinc-300"
            placeholder="you@example.com"
            required
            disabled={loading}
          />
        </div>

        {/* Password */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label htmlFor="password" className="text-sm font-medium">
              Password
            </label>
            <a
              href="/forgot-password"
              className="text-xs text-blue-600 hover:underline"
            >
              Forgot?
            </a>
          </div>

          <div className="flex items-stretch">
            <input
              id="password"
              name="password"
              type={showPw ? "text" : "password"}
              autoComplete="current-password"
              placeholder="••••••••"
              className="w-full border rounded-l-lg p-2.5 focus:ring-2 focus:ring-zinc-300"
              required
              disabled={loading}
            />
            <button
              type="button"
              onClick={() => setShowPw((s) => !s)}
              className="px-3 text-sm border border-l-0 rounded-r-lg hover:bg-zinc-50"
              aria-label={showPw ? "Hide password" : "Show password"}
              disabled={loading}
            >
              {showPw ? "Hide" : "Show"}
            </button>
          </div>
        </div>

        {/* Remember me */}
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            disabled={loading}
          />
          Keep me signed in
        </label>

        {/* Submit */}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-black py-2.5 text-white hover:bg-zinc-800 disabled:opacity-60"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>

        {/* Errors */}
        {error && (
          <p role="alert" className="text-sm text-red-600 text-center">
            {error}
          </p>
        )}
      </form>

      <div className="mt-4 text-center text-sm">
        <a href="/register" className="text-blue-600 underline">
          Don’t have an account? Register
        </a>
      </div>

      <p className="mt-4 text-center text-xs text-zinc-500">
        By signing in, you agree to our Terms and Privacy Policy.
      </p>
    </main>
  );
}

function mapNextAuthError(code: string): string {
  const c = (code || "").toLowerCase();
  if (c.includes("credentialssignin")) return "Invalid email or password.";
  if (c.includes("accessdenied")) return "Access denied.";
  if (c.includes("configuration")) return "Auth configuration error.";
  return "Something went wrong. Please try again.";
}
