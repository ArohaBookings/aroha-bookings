import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminContext } from "@/app/api/org/appointments/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function csvEscape(value: unknown) {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function GET() {
  const auth = await requireAdminContext();
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const rows = await prisma.appointment.findMany({
    where: { orgId: auth.orgId },
    orderBy: { startsAt: "desc" },
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      status: true,
      source: true,
      customerName: true,
      customerPhone: true,
      customerEmail: true,
      notes: true,
      staff: { select: { name: true } },
      service: { select: { name: true } },
      externalProvider: true,
      externalCalendarEventId: true,
      syncedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const header = [
    "id",
    "startsAt",
    "endsAt",
    "status",
    "source",
    "customerName",
    "customerPhone",
    "customerEmail",
    "notes",
    "staffName",
    "serviceName",
    "externalProvider",
    "externalCalendarEventId",
    "syncedAt",
    "createdAt",
    "updatedAt",
  ];

  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.id,
        row.startsAt.toISOString(),
        row.endsAt.toISOString(),
        row.status,
        row.source,
        row.customerName,
        row.customerPhone,
        row.customerEmail ?? "",
        row.notes ?? "",
        row.staff?.name ?? "",
        row.service?.name ?? "",
        row.externalProvider ?? "",
        row.externalCalendarEventId ?? "",
        row.syncedAt?.toISOString() ?? "",
        row.createdAt.toISOString(),
        row.updatedAt.toISOString(),
      ].map(csvEscape).join(",")
    );
  }

  return new NextResponse(lines.join("\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=appointments.csv",
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
