import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminContext } from "@/app/api/org/appointments/utils";

export const runtime = "nodejs";

const DEFAULTS = {
  enableAiSummaries: false,
};

export async function GET() {
  const auth = await requireAdminContext();
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const settings = await prisma.orgSettings.findUnique({
    where: { orgId: auth.orgId },
    select: { data: true },
  });
  const data = (settings?.data as Record<string, unknown>) || {};
  const callsAnalytics = (data.callsAnalytics as Record<string, unknown>) || {};

  return NextResponse.json({
    ok: true,
    settings: {
      enableAiSummaries:
        typeof callsAnalytics.enableAiSummaries === "boolean"
          ? callsAnalytics.enableAiSummaries
          : DEFAULTS.enableAiSummaries,
    },
  });
}

export async function POST(req: Request) {
  const auth = await requireAdminContext();
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const body = (await req.json().catch(() => ({}))) as {
    enableAiSummaries?: boolean;
  };

  const enableAiSummaries =
    typeof body.enableAiSummaries === "boolean" ? body.enableAiSummaries : DEFAULTS.enableAiSummaries;

  const existing = await prisma.orgSettings.findUnique({
    where: { orgId: auth.orgId },
    select: { data: true },
  });
  const data = (existing?.data as Record<string, unknown>) || {};
  const next = {
    ...data,
    callsAnalytics: {
      ...(data.callsAnalytics as Record<string, unknown>),
      enableAiSummaries,
    },
  };

  await prisma.orgSettings.upsert({
    where: { orgId: auth.orgId },
    create: { orgId: auth.orgId, data: next as any },
    update: { data: next as any },
  });

  return NextResponse.json({ ok: true, settings: { enableAiSummaries } });
}
