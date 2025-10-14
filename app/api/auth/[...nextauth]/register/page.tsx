"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";

export default function RegisterPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = useMemo(() => searchParams.get("token") ?? "", [searchParams]);

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // If no token in URL, don’t show the form
  if (!token) {
    return (
      <main className="max-w-md mx-auto mt-20">
        <h1 className="text-2xl font-bold mb-3 text-center">Registration locked</h1>
        <p className="text-sm text-zinc-600 text-center">
          A purchase is required before you can create an account.
          Use the link sent after checkout or{" "}
          <a className="underline text-indigo-600" href="/#pricing">buy Aroha Calls</a> to get a registration link.
        </p>
      </main>
    );
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    setLoading(true);

    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") || "").trim();
    const password = String(form.get("password") || "");

    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, token }),
      });

      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setMsg({ type: "err", text: data?.error ?? "Registration failed." });
      } else {
        setMsg({ type: "ok", text: "Account created! Redirecting to sign in…" });
        // small pause then go to sign-in
        setTimeout(() => router.push("/api/auth/signin"), 900);
      }
    } catch (err) {
      setMsg({ type: "err", text: "Network error. Please try again." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="max-w-sm mx-auto mt-20">
      <h1 className="text-2xl font-bold mb-2 text-center">Create your account</h1>
      <p className="text-xs text-zinc-600 text-center mb-4">
        Token verified on submit. Use the same email you purchased with.
      </p>

      <form onSubmit={handleSubmit} className="grid gap-3">
        <input
          name="email"
          type="email"
          placeholder="Email used at checkout"
          className="border p-2 rounded"
          required
        />
        <input
          name="password"
          type="password"
          placeholder="Password"
          className="border p-2 rounded"
          minLength={8}
          required
        />

        {/* keep token out of the DOM inputs; it's taken from the URL, not user input */}

        <button
          disabled={loading}
          className="bg-black text-white p-2 rounded disabled:opacity-60"
        >
          {loading ? "Creating…" : "Register"}
        </button>
      </form>

      {msg && (
        <p
          className={`text-center mt-3 text-sm ${
            msg.type === "ok" ? "text-emerald-600" : "text-red-600"
          }`}
        >
          {msg.text}
        </p>
      )}
    </main>
  );
}
