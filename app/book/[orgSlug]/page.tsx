// app/book/[orgSlug]/page.tsx
import React from "react";
import { prisma } from "@/lib/db";
import { resolvePlanConfig } from "@/lib/plan";
import { resolveBookingPageConfig } from "@/lib/booking/templates";
import { resolveBranding } from "@/lib/branding";
import BookClient from "./BookClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = {
  params: { orgSlug: string };
  searchParams?: Promise<{ serviceId?: string; staffId?: string }>;
};

export default async function BookingPage({ params, searchParams }: PageProps) {
  const sp = (await searchParams) ?? {};
  const org = await prisma.organization.findUnique({
    where: { slug: params.orgSlug },
    select: {
      id: true,
      name: true,
      slug: true,
      timezone: true,
      address: true,
      dashboardConfig: true,
      niche: true,
      plan: true,
    },
  });

  if (!org) {
    return (
      <main className="min-h-[70vh] flex items-center justify-center bg-zinc-50">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-semibold">Business not found</h1>
          <p className="text-sm text-zinc-600 mt-2">
            The booking link is invalid or this business is not available.
          </p>
        </div>
      </main>
    );
  }

  const online = (org.dashboardConfig as Record<string, unknown>)?.onlineBooking as Record<string, unknown> | undefined;
  if (online && online.enabled === false) {
    return (
      <main className="min-h-[70vh] flex items-center justify-center bg-zinc-50">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-semibold">Online booking paused</h1>
          <p className="text-sm text-zinc-600 mt-2">
            {org.name} is not accepting online bookings at the moment.
          </p>
        </div>
      </main>
    );
  }

  const [services, staff, orgSettings] = await Promise.all([
    prisma.service.findMany({
      where: { orgId: org.id },
      select: { id: true, name: true, durationMin: true, priceCents: true },
      orderBy: { name: "asc" },
    }),
    prisma.staffMember.findMany({
      where: { orgId: org.id, active: true },
      select: { id: true, name: true, colorHex: true },
      orderBy: { name: "asc" },
    }),
    prisma.orgSettings.findUnique({ where: { orgId: org.id }, select: { data: true } }),
  ]);

  const settingsData = (orgSettings?.data as Record<string, unknown>) || {};
  const planConfig = resolvePlanConfig(org.plan, settingsData);
  const bookingPage = resolveBookingPageConfig(org.niche, settingsData);
  const branding = resolveBranding(settingsData);
  const contact = ((org.dashboardConfig as Record<string, unknown>)?.contact as Record<string, unknown>) || {};

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0));
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0));
  const bookingCount = await prisma.appointment.count({
    where: {
      orgId: org.id,
      startsAt: { gte: monthStart, lt: monthEnd },
      status: { not: "CANCELLED" },
    },
  });

  return (
    <BookClient
      org={{
        id: org.id,
        name: org.name,
        slug: org.slug,
        timezone: org.timezone,
        address: org.address ?? "",
        niche: org.niche ?? null,
        phone: typeof contact.phone === "string" ? contact.phone : "",
        email: typeof contact.email === "string" ? contact.email : "",
      }}
      services={services}
      staff={staff}
      planLimits={planConfig.limits}
      planFeatures={planConfig.features}
      bookingPage={bookingPage}
      bookingUsage={{
        monthCount: bookingCount,
      }}
      branding={branding}
      defaults={{
        serviceId: sp.serviceId ?? "",
        staffId: sp.staffId ?? "",
      }}
    />
  );
}
