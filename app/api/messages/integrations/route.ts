import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSessionOrgFeature } from "@/lib/entitlements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

type IntegrationState = {
  enabled: boolean;
  status: "not_configured" | "setup_required" | "connected";
  pageId?: string;
  appId?: string;
  phoneNumberId?: string;
  wabaId?: string;
  igBusinessId?: string;
  accessToken?: string;
};

type IntegrationsConfig = {
  instagram: IntegrationState;
  whatsapp: IntegrationState;
  sms?: IntegrationState;
};

const DEFAULT_INTEGRATIONS: IntegrationsConfig = {
  instagram: { enabled: false, status: "not_configured" },
  whatsapp: { enabled: false, status: "not_configured" },
  sms: { enabled: false, status: "not_configured" },
};

function normalizeIntegration(input: Partial<IntegrationState> | null | undefined): IntegrationState {
  return {
    enabled: Boolean(input?.enabled),
    status:
      input?.status === "connected" || input?.status === "setup_required"
        ? input.status
        : "not_configured",
    pageId: typeof input?.pageId === "string" ? input.pageId : undefined,
    appId: typeof input?.appId === "string" ? input.appId : undefined,
    phoneNumberId: typeof input?.phoneNumberId === "string" ? input.phoneNumberId : undefined,
    wabaId: typeof input?.wabaId === "string" ? input.wabaId : undefined,
    igBusinessId: typeof input?.igBusinessId === "string" ? input.igBusinessId : undefined,
    accessToken: typeof input?.accessToken === "string" ? input.accessToken : undefined,
  };
}

function normalizeConfig(input: Partial<IntegrationsConfig> | null | undefined): IntegrationsConfig {
  return {
    instagram: normalizeIntegration(input?.instagram),
    whatsapp: normalizeIntegration(input?.whatsapp),
    sms: normalizeIntegration(input?.sms),
  };
}

export async function GET() {
  const gate = await requireSessionOrgFeature("messagesHub");
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  }
  const orgId = gate.orgId!;

  const orgSettings = await prisma.orgSettings.findUnique({
    where: { orgId },
    select: { data: true },
  });
  const data = (orgSettings?.data as Record<string, unknown>) || {};
  const integrations = normalizeConfig((data.integrations as Partial<IntegrationsConfig>) || DEFAULT_INTEGRATIONS);

  return NextResponse.json({ ok: true, integrations });
}

export async function POST(req: Request) {
  const gate = await requireSessionOrgFeature("messagesHub");
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  }
  const orgId = gate.orgId!;

  const payload = (await req.json().catch(() => ({}))) as Partial<IntegrationsConfig>;
  const orgSettings = await prisma.orgSettings.findUnique({
    where: { orgId },
    select: { data: true },
  });
  const data = (orgSettings?.data as Record<string, unknown>) || {};
  const integrations = normalizeConfig(payload);
  const channels = gate.entitlements?.channels;
  if (channels) {
    integrations.instagram.enabled = channels.instagram.enabled && integrations.instagram.enabled;
    integrations.whatsapp.enabled = channels.whatsapp.enabled && integrations.whatsapp.enabled;
    integrations.sms = {
      ...(integrations.sms || { enabled: false, status: "not_configured" }),
      enabled: channels.webchat.enabled && Boolean(integrations.sms?.enabled),
    };
  }

  await prisma.orgSettings.upsert({
    where: { orgId },
    create: { orgId, data: { ...data, integrations } as any },
    update: { data: { ...data, integrations } as any },
  });

  return NextResponse.json({ ok: true, integrations });
}
