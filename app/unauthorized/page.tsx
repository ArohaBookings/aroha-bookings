// app/unauthorized/page.tsx
"use client";

import React, { useState } from "react";

type Status = "idle" | "loading" | "success" | "error";

export default function UnauthorizedPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleCheckAccess(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);

    const trimmed = email.trim();
    if (!trimmed) {
      setErrorMsg("Enter the email you used at checkout first.");
      setStatus("error");
      return;
    }

    try {
      setStatus("loading");

      const res = await fetch(
        `/api/auth/verify-access?email=${encodeURIComponent(trimmed)}`,
        {
          method: "GET",
          redirect: "follow",
        },
      );

      // If the API route issues a redirect (to /onboarding, /login, etc),
      // the browser will see it here.
      if (res.redirected) {
        window.location.href = res.url;
        return;
      }

      // If it reaches here with 2xx, treat as "ok but no redirect" (rare).
      if (res.ok) {
        setStatus("success");
        setErrorMsg(
          "If your purchase is valid, your account will be linked shortly. If nothing happens, contact support.",
        );
      } else {
        const text = await res.text().catch(() => "");
        setStatus("error");
        setErrorMsg(
          text?.trim() ||
            "We couldn’t verify that email. Make sure it’s the same one you used on Shopify.",
        );
      }
    } catch (err) {
      console.error("verify-access client error:", err);
      setStatus("error");
      setErrorMsg(
        "Something went wrong talking to the server. Try again in a moment or email support.",
      );
    }
  }

  const isLoading = status === "loading";

  return (
    <div className="p-10 max-w-3xl mx-auto text-zinc-800">
      <h1 className="text-3xl font-bold tracking-tight mb-3">
        We Can’t Verify Your Access Yet
      </h1>

      <p className="text-zinc-600 text-sm leading-relaxed mb-6">
        No panic — this usually means one of a few simple things. First we’ll
        double-check your **purchase email** and auto-link your account if we
        can.
      </p>

      {/* STEP 1: Email verification + auto-onboard */}
      <section className="mb-10 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-zinc-900 mb-1">
          1. Check the email you used at checkout
        </h2>
        <p className="text-sm text-zinc-600 mb-4">
          Enter the email you used when buying Aroha Calls / Aroha Bookings on
          Shopify. If we find a valid purchase for that email, we’ll:
        </p>
        <ul className="list-disc pl-5 text-sm text-zinc-600 mb-4 space-y-1">
          <li>Link your account to your organisation</li>
          <li>Auto-create your workspace if needed</li>
          <li>Send you straight to the onboarding screen</li>
        </ul>

        <form
          onSubmit={handleCheckAccess}
          className="flex flex-col gap-3 sm:flex-row sm:items-center"
        >
          <input
            type="email"
            required
            placeholder="youremail@example.com"
            className="flex-1 h-10 rounded-md border border-zinc-300 px-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500/40"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading}
            className="h-10 rounded-md bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isLoading ? "Checking…" : "Verify Access"}
          </button>
        </form>

        {status === "success" && (
          <p className="mt-3 text-xs text-emerald-600">
            If we detect a valid purchase, you’ll be redirected automatically.
            Keep this tab open for a few seconds.
          </p>
        )}

        {status === "error" && errorMsg && (
          <p className="mt-3 text-xs text-rose-600">{errorMsg}</p>
        )}

        <p className="mt-4 text-xs text-zinc-500">
          Tip: if you used Apple Pay / Google Pay, sometimes the email on the
          order is different to your normal one — check your Shopify receipt.
        </p>
      </section>

      {/* STEP 2+: Explain common causes */}
      <div className="space-y-4 mb-10">
        {/* Wrong email */}
        <div className="p-4 border border-zinc-200 bg-white rounded-lg shadow-sm">
          <h2 className="font-semibold text-zinc-900">
            2. You might be signed in with the wrong email
          </h2>
          <p className="text-sm text-zinc-600 mt-1">
            Your app access is tied to the email on the Shopify order. If
            you&apos;re logged in with a different email, we can&apos;t match
            your purchase.
          </p>
          <a
            href="/api/auth/signin"
            className="inline-block mt-3 text-indigo-600 underline font-medium"
          >
            Sign in with a different email →
          </a>
        </div>

        {/* Delay from Shopify */}
        <div className="p-4 border border-zinc-200 bg-white rounded-lg shadow-sm">
          <h2 className="font-semibold text-zinc-900">
            3. Shopify hasn’t finished talking to us yet
          </h2>
          <p className="text-sm text-zinc-600 mt-1">
            Occasionally Shopify is a bit slow sending us the &quot;this order
            is paid&quot; webhook. If you just bought Aroha Calls / Bookings in
            the last couple of minutes, it may not have reached us yet.
          </p>
          <p className="text-sm text-zinc-600 mt-2">
            Wait 1–2 minutes and then either hit **Verify Access** again above
            or refresh the page.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-3 text-sm px-4 py-1.5 rounded-md bg-zinc-100 hover:bg-zinc-200 border border-zinc-300"
          >
            Refresh page
          </button>
        </div>

        {/* Setup link not completed */}
        <div className="p-4 border border-zinc-200 bg-white rounded-lg shadow-sm">
          <h2 className="font-semibold text-zinc-900">
            4. You haven’t completed your setup link
          </h2>
          <p className="text-sm text-zinc-600 mt-1">
            After you buy, we send a setup email with the subject:
          </p>
          <p className="text-sm mt-2 italic text-zinc-500">
            “Complete your Aroha Bookings setup”
          </p>
          <p className="text-sm text-zinc-600 mt-2">
            Check your inbox and spam/junk for that email and follow the link
            inside. If you can&apos;t find it, you can request a new one.
          </p>
          <a
            href="/support/resend-setup"
            className="inline-block mt-3 text-indigo-600 underline font-medium"
          >
            Resend my setup link →
          </a>
        </div>

        {/* Not a customer yet */}
        <div className="p-4 border border-zinc-200 bg-white rounded-lg shadow-sm">
          <h2 className="font-semibold text-zinc-900">
            5. Trying to log in before you’ve bought?
          </h2>
          <p className="text-sm text-zinc-600 mt-1">
            Access to Aroha Bookings is for active customers only. If you
            haven&apos;t purchased yet, start with the Shopify product page
            below.
          </p>
          <a
            href="https://arohacalls.com/products/aroha-bookings"
            className="inline-block mt-3 text-indigo-600 underline font-medium"
          >
            Go to Shopify product →
          </a>
        </div>
      </div>

      {/* Footer help */}
      <div className="border-t border-zinc-200 pt-6">
        <h2 className="font-semibold text-zinc-800 text-lg mb-2">Still stuck?</h2>
        <p className="text-sm text-zinc-600 mb-4">
          If none of this works, send us the email you purchased with and (if
          you have it) your Shopify order number. We can manually link your
          account from our side.
        </p>

        <a
          href="mailto:support@arohacalls.com"
          className="text-indigo-600 font-medium underline"
        >
          Email support@arohacalls.com
        </a>
      </div>
    </div>
  );
}

