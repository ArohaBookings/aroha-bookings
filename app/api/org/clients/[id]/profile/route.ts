import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getMembershipContext, requireAdminContext } from "@/app/api/org/appointments/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getMembershipContext();
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  const { id } = await params;

  const customer = await prisma.customer.findUnique({
    where: { id },
    select: { id: true, orgId: true },
  });
  if (!customer || customer.orgId !== auth.orgId) {
    return json({ ok: false, error: "Client not found" }, 404);
  }

  const profile = await prisma.clientProfile.findUnique({
    where: { customerId: customer.id },
  });

  return json({ ok: true, profile });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminContext();
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  const { id } = await params;

  const customer = await prisma.customer.findUnique({
    where: { id },
    select: { id: true, orgId: true },
  });
  if (!customer || customer.orgId !== auth.orgId) {
    return json({ ok: false, error: "Client not found" }, 404);
  }

  const body = (await req.json().catch(() => ({}))) as {
    preferredDays?: string[];
    preferredTimes?: string[];
    lastServiceId?: string | null;
    tonePreference?: "DEFAULT" | "FORMAL" | "CASUAL";
    notes?: string | null;
    cancellationCount?: number;
  };

  const cleaned = {
    preferredDays: Array.isArray(body.preferredDays) ? body.preferredDays : [],
    preferredTimes: Array.isArray(body.preferredTimes) ? body.preferredTimes : [],
    lastServiceId: body.lastServiceId ? body.lastServiceId : null,
    tonePreference: body.tonePreference || "DEFAULT",
    notes: typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null,
    cancellationCount:
      typeof body.cancellationCount === "number" && Number.isFinite(body.cancellationCount)
        ? Math.max(0, Math.floor(body.cancellationCount))
        : 0,
  };

  const profile = await prisma.clientProfile.upsert({
    where: { customerId: customer.id },
    create: {
      orgId: auth.orgId,
      customerId: customer.id,
      preferredDays: cleaned.preferredDays,
      preferredTimes: cleaned.preferredTimes,
      lastServiceId: cleaned.lastServiceId,
      tonePreference: cleaned.tonePreference,
      notes: cleaned.notes,
      cancellationCount: cleaned.cancellationCount,
    },
    update: {
      preferredDays: cleaned.preferredDays,
      preferredTimes: cleaned.preferredTimes,
      lastServiceId: cleaned.lastServiceId,
      tonePreference: cleaned.tonePreference,
      notes: cleaned.notes,
      cancellationCount: cleaned.cancellationCount,
    },
  });

  return json({ ok: true, profile });
}
