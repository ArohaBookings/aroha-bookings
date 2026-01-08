// app/register/page.tsx
import React from "react";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import { prisma } from "@/lib/db";
import { authOptions } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SearchParams = { token?: string };

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;

  // Normalise token from URL
  const rawToken = (params?.token ?? "").trim();
  const token: string | null = rawToken.length > 0 ? rawToken : null;

  // Superadmin detection (for preview mode)
  const session = await getServerSession(authOptions);
  const isSuperAdmin = Boolean((session as any)?.isSuperAdmin);

  /* ───────────────────────────────────────────────
     1) No token + not superadmin → blocked
     ─────────────────────────────────────────────── */
  if (!token && !isSuperAdmin) {
    redirect("/unauthorized");
  }

  /* ───────────────────────────────────────────────
     2) Superadmin, no token → helper screen
     ─────────────────────────────────────────────── */
  if (!token && isSuperAdmin) {
    return (
      <div className="p-8 max-w-lg mx-auto space-y-4">
        <header>
          <h1 className="text-2xl font-semibold mb-2">Registration (Admin)</h1>
          <p className="text-sm text-zinc-600">
            You’re signed in as <b>superadmin</b>. To preview or debug a
            customer’s setup form, load this page with their checkout token in
            the query string.
          </p>
        </header>

        <section className="rounded-md bg-zinc-50 border border-zinc-200 p-4 text-xs text-zinc-700 space-y-2">
          <p className="font-medium">Example URL:</p>
          <pre className="rounded bg-white border border-zinc-200 p-3 overflow-x-auto">
{`/register?token=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`}
          </pre>
          <p>
            Tokens are created by the Shopify webhook after purchase and
            normally expire after 7 days.
          </p>
        </section>

        <section className="rounded-md bg-white border border-zinc-200 p-4 text-xs text-zinc-600 space-y-1">
          <p className="font-medium text-zinc-800">Tips:</p>
          <ul className="list-disc list-inside space-y-1">
            <li>
              Use the most recent <code>CheckoutToken</code> row for that email.
            </li>
            <li>
              Ensure <code>status = "NEW"</code> and{" "}
              <code>expiresAt &gt; now()</code>.
            </li>
          </ul>
        </section>
      </div>
    );
  }

  /* ───────────────────────────────────────────────
     3) From here we KNOW we have a token string
     ─────────────────────────────────────────────── */
  const tokenStr: string = token as string;

  const record = await prisma.checkoutToken.findUnique({
    where: { token: tokenStr },
  });

  const usedAt =
    (record as any)?.usedAt ??
    (record as any)?.consumedAt ??
    (record as any)?.redeemedAt ??
    null;

  const isExpired =
    !!record?.expiresAt && record.expiresAt.getTime() < Date.now();

  const tokenStatusLabel = (() => {
    if (!record) return "Not found";
    if (usedAt) return "USED";
    if (isExpired) return "EXPIRED";
    return (record as any)?.status ?? "NEW";
  })();

  /* ───────────────────────────────────────────────
     4) Invalid / used / expired token → explain
     ─────────────────────────────────────────────── */
  if (!record || usedAt || isExpired) {
    return (
      <div className="p-8 max-w-lg mx-auto space-y-6">
        <header className="text-center">
          <h1 className="text-2xl font-semibold mb-2">
            Invalid or expired link
          </h1>
          <p className="text-zinc-600 text-sm">
            This registration link is no longer valid.
            {isSuperAdmin ? (
              <>
                {" "}
                As superadmin you can issue a new token or resend the setup
                email.
              </>
            ) : (
              <> Please contact support so we can send you a fresh link.</>
            )}
          </p>
        </header>

        {record && (
          <section className="rounded-md border border-zinc-200 bg-zinc-50 p-4 text-xs text-zinc-700 space-y-1">
            <p className="font-medium text-zinc-800">Token details</p>
            <div>
              <span className="font-semibold">Email:</span> {record.email}
            </div>
            <div>
              <span className="font-semibold">Plan:</span>{" "}
              {(record as any)?.plan ?? "—"}
            </div>
            <div>
              <span className="font-semibold">Expires:</span>{" "}
              {record.expiresAt instanceof Date
                ? record.expiresAt.toISOString()
                : "—"}
            </div>
            <div>
              <span className="font-semibold">Status:</span>{" "}
              {tokenStatusLabel}
            </div>
          </section>
        )}

        {!record && (
          <section className="rounded-md border border-red-200 bg-red-50 p-4 text-xs text-red-800">
            We couldn&apos;t find any checkout token matching the link you
            opened. Double-check that you&apos;re using the latest email from
            Aroha Bookings.
          </section>
        )}

        <footer className="text-center text-xs text-zinc-500">
          Need help? Email{" "}
          <a
            className="underline"
            href="mailto:support@arohacalls.com?subject=Aroha%20Bookings%20setup%20link"
          >
            support@arohacalls.com
          </a>
          .
        </footer>
      </div>
    );
  }

  /* ───────────────────────────────────────────────
     5) Happy path – valid token, not used, not expired
     ─────────────────────────────────────────────── */

  const email = record.email.toLowerCase();
  const businessNameDefault =
    (record as any)?.orgName || email.split("@")[0] || "";

  const createdAtLabel =
    record.createdAt instanceof Date
      ? record.createdAt.toLocaleString()
      : "—";

  const expiresLabel =
    record.expiresAt instanceof Date
      ? record.expiresAt.toLocaleString()
      : "—";

  return (
    <div className="p-8 max-w-md mx-auto space-y-6">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
          Aroha Bookings · Account Setup
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          Complete your setup
        </h1>
        <p className="text-zinc-600 text-sm">
          You&apos;re finishing setup for{" "}
          <span className="font-semibold">{email}</span>
          {record.orgName ? (
            <>
              {" "}
              (business: <span className="font-semibold">{record.orgName}</span>)
            </>
          ) : null}
          .
        </p>
        <p className="text-[11px] text-zinc-500">
          This link was created on {createdAtLabel} and is valid until{" "}
          {expiresLabel}.
        </p>
      </header>

      <section className="rounded-md border border-zinc-200 bg-white shadow-sm p-6 space-y-4">
        <form
          action="/register/complete"
          method="POST"
          className="space-y-4"
        >
          {/* Hidden token field (always a string) */}
          <input type="hidden" name="token" value={tokenStr} />

          <div>
            <label className="block text-sm font-medium mb-1">
              Business name
            </label>
            <input
              type="text"
              name="orgName"
              defaultValue={businessNameDefault}
              className="w-full border rounded-md p-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500"
              required
            />
            <p className="mt-1 text-[11px] text-zinc-500">
              This will appear on your booking page and in confirmation
              messages. You can change it later in Settings.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Password
            </label>
            <input
              type="password"
              name="password"
              className="w-full border rounded-md p-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500"
              minLength={6}
              required
            />
            <p className="mt-1 text-[11px] text-zinc-500">
              You&apos;ll use this password when you log into Aroha Bookings
              with <span className="font-medium">{email}</span>.
            </p>
          </div>

          <div className="rounded-md bg-zinc-50 border border-zinc-200 px-3 py-3 text-[11px] text-zinc-600 space-y-1">
            <p className="font-medium text-zinc-700">What happens next?</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li>We link this email to your new workspace.</li>
              <li>
                You&apos;ll be able to sign in and access your calendar, staff
                and services.
              </li>
              <li>
                You can connect Google Calendar and customize everything in
                Settings.
              </li>
            </ul>
          </div>

          <button
            type="submit"
            className="w-full bg-indigo-600 text-white py-2 rounded-md text-sm font-medium hover:bg-indigo-700"
          >
            Create my account
          </button>
        </form>
      </section>

      <footer className="text-xs text-zinc-500 text-center">
        Having trouble? Contact{" "}
        <a className="underline" href="mailto:support@arohacalls.com">
          support@arohacalls.com
        </a>
        .
      </footer>
    </div>
  );
}
