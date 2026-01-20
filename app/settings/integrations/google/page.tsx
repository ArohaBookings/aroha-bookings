// app/settings/integrations/google/page.tsx
import React from "react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readGoogleCalendarIntegration } from "@/lib/orgSettings";
import GoogleIntegrationsClient from "./GoogleIntegrationsClient";
import GoogleConnectionActions from "./GoogleConnectionActions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export default async function GoogleIntegrationsPage() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email || null;
  if (!email) redirect("/login");

  const membership = await prisma.membership.findFirst({
    where: { user: { email } },
    include: { org: true },
  });
  if (!membership?.org) redirect("/unauthorized");
  if (!["owner", "admin"].includes(membership.role)) redirect("/unauthorized");

  const [connection, settings] = await Promise.all([
    prisma.calendarConnection.findFirst({
      where: { orgId: membership.org.id, provider: "google" },
      select: { accountEmail: true, expiresAt: true },
    }),
    prisma.orgSettings.findUnique({
      where: { orgId: membership.org.id },
      select: { data: true },
    }),
  ]);

  const data = (settings?.data as Record<string, unknown>) || {};
  const google = readGoogleCalendarIntegration(data);
  const calendarId = google.calendarId || null;
  const accountEmail = google.accountEmail || connection?.accountEmail || null;
  const isConnected = Boolean(google.connected && calendarId);
  const errorsRaw = Array.isArray(data.calendarSyncErrors) ? data.calendarSyncErrors : [];

  const errors = errorsRaw
    .map((e) => ({
      appointmentId: String((e as any).appointmentId || ""),
      message: String((e as any).error || ""),
      at: (e as any).ts ? String((e as any).ts) : undefined,
    }))
    .filter((e) => e.message)
    .slice(0, 20);

  return (
    <main className="min-h-screen bg-zinc-50 p-6 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold text-zinc-900">Integrations</h1>
          <p className="text-sm text-zinc-600">Google Calendar connection and sync health.</p>
        </header>

        <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-zinc-900">Google Calendar</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2 text-sm text-zinc-700">
            <div>
              <p className="text-xs text-zinc-500">Connection</p>
              <p className="font-medium">{isConnected ? "Connected" : "Not connected"}</p>
              <p className="text-xs text-zinc-500 mt-1">{accountEmail || "No account email"}</p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">Calendar ID</p>
              <p className="font-medium">{calendarId || "Not set"}</p>
              <p className="text-xs text-zinc-500 mt-1">
                {connection?.expiresAt ? `Token expires ${new Date(connection.expiresAt).toLocaleString()}` : "—"}
              </p>
            </div>
          </div>
          <div className="mt-4">
            <GoogleConnectionActions orgId={membership.org.id} connected={isConnected} accountEmail={accountEmail} />
          </div>
        </section>

        <GoogleIntegrationsClient errors={errors} />
      </div>
    </main>
  );
}
