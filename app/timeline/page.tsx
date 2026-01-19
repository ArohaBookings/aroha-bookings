export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import React from "react";
import { prisma } from "@/lib/db";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Card from "@/components/ui/Card";
import { buildOrgTimeline } from "@/lib/timeline";
import { getOrgEntitlements } from "@/lib/entitlements";
import { getBoolParam, getParam, resolveSearchParams, type SearchParams } from "@/lib/http/searchParams";

function toInputDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default async function TimelinePage({
  searchParams,
}: {
  searchParams: SearchParams | Promise<SearchParams>;
}): Promise<React.ReactElement> {
  const sp = await resolveSearchParams(searchParams);
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/api/auth/signin");

  const membership = await prisma.membership.findFirst({
    where: { user: { email: session.user.email } },
    select: { org: { select: { id: true, name: true } }, orgId: true },
    orderBy: { orgId: "asc" },
  });

  const org = membership?.org ?? null;
  if (!org) {
    return (
      <Card className="p-6">
        <h1 className="text-xl font-semibold">Timeline</h1>
        <p className="mt-2 text-sm text-zinc-600">No organisation found for this account.</p>
      </Card>
    );
  }

  const entitlements = await getOrgEntitlements(org.id);
  if (!entitlements.features.analytics || !entitlements.features.dashboards) {
    return (
      <Card className="p-6">
        <h1 className="text-xl font-semibold">Timeline</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Timeline access is not included in your current plan.
        </p>
      </Card>
    );
  }

  const fromParam = getParam(sp, "from");
  const toParam = getParam(sp, "to");
  const typeParam = getParam(sp, "type");
  const pageParam = getParam(sp, "page");

  const from = fromParam ? new Date(fromParam) : null;
  const to = toParam ? new Date(toParam) : null;
  const page = Math.max(1, Number(pageParam || 1) || 1);

  const settings = await prisma.orgSettings.findUnique({
    where: { orgId: org.id },
    select: { data: true },
  });
  const data = (settings?.data as Record<string, unknown>) || {};
  const demoMode = getBoolParam(sp, "demo") || Boolean(data.demoMode);

  const timeline = await buildOrgTimeline({ orgId: org.id, from, to, demoMode, page, limit: 120 });
  let events = timeline.events;
  if (typeParam) {
    const wanted = typeParam.toUpperCase();
    events = events.filter((e) => e.type.toUpperCase() === wanted);
  }
  const seen = new Set<string>();
  const deduped = events.filter((event) => {
    const key = event.id || `${event.type}-${event.at}-${event.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const totalPages = Math.max(1, Math.ceil(timeline.totalBookings / timeline.limit));

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Truth Layer</p>
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">
          Timeline · {org.name}
        </h1>
      </header>

      <Card className="p-4">
        <form method="get" className="flex flex-wrap gap-3 items-end">
          <label className="grid gap-1 text-xs uppercase tracking-widest text-zinc-500">
            From
            <input
              type="date"
              name="from"
              defaultValue={from ? toInputDate(from) : ""}
              className="h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900"
            />
          </label>
          <label className="grid gap-1 text-xs uppercase tracking-widest text-zinc-500">
            To
            <input
              type="date"
              name="to"
              defaultValue={to ? toInputDate(to) : ""}
              className="h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900"
            />
          </label>
          <label className="grid gap-1 text-xs uppercase tracking-widest text-zinc-500">
            Type
            <select
              name="type"
              defaultValue={typeParam}
              className="h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900"
            >
              <option value="">All</option>
              <option value="CALL">Calls</option>
              <option value="BOOKING">Bookings</option>
              <option value="EMAIL_INBOUND">Email inbound</option>
              <option value="EMAIL_SENT">Email sent</option>
              <option value="EMAIL_DRAFT">Email drafts</option>
              <option value="HOLD">Booking holds</option>
              <option value="MESSAGE">Messages</option>
            </select>
          </label>
          <button
            type="submit"
            className="h-10 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white"
          >
            Update
          </button>
        </form>
      </Card>

      <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500">
        <span>Bookings page {page} of {totalPages}</span>
        <div className="ml-auto flex items-center gap-2">
          {page > 1 && (
            <a
              className="rounded-full border border-zinc-200 px-3 py-1 hover:border-zinc-300"
              href={`/timeline?${new URLSearchParams({
                ...(fromParam ? { from: fromParam } : {}),
                ...(toParam ? { to: toParam } : {}),
                ...(typeParam ? { type: typeParam } : {}),
                page: String(page - 1),
              }).toString()}`}
            >
              Previous
            </a>
          )}
          {page < totalPages && (
            <a
              className="rounded-full border border-zinc-200 px-3 py-1 hover:border-zinc-300"
              href={`/timeline?${new URLSearchParams({
                ...(fromParam ? { from: fromParam } : {}),
                ...(toParam ? { to: toParam } : {}),
                ...(typeParam ? { type: typeParam } : {}),
                page: String(page + 1),
              }).toString()}`}
            >
              Next
            </a>
          )}
        </div>
      </div>

      <div className="space-y-3">
        {deduped.length === 0 ? (
          <Card className="p-6 text-sm text-zinc-600">No timeline events in this range.</Card>
        ) : (
          deduped.map((event) => (
            <Card key={event.id} className="p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-zinc-900">
                  {event.type.replace(/_/g, " ")}
                </div>
                <div className="text-xs text-zinc-500">
                  {new Date(event.at).toLocaleString()}
                </div>
              </div>
              <div className="mt-2 text-sm text-zinc-600">{event.detail}</div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
