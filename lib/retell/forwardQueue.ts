import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";

const PROVIDER = "retell";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/**
 * TS2339 FIX:
 * Prisma client might not have these delegates typed yet (schema/client mismatch).
 * We access them dynamically so TS compiles, and we throw a clear error if missing at runtime.
 */
function getDelegate<T = any>(name: string): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = prisma as any;
  const delegate = p?.[name];
  if (!delegate) {
    throw new Error(
      `Prisma delegate "${name}" not found. Run: npx prisma generate (and apply migrations) to sync client with schema.`
    );
  }
  return delegate as T;
}

type GlobalSettingsDelegate = {
  findUnique: (args: any) => Promise<any>;
  upsert: (args: any) => Promise<any>;
};

type WebhookForwardJobDelegate = {
  create: (args: any) => Promise<any>;
};

const globalSettings = () => getDelegate<GlobalSettingsDelegate>("globalSettings");
const webhookForwardJob = () => getDelegate<WebhookForwardJobDelegate>("webhookForwardJob");

export async function readGlobalZapierUrl() {
  const row = await globalSettings().findUnique({ where: { id: "global" } });
  const url = typeof row?.globalZapierWebhookUrl === "string" ? row.globalZapierWebhookUrl.trim() : "";
  return url || null;
}

export async function writeGlobalZapierUrl(url: string | null) {
  const cleaned = url?.trim() || null;
  const row = await globalSettings().upsert({
    where: { id: "global" },
    create: { id: "global", globalZapierWebhookUrl: cleaned },
    update: { globalZapierWebhookUrl: cleaned },
    select: { globalZapierWebhookUrl: true },
  });
  const out = typeof row?.globalZapierWebhookUrl === "string" ? row.globalZapierWebhookUrl.trim() : "";
  return out || null;
}

export async function readOrgZapierOverride(orgId: string) {
  const settings = await prisma.orgSettings.findUnique({
    where: { orgId },
    select: { data: true },
  });

  const data = asRecord(settings?.data);
  const retell = asRecord(data.retell);
  const url = typeof retell.zapierWebhookUrl === "string" ? retell.zapierWebhookUrl.trim() : "";
  return url || null;
}

export async function writeOrgZapierOverride(orgId: string, url: string | null) {
  const settings = await prisma.orgSettings.findUnique({
    where: { orgId },
    select: { data: true },
  });

  const data = asRecord(settings?.data);
  const retell = asRecord(data.retell);

  retell.zapierWebhookUrl = url?.trim() || null;
  data.retell = retell;

  await prisma.orgSettings.upsert({
    where: { orgId },
    create: { orgId, data: data as Prisma.InputJsonValue },
    update: { data: data as Prisma.InputJsonValue },
  });

  return (typeof retell.zapierWebhookUrl === "string" ? retell.zapierWebhookUrl : null) as string | null;
}

export async function resolveZapierDestination(orgId: string) {
  const [orgOverride, globalUrl] = await Promise.all([readOrgZapierOverride(orgId), readGlobalZapierUrl()]);
  return orgOverride || globalUrl || null;
}

export async function enqueueForwardJob(input: {
  orgId: string;
  retellCallId: string;
  destinationUrl: string;
  payload: Prisma.InputJsonValue;
}) {
  // Basic sanity: never enqueue garbage URLs
  const destinationUrl = input.destinationUrl.trim();
  if (!/^https?:\/\//i.test(destinationUrl)) {
    throw new Error("Invalid destinationUrl (must be http/https)");
  }

  try {
    await webhookForwardJob().create({
      data: {
        provider: PROVIDER,
        orgId: input.orgId,
        retellCallId: input.retellCallId,
        destinationUrl,
        payload: input.payload,
        status: "PENDING",
        attemptCount: 0,
        // Run immediately; processor applies retry/backoff on failures
        nextAttemptAt: new Date(),
      },
    });
  } catch (e: any) {
    // Unique constraint dedupe
    if (e?.code === "P2002") return { ok: true, deduped: true } as const;
    throw e;
  }

  return { ok: true, deduped: false } as const;
}

export async function updateRetellWebhookTimestamp(orgId: string, at = new Date()) {
  const settings = await prisma.orgSettings.findUnique({
    where: { orgId },
    select: { data: true },
  });

  const data = asRecord(settings?.data);
  const retell = asRecord(data.retell);

  retell.lastWebhookAt = at.toISOString();
  data.retell = retell;

  await prisma.orgSettings.upsert({
    where: { orgId },
    create: { orgId, data: data as Prisma.InputJsonValue },
    update: { data: data as Prisma.InputJsonValue },
  });
}
