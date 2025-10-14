"use client";
import { useState } from "react";

export default function RegisterPage() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setMessage("");
    const form = new FormData(e.currentTarget);
    const email = form.get("email");
    const password = form.get("password");
    const token = new URLSearchParams(window.location.search).get("token");

    // Later you'll hit your API route to verify Shopify token + create user
    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, token }),
    });

    const data = await res.json();
    if (data.ok) {
      setMessage("Account created! You can log in now.");
    } else {
      setMessage(data.error || "Registration failed.");
    }
    setLoading(false);
  }

  return (
    <main className="max-w-sm mx-auto mt-20">
      <h1 className="text-2xl font-bold mb-4 text-center">Create Account</h1>
      <form onSubmit={handleSubmit} className="grid gap-4">
        <input name="email" type="email" placeholder="Email" className="border p-2 rounded" required />
        <input name="password" type="password" placeholder="Password" className="border p-2 rounded" required />
        <button disabled={loading} className="bg-black text-white p-2 rounded">
          {loading ? "Creating..." : "Register"}
        </button>
      </form>
      {message && <p className="text-center mt-2 text-sm">{message}</p>}
    </main>
  );
}
