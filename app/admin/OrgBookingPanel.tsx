// app/admin/OrgBookingPanel.tsx
"use client";

import React from "react";

type OrgLite = { id: string; name: string };
type OrgInfo = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
};

type OrgInfoResponse = {
  ok: boolean;
  org?: OrgInfo;
  google?: { connected: boolean; calendarId: string | null; accountEmail: string | null };
  services?: Array<{ id: string; name: string; durationMin: number }>;
  error?: string;
};

function toInputDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default function OrgBookingPanel({ orgs }: { orgs: OrgLite[] }) {
  const [orgId, setOrgId] = React.useState(orgs[0]?.id || "");
  const [info, setInfo] = React.useState<OrgInfoResponse | null>(null);
  const [status, setStatus] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "").trim();
  const bookingUrl = info?.org?.slug && appUrl ? `${appUrl.replace(/\/$/, "")}/book/${info.org.slug}` : "";

  async function loadInfo(nextOrgId: string) {
    if (!nextOrgId) return;
    setLoading(true);
    setStatus(null);
    try {
      const res = await fetch(`/api/admin/org-info?orgId=${encodeURIComponent(nextOrgId)}`, {
        cache: "no-store",
      });
      const data = (await res.json()) as OrgInfoResponse;
      if (!res.ok || !data.ok) {
        setStatus(data.error || "Failed to load org info.");
        setInfo(null);
        return;
      }
      setInfo(data);
    } catch {
      setStatus("Failed to load org info.");
      setInfo(null);
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    loadInfo(orgId);
  }, [orgId]);

  async function copyLink() {
    if (!bookingUrl) return;
    try {
      await navigator.clipboard.writeText(bookingUrl);
      setStatus("Booking link copied.");
    } catch {
      setStatus("Unable to copy booking link.");
    }
  }

  async function testAvailability() {
    if (!info?.org?.slug) return;
    const from = toInputDate(new Date());
    const to = toInputDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
    const serviceId = info.services?.[0]?.id || "";
    const url =
      `/api/public/availability?orgSlug=${encodeURIComponent(info.org.slug)}` +
      `&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}` +
      (serviceId ? `&serviceId=${encodeURIComponent(serviceId)}` : "");
    try {
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setStatus(data.error || "Availability test failed.");
        return;
      }
      setStatus(`Availability OK: ${data.meta?.totalSlots ?? data.slots?.length ?? 0} slots.`);
    } catch {
      setStatus("Availability test failed.");
    }
  }

  return (
    <section className="mb-10 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Public booking link</h2>
          <p className="mt-1 text-sm text-zinc-500">Check org booking status and Google connection.</p>
        </div>
        {status ? (
          <div className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs text-zinc-600">
            {status}
          </div>
        ) : null}
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <label className="text-sm font-medium">
          Organisation
          <select
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
          >
            {orgs.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
        </label>
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm">
          <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Booking link</div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-white px-3 py-2 text-xs text-zinc-700 border border-zinc-200">
              {bookingUrl || "Configure NEXT_PUBLIC_APP_URL"}
            </span>
            <button
              type="button"
              onClick={copyLink}
              disabled={!bookingUrl}
              className="rounded-md border border-zinc-300 px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
            >
              Copy link
            </button>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-zinc-200 bg-white p-3 text-sm">
          <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Google status</div>
          <div className="mt-2 text-zinc-700">
            {loading ? "Loading..." : info?.google?.connected ? "Connected" : "Not connected"}
          </div>
          <div className="text-xs text-zinc-500">
            {info?.google?.accountEmail || "No account"}
          </div>
          <div className="text-xs text-zinc-500">
            {info?.google?.calendarId || "No calendar"}
          </div>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-3 text-sm">
          <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Timezone</div>
          <div className="mt-2 text-zinc-700">{info?.org?.timezone || "—"}</div>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-3 text-sm">
          <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Test availability</div>
          <p className="mt-2 text-xs text-zinc-500">Checks next 7 days using the first service.</p>
          <button
            type="button"
            onClick={testAvailability}
            disabled={!info?.org?.slug}
            className="mt-3 rounded-md border border-zinc-300 px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
          >
            Run test
          </button>
        </div>
      </div>
    </section>
  );
}
