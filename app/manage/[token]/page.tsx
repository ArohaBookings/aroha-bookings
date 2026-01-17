// app/manage/[token]/page.tsx
import React from "react";
import ManageClient from "./ManageClient";
import { Card } from "@/components/ui";
import { getManageContext } from "@/app/manage/verify";

export const runtime = "nodejs";

type PageProps = {
  params: { token: string };
};

function ErrorCard({ message }: { message: string }) {
  return (
    <main className="min-h-screen bg-zinc-50 flex items-center justify-center px-6">
      <Card className="max-w-md p-8 text-center">
        <h1 className="text-xl font-semibold text-zinc-900">Manage booking</h1>
        <p className="mt-2 text-sm text-zinc-600">{message}</p>
      </Card>
    </main>
  );
}

export default async function ManagePage({ params }: PageProps) {
  const token = params.token || "";
  if (!token) {
    return <ErrorCard message="Invalid manage link." />;
  }

  const ctx = await getManageContext(token);
  if (!ctx.ok) {
    return <ErrorCard message={ctx.error} />;
  }

  const appt = ctx.appointment;

  return (
    <ManageClient
      token={token}
      org={{
        name: appt.org.name,
        slug: appt.org.slug,
        timezone: appt.org.timezone,
      }}
      appointment={{
        id: appt.id,
        startsAt: appt.startsAt.toISOString(),
        endsAt: appt.endsAt.toISOString(),
        status: appt.status,
        customerName: appt.customerName,
        customerPhone: appt.customerPhone,
        customerEmail: appt.customerEmail,
        staffId: appt.staffId,
        staffName: appt.staff?.name ?? null,
        serviceId: appt.serviceId,
        serviceName: appt.service?.name ?? null,
      }}
    />
  );
}
