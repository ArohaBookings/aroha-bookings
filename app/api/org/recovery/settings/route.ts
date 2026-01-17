import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getMembershipContext } from "@/app/api/org/appointments/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

type RecoverySettings = {
  enableMissedCalls: boolean;
  enableNoShow: boolean;
  enableAbandoned: boolean;
  autoSend: boolean;
  autoSendMinConfidence: number;
  businessHoursOnly: boolean;
  dailyCap: number;
};

const DEFAULTS: RecoverySettings = {
  enableMissedCalls: true,
  enableNoShow: true,
  enableAbandoned: false,
  autoSend: false,
  autoSendMinConfidence: 92,
  businessHoursOnly: true,
  dailyCap: 20,
};

function resolveSettings(data: Record<string, unknown>): RecoverySettings {
  const raw = (data.recovery as Partial<RecoverySettings>) || {};
  return {
    enableMissedCalls: raw.enableMissedCalls ?? DEFAULTS.enableMissedCalls,
    enableNoShow: raw.enableNoShow ?? DEFAULTS.enableNoShow,
    enableAbandoned: raw.enableAbandoned ?? DEFAULTS.enableAbandoned,
    autoSend: raw.autoSend ?? DEFAULTS.autoSend,
    autoSendMinConfidence:
      typeof raw.autoSendMinConfidence === "number" ? raw.autoSendMinConfidence : DEFAULTS.autoSendMinConfidence,
    businessHoursOnly: raw.businessHoursOnly ?? DEFAULTS.businessHoursOnly,
    dailyCap: typeof raw.dailyCap === "number" ? raw.dailyCap : DEFAULTS.dailyCap,
  };
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export async function GET() {
  const auth = await getMembershipContext();
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const settings = await prisma.orgSettings.findUnique({
    where: { orgId: auth.orgId },
    select: { data: true },
  });
  const data = (settings?.data as Record<string, unknown>) || {};
  return json({ ok: true, settings: resolveSettings(data) });
}

export async function POST(req: Request) {
  const auth = await getMembershipContext();
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const payload = (await req.json().catch(() => ({}))) as Partial<RecoverySettings>;

  const settings = await prisma.orgSettings.findUnique({
    where: { orgId: auth.orgId },
    select: { data: true },
  });
  const data = (settings?.data as Record<string, unknown>) || {};
  const next = resolveSettings({ ...data, recovery: payload });

  await prisma.orgSettings.upsert({
    where: { orgId: auth.orgId },
    update: { data: { ...data, recovery: next } as any },
    create: { orgId: auth.orgId, data: { recovery: next } as any },
  });

  return json({ ok: true, settings: next });
}
