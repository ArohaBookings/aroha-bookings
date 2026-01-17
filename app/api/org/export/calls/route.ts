import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminContext } from "@/app/api/org/appointments/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function csvEscape(value: unknown) {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function toIsoOrEmpty(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const d = typeof value === "string" ? new Date(value) : null;
  if (d && !Number.isNaN(d.getTime())) return d.toISOString();
  return "";
}

export async function GET() {
  const auth = await requireAdminContext();
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const rows = await prisma.callLog.findMany({
    where: { orgId: auth.orgId },
    orderBy: { startedAt: "desc" },
    // IMPORTANT: don't select createdAt/updatedAt because TS says they don't exist on the model
    select: {
      id: true,
      callId: true,
      agentId: true,
      startedAt: true,
      endedAt: true,
      callerPhone: true,
      transcript: true,
      recordingUrl: true,
      outcome: true,
      appointmentId: true,
    },
  });

  const header = [
    "id",
    "callId",
    "agentId",
    "startedAt",
    "endedAt",
    "callerPhone",
    "transcript",
    "recordingUrl",
    "outcome",
    "appointmentId",
    "createdAt",
    "updatedAt",
  ];

  const lines: string[] = [header.join(",")];

  for (const row of rows) {
    const anyRow = row as unknown as { createdAt?: unknown; updatedAt?: unknown };

    lines.push(
      [
        row.id,
        row.callId,
        row.agentId ?? "",
        row.startedAt ? row.startedAt.toISOString() : "",
        row.endedAt ? row.endedAt.toISOString() : "",
        row.callerPhone ?? "",
        row.transcript ?? "",
        row.recordingUrl ?? "",
        row.outcome ?? "",
        row.appointmentId ?? "",
        toIsoOrEmpty(anyRow.createdAt),
        toIsoOrEmpty(anyRow.updatedAt),
      ]
        .map(csvEscape)
        .join(","),
    );
  }

  return new NextResponse(lines.join("\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=calls.csv",
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
