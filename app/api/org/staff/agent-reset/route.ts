import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminContext } from "@/app/api/org/appointments/utils";

export const runtime = "nodejs";

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  return value as Record<string, unknown>;
}

function dropStaffKey(obj: Record<string, unknown>, staffId: string) {
  const next = { ...obj };
  if (staffId in next) delete next[staffId];
  return next;
}

export async function POST(req: Request) {
  const auth = await requireAdminContext();
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const body = (await req.json().catch(() => ({}))) as { staffId?: string };
  const staffId = (body.staffId || "").trim();
  if (!staffId) {
    return NextResponse.json({ ok: false, error: "Missing staffId" }, { status: 400 });
  }

  const settings = await prisma.orgSettings.findUnique({
    where: { orgId: auth.orgId },
    select: { data: true },
  });
  const data = (settings?.data as Record<string, unknown>) || {};

  const aiReceptionist = asRecord(data.aiReceptionist);
  const aiProfiles = dropStaffKey(asRecord(data.aiReceptionistProfiles), staffId);
  const voiceAgents = dropStaffKey(asRecord(data.voiceAgents), staffId);
  const agentProfiles = dropStaffKey(asRecord(data.agentProfiles), staffId);

  const next = {
    ...data,
    aiReceptionistProfiles: aiProfiles,
    voiceAgents,
    agentProfiles,
    aiReceptionist: {
      ...aiReceptionist,
      profiles: dropStaffKey(asRecord(aiReceptionist.profiles), staffId),
      agents: dropStaffKey(asRecord(aiReceptionist.agents), staffId),
    },
  };

  await prisma.orgSettings.upsert({
    where: { orgId: auth.orgId },
    create: { orgId: auth.orgId, data: next as any },
    update: { data: next as any },
  });

  return NextResponse.json({ ok: true });
}
