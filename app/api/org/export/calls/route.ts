import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminContext } from "@/app/api/org/appointments/utils";
import { requireOrgFeature } from "@/lib/entitlements";

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

function startOfDayLocal(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDayLocal(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function parseDateParam(raw?: string, end = false): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return end ? endOfDayLocal(d) : startOfDayLocal(d);
}

export async function GET(req: Request) {
  const auth = await requireAdminContext();
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const entitlement = await requireOrgFeature(auth.orgId, "exports");
  if (!entitlement.ok) {
    return NextResponse.json(
      { ok: false, error: "Call exports are not included in your plan.", entitlements: entitlement.entitlements },
      { status: entitlement.status }
    );
  }

const url = new URL(req.url);

const fromDate =
  parseDateParam(url.searchParams.get("from") ?? undefined) ??
  startOfDayLocal(new Date(Date.now() - 30 * 86400000));

const toDate =
  parseDateParam(url.searchParams.get("to") ?? undefined, true) ??
  endOfDayLocal(new Date());

const agentId = (url.searchParams.get("agent") || "").trim();
const outcome = (url.searchParams.get("outcome") || "").trim().toUpperCase();

  const rows = await prisma.callLog.findMany({
    where: {
      orgId: auth.orgId,
      ...(agentId ? { agentId } : {}),
      ...(outcome ? { outcome: outcome as any } : {}),
      startedAt: { gte: fromDate, lte: toDate },
    },
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
