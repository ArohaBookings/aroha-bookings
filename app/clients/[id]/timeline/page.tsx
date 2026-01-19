export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import React from "react";
import { prisma } from "@/lib/db";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import Card from "@/components/ui/Card";
import { buildCustomerTimeline } from "@/lib/timeline";
import { getOrgEntitlements } from "@/lib/entitlements";
import ClientMemoryPanel from "../ClientMemoryPanel";

export default async function ClientTimelinePage({
  params,
}: {
  params: { id: string };
}): Promise<React.ReactElement> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/api/auth/signin");

  const membership = await prisma.membership.findFirst({
    where: { user: { email: session.user.email } },
    select: { orgId: true },
    orderBy: { orgId: "asc" },
  });
  const orgId = membership?.orgId || null;
  if (!orgId) {
    return (
      <Card className="p-6">
        <h1 className="text-xl font-semibold">Client timeline</h1>
        <p className="mt-2 text-sm text-zinc-600">No organisation found for this account.</p>
      </Card>
    );
  }

  const entitlements = await getOrgEntitlements(orgId);
  if (!entitlements.features.analytics || !entitlements.features.dashboards) {
    return (
      <Card className="p-6">
        <h1 className="text-xl font-semibold">Client timeline</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Timeline access is not included in your current plan.
        </p>
      </Card>
    );
  }

  const customer = await prisma.customer.findUnique({
    where: { id: params.id },
    select: { id: true, orgId: true, name: true, phone: true, email: true },
  });
  if (!customer || customer.orgId !== orgId) {
    return (
      <Card className="p-6">
        <h1 className="text-xl font-semibold">Client timeline</h1>
        <p className="mt-2 text-sm text-zinc-600">Client not found for this organisation.</p>
      </Card>
    );
  }

  const settings = await prisma.orgSettings.findUnique({
    where: { orgId },
    select: { data: true },
  });
  const data = (settings?.data as Record<string, unknown>) || {};

  const timeline = await buildCustomerTimeline({
    orgId,
    customerId: customer.id,
    phone: customer.phone,
    email: customer.email,
    demoMode: Boolean(data.demoMode),
  });

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Client truth layer</p>
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">
          {customer.name || "Client"} · Timeline
        </h1>
        <p className="text-sm text-zinc-600">
          {customer.email || ""} {customer.phone ? `· ${customer.phone}` : ""}
        </p>
      </header>

      <ClientMemoryPanel clientId={customer.id} />

      <div className="space-y-3">
        {timeline?.events?.length ? (
          timeline.events.map((event) => (
            <Card key={`${event.type}-${event.at}`} className="p-4">
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
        ) : (
          <Card className="p-6 text-sm text-zinc-600">No timeline activity found.</Card>
        )}
      </div>
    </div>
  );
}
