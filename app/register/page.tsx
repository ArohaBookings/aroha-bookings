// app/register/page.tsx
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import React from "react";

export const runtime = "nodejs";

export default async function RegisterPage({
  searchParams,
}: {
  searchParams?: { token?: string };
}) {
  const token = searchParams?.token;
  if (!token) redirect("/unauthorized");

  const record = await prisma.checkoutToken.findUnique({ where: { token } });

  const usedAt = (record as any)?.usedAt ?? (record as any)?.consumedAt ?? (record as any)?.redeemedAt ?? null;
  const isExpired =
    !!record?.expiresAt && record.expiresAt.getTime() < Date.now();

  if (!record || usedAt || isExpired) {
    return (
      <div className="p-8 max-w-lg mx-auto text-center">
        <h1 className="text-2xl font-semibold mb-2">Invalid or expired link</h1>
        <p className="text-zinc-600 text-sm">
          This registration link is no longer valid. Please contact support.
        </p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-md mx-auto">
      <h1 className="text-2xl font-semibold mb-2">Complete Your Setup</h1>
      <p className="text-zinc-600 text-sm mb-4">
        You’re finishing setup for <b>{record.email}</b>.
      </p>

      {/* IMPORTANT: post to /register/complete (not /api/…) */}
      <form
        action="/register/complete"
        method="POST"
        className="space-y-4 border p-6 rounded-md bg-white shadow"
      >
        <input type="hidden" name="token" value={token} />

        <div>
          <label className="block text-sm font-medium">Business Name</label>
          <input
            type="text"
            name="orgName"
            defaultValue={(record as any).orgName ?? ""}
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
    </div>
  );
}
