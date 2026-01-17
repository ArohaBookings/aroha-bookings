// app/staff/page.tsx
import React from "react";
import { prisma } from "@/lib/db";
import { requireStaffPageContext } from "./lib";
import StaffHomeClient from "./StaffHomeClient";
import { Card } from "@/components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function LinkRequired() {
  return (
    <main className="min-h-screen bg-zinc-50 flex items-center justify-center px-6">
      <Card className="max-w-md p-8 text-center">
        <h1 className="text-xl font-semibold text-zinc-900">Staff portal</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Your account isn’t linked to a staff profile yet. Ask an admin to connect your email to a staff member.
        </p>
      </Card>
    </main>
  );
}

export default async function StaffHomePage() {
  const ctx = await requireStaffPageContext();
  if (!ctx.staff) return <LinkRequired />;

  const now = new Date();
  const next = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const appointments = await prisma.appointment.findMany({
    where: {
      orgId: ctx.org.id,
      staffId: ctx.staff.id,
      startsAt: { gte: now, lte: next },
      status: { not: "CANCELLED" },
    },
    orderBy: { startsAt: "asc" },
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      customerName: true,
      customerPhone: true,
      status: true,
      service: { select: { name: true } },
    },
  });

  return (
    <StaffHomeClient
      orgName={ctx.org.name}
      staffName={ctx.staff.name}
      timezone={ctx.org.timezone}
      appointments={appointments.map((a) => ({
        id: a.id,
        startsAt: a.startsAt.toISOString(),
        endsAt: a.endsAt.toISOString(),
        customerName: a.customerName,
        customerPhone: a.customerPhone,
        status: a.status,
        serviceName: a.service?.name ?? null,
      }))}
    />
  );
}
