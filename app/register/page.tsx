// app/register/page.tsx
import React from "react";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export const runtime = "nodejs";

type SParams = { token?: string };

export default async function RegisterPage({
  searchParams,
}: {
  // Next 15: searchParams must be awaited
  searchParams: Promise<SParams>;
}) {
  const params = await searchParams;
  const token = params?.token ?? null;

  // Check session to see if this user is a superadmin
  const session = await getServerSession(authOptions);
  const isSuperAdmin = Boolean((session as any)?.isSuperAdmin);

  // Non-admins must have a token
  if (!token && !isSuperAdmin) {
    redirect("/unauthorized");
  }

  // Superadmin without token: show a small helper view (don’t try to create an account)
  if (!token && isSuperAdmin) {
    return (
      <div className="p-8 max-w-lg mx-auto">
        <h1 className="text-2xl font-semibold mb-2">Registration (Admin)</h1>
        <p className="text-sm text-zinc-600">
          You’re signed in as <b>superadmin</b>. To preview a customer’s setup
          form, open this page with their checkout token:
        </p>
        <pre className="mt-3 rounded bg-zinc-100 p-3 text-xs overflow-x-auto">
{`/register?token=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`}
        </pre>
        <p className="text-xs text-zinc-500 mt-3">
          Tokens are created by the Shopify webhook and expire after 7 days.
        </p>
      </div>
    );
  }

  // From here we have a token (admin or customer).
  const record = await prisma.checkoutToken.findUnique({
    where: { token: token! },
  });

  const usedAt =
    (record as any)?.usedAt ??
    (record as any)?.consumedAt ??
    (record as any)?.redeemedAt ??
    null;

  const isExpired =
    !!record?.expiresAt && record.expiresAt.getTime() < Date.now();

  if (!record || usedAt || isExpired) {
    return (
      <div className="p-8 max-w-lg mx-auto text-center">
        <h1 className="text-2xl font-semibold mb-2">Invalid or expired link</h1>
        <p className="text-zinc-600 text-sm">
          This registration link is no longer valid.
          {isSuperAdmin ? (
            <>
              {" "}
              As superadmin you can issue a new token or resend the setup email.
            </>
          ) : (
            <> Please contact support.</>
          )}
        </p>
        {record && (
          <div className="mt-4 text-xs text-zinc-500">
            <div>Email: {record.email}</div>
            <div>Plan: {(record as any)?.plan ?? "—"}</div>
            <div>Expires: {record.expiresAt?.toISOString?.() ?? "—"}</div>
            <div>Status: {(record as any)?.status ?? (usedAt ? "USED" : "—")}</div>
          </div>
        )}
      </div>
    );
  }

  // Happy path: show the completion form
  return (
    <div className="p-8 max-w-md mx-auto">
      <h1 className="text-2xl font-semibold mb-2">Complete Your Setup</h1>
      <p className="text-zinc-600 text-sm mb-4">
        You’re finishing setup for <b>{record.email}</b>
        {record.orgName ? <> (business: <b>{record.orgName}</b>)</> : null}.
      </p>

      {/* IMPORTANT: post to /register/complete (not /api/…) */}
      <form
        action="/register/complete"
        method="POST"
        className="space-y-4 border p-6 rounded-md bg-white shadow"
      >
        <input type="hidden" name="token" value={token!} />

        <div>
          <label className="block text-sm font-medium">Business Name</label>
          <input
            type="text"
            name="orgName"
            defaultValue={(record as any)?.orgName ?? ""}
            className="w-full border rounded-md p-2"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium">Password</label>
          <input
            type="password"
            name="password"
            className="w-full border rounded-md p-2"
            minLength={6}
            required
          />
        </div>

        <button
          type="submit"
          className="w-full bg-indigo-600 text-white py-2 rounded-md hover:bg-indigo-700"
        >
          Create My Account
        </button>
      </form>

      <p className="text-xs text-zinc-500 mt-3">
        Having trouble? Contact <a className="underline" href="mailto:support@arohacalls.com">support@arohacalls.com</a>.
      </p>
    </div>
  );
}
