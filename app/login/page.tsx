// app/login/page.tsx
"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const email = form.get("email") as string;
    const password = form.get("password") as string;

    const result = await signIn("credentials", {
      email,
      password,
      callbackUrl: "/dashboard",
      redirect: true, // let NextAuth handle navigation
    });

    // If signIn throws, result will be undefined. handle gracefully:
    if (result?.error) setError("Invalid email or password.");
    setLoading(false);
  }

  return (
    <main className="max-w-sm mx-auto mt-20 p-4">
      <h1 className="text-2xl font-bold mb-4 text-center">Sign In</h1>
      <form onSubmit={handleSubmit} className="grid gap-4">
        <input
          name="email"
          type="email"
          placeholder="Email"
          className="border p-2 rounded"
          required
        />
        <input
          name="password"
          type="password"
          placeholder="Password"
          className="border p-2 rounded"
          required
        />
        <button
          disabled={loading}
          className="bg-black text-white p-2 rounded disabled:opacity-60"
        >
          {loading ? "Signing in..." : "Sign In"}
        </button>
      </form>

      {error && (
        <p className="text-center mt-3 text-sm text-red-600">{error}</p>
      )}

      <div className="text-center mt-3">
        <a href="/register" className="text-blue-600 text-sm underline">
          Don’t have an account? Register
        </a>
      </div>
    </main>
  );
}
