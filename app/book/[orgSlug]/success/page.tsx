// app/book/[orgSlug]/success/page.tsx
import React from "react";
import Link from "next/link";

export const runtime = "nodejs";

type PageProps = {
  params: { orgSlug: string };
  searchParams?: Promise<{ name?: string; start?: string; manage?: string }>;
};

function fmtDateTime(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-NZ", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default async function SuccessPage({ params, searchParams }: PageProps) {
  const sp = (await searchParams) ?? {};
  const name = sp.name ? decodeURIComponent(sp.name) : "";
  const time = sp.start ? fmtDateTime(decodeURIComponent(sp.start)) : "";
  const manageToken = sp.manage ? decodeURIComponent(sp.manage) : "";

  return (
    <main className="min-h-screen bg-zinc-50 flex items-center justify-center px-6">
      <div className="max-w-lg rounded-3xl border border-zinc-200 bg-white p-8 shadow-sm text-center">
        <div className="mx-auto h-12 w-12 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xl">
          ✓
        </div>
        <h1 className="mt-4 text-2xl font-semibold text-zinc-900">Booking confirmed</h1>
        <p className="mt-2 text-sm text-zinc-600">
          {name ? `${name}, your booking is locked in.` : "Your booking is locked in."}
        </p>
        {time ? (
          <p className="mt-2 text-sm text-zinc-600">
            Scheduled for <span className="font-medium text-zinc-900">{time}</span>.
          </p>
        ) : null}
        <div className="mt-6 flex flex-col gap-2">
          {manageToken ? (
            <Link
              href={`/manage/${encodeURIComponent(manageToken)}`}
              className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"
            >
              Manage booking
            </Link>
          ) : null}
          <Link
            href={`/book/${params.orgSlug}`}
            className="rounded-lg border border-zinc-200 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
          >
            Make another booking
          </Link>
          <Link
            href="/"
            className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white"
          >
            Return to Aroha
          </Link>
        </div>
      </div>
    </main>
  );
}
