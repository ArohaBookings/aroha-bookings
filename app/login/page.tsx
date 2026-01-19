// app/login/page.tsx
"use client";

import { useState, useCallback, Suspense, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import BrandLogo from "@/components/BrandLogo";

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
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#e7f4f1_0%,_#f8f9fb_40%,_#ffffff_100%)] px-4 py-12">
      <div className="mx-auto w-full max-w-6xl">
        <div className="grid items-stretch gap-8 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="relative overflow-hidden rounded-3xl border border-emerald-100 bg-white/70 p-8 shadow-[0_20px_60px_-40px_rgba(16,185,129,0.45)] backdrop-blur">
            <div className="absolute -right-24 -top-24 h-48 w-48 rounded-full bg-emerald-200/40 blur-3xl" />
            <BrandLogo mode="full" showWordmark={false} showWordmarkText={false} size={56} />
            <p className="mt-6 text-xs font-semibold uppercase tracking-[0.3em] text-emerald-700">
              Always-on AI receptionist
            </p>
            <h1
              className="mt-3 text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl"
              style={{ fontFamily: '"DM Serif Display", "Georgia", serif' }}
            >
              Walk into every morning with bookings already confirmed.
            </h1>
            <p className="mt-4 text-base text-zinc-600">
              Aroha answers the phone, books the right slot, and keeps your calendar clean so you can focus on clients.
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {[
                { title: "Calls inbox", body: "Every call summarized, searchable, and safe from duplicates." },
                { title: "Client memory", body: "Preferred days, tone, and notes saved per customer." },
                { title: "Email AI", body: "Drafts follow-ups and rescues missed calls automatically." },
                { title: "Zapier-ready", body: "Forward call events into any workflow in seconds." },
              ].map((item) => (
                <div key={item.title} className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm">
                  <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">{item.title}</div>
                  <div className="mt-2 text-sm text-zinc-700">{item.body}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-zinc-200 bg-white p-8 shadow-lg">
            <div className="flex flex-col items-center text-center">
              <BrandLogo mode="full" showWordmark={false} showWordmarkText={false} size={52} />
              <h2 className="mt-4 text-2xl font-semibold text-zinc-900">Welcome back</h2>
              <p className="mt-2 text-sm text-zinc-600">Sign in to continue to your workspace.</p>
            </div>

            <form
              onSubmit={onSubmit}
              className="mt-6 space-y-4"
              autoComplete="on"
              noValidate
            >
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-zinc-700">
                  Email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  inputMode="email"
                  className="mt-2 w-full rounded-xl border border-zinc-200 p-3 text-sm focus:border-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                  placeholder="you@example.com"
                  required
                  disabled={loading}
                />
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label htmlFor="password" className="text-sm font-medium text-zinc-700">
                    Password
                  </label>
                  <a
                    href="/forgot-password"
                    className="text-xs text-zinc-600 hover:text-zinc-900"
                  >
                    Forgot?
                  </a>
                </div>

                <div className="mt-2 flex items-stretch">
                  <input
                    id="password"
                    name="password"
                    type={showPw ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    className="w-full rounded-l-xl border border-zinc-200 p-3 text-sm focus:border-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                    required
                    disabled={loading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((s) => !s)}
                    className="rounded-r-xl border border-l-0 border-zinc-200 px-4 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                    aria-label={showPw ? "Hide password" : "Show password"}
                    disabled={loading}
                  >
                    {showPw ? "Hide" : "Show"}
                  </button>
                </div>
              </div>

              <label className="inline-flex items-center gap-2 text-sm text-zinc-600">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  disabled={loading}
                />
                Keep me signed in
              </label>

              <button
                type="submit"
                disabled={loading}
                className="mt-2 w-full rounded-xl bg-zinc-900 py-3 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60"
              >
                {loading ? "Signing in…" : "Sign in"}
              </button>

              {error && (
                <p role="alert" className="text-sm text-rose-600 text-center">
                  {error}
                </p>
              )}
            </form>

            <div className="mt-5 text-center text-sm">
              <a href="/register" className="text-zinc-700 underline hover:text-zinc-900">
                Don’t have an account? Register
              </a>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-4 text-xs text-zinc-500">
              <a href="/terms" className="hover:text-zinc-800">Terms</a>
              <a href="/privacy" className="hover:text-zinc-800">Privacy</a>
              <a
                href="https://instagram.com/aroha_calls"
                target="_blank"
                rel="noreferrer"
                className="hover:text-zinc-800"
              >
                Instagram
              </a>
            </div>
          </section>
        </div>
      </div>
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
