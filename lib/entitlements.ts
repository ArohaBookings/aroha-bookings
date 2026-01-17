import { prisma } from "@/lib/db";
import { resolvePlanConfig } from "@/lib/plan";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export type EntitlementFeatures = {
  booking: boolean;
  emailAi: boolean;
  messagesHub: boolean;
  calendar: boolean;
  holds: boolean;
  analytics: boolean;
};

export type EntitlementAutomation = {
  enableAutoDraft: boolean;
  enableAutoSend: boolean;
  dailySendCap: number;
  minConfidence: number;
  requireApprovalFirstN: number;
};

export type EntitlementLimits = {
  staffMax: number | null;
  bookingsPerMonth: number | null;
  inboxSyncIntervalSec: number;
  messageSyncIntervalSec: number;
};

export type EntitlementChannels = {
  whatsapp: { enabled: boolean };
  instagram: { enabled: boolean };
  webchat: { enabled: boolean };
};

export type OrgEntitlements = {
  features: EntitlementFeatures;
  automation: EntitlementAutomation;
  limits: EntitlementLimits;
  channels: EntitlementChannels;
};

export type GlobalControls = {
  disableAutoSendAll?: boolean;
  disableMessagesHubAll?: boolean;
  disableEmailAIAll?: boolean;
};

const DEFAULT_AUTOMATION: EntitlementAutomation = {
  enableAutoDraft: true,
  enableAutoSend: false,
  dailySendCap: 20,
  minConfidence: 92,
  requireApprovalFirstN: 25,
};

const DEFAULT_LIMITS: Omit<EntitlementLimits, "staffMax" | "bookingsPerMonth"> = {
  inboxSyncIntervalSec: 15,
  messageSyncIntervalSec: 20,
};

function asBool(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  return fallback;
}

function asNum(value: unknown, fallback: number) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function asNullableNum(value: unknown, fallback: number | null) {
  if (value === null) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return num <= 0 ? null : Math.floor(num);
}

function normalizeFeatures(input: Partial<EntitlementFeatures>, plan: ReturnType<typeof resolvePlanConfig>): EntitlementFeatures {
  const features = plan.features || {};
  return {
    booking: asBool(input.booking, Boolean(features.booking ?? true)),
    emailAi: asBool(input.emailAi, Boolean(features.emailAI ?? false)),
    messagesHub: asBool(input.messagesHub, Boolean(features.emailAI ?? true)),
    calendar: asBool(input.calendar, Boolean(features.googleSync ?? true)),
    holds: asBool(input.holds, Boolean(features.emailAI ?? true)),
    analytics: asBool(input.analytics, Boolean(features.analytics ?? true)),
  };
}

function normalizeAutomation(input: Partial<EntitlementAutomation>): EntitlementAutomation {
  return {
    enableAutoDraft: asBool(input.enableAutoDraft, DEFAULT_AUTOMATION.enableAutoDraft),
    enableAutoSend: asBool(input.enableAutoSend, DEFAULT_AUTOMATION.enableAutoSend),
    dailySendCap: asNum(input.dailySendCap, DEFAULT_AUTOMATION.dailySendCap),
    minConfidence: asNum(input.minConfidence, DEFAULT_AUTOMATION.minConfidence),
    requireApprovalFirstN: asNum(input.requireApprovalFirstN, DEFAULT_AUTOMATION.requireApprovalFirstN),
  };
}

function normalizeLimits(input: Partial<EntitlementLimits>, plan: ReturnType<typeof resolvePlanConfig>): EntitlementLimits {
  return {
    staffMax: asNullableNum(input.staffMax, plan.limits.staffCount ?? null),
    bookingsPerMonth: asNullableNum(input.bookingsPerMonth, plan.limits.bookingsPerMonth ?? null),
    inboxSyncIntervalSec: asNum(input.inboxSyncIntervalSec, DEFAULT_LIMITS.inboxSyncIntervalSec),
    messageSyncIntervalSec: asNum(input.messageSyncIntervalSec, DEFAULT_LIMITS.messageSyncIntervalSec),
  };
}

function normalizeChannels(input: Partial<EntitlementChannels>): EntitlementChannels {
  return {
    whatsapp: { enabled: asBool(input.whatsapp?.enabled, false) },
    instagram: { enabled: asBool(input.instagram?.enabled, false) },
    webchat: { enabled: asBool(input.webchat?.enabled, false) },
  };
}

async function readGlobalControls(): Promise<GlobalControls> {
  const slug = (process.env.SUPERADMIN_ORG_SLUG || "aroha-hq").trim();
  if (!slug) return {};
  const org = await prisma.organization.findUnique({ where: { slug }, select: { id: true } });
  if (!org) return {};
  const os = await prisma.orgSettings.findUnique({ where: { orgId: org.id }, select: { data: true } });
  const data = (os?.data as Record<string, unknown>) || {};
  const controls = (data.globalControls as Record<string, unknown>) || {};
  return {
    disableAutoSendAll: Boolean(controls.disableAutoSendAll),
    disableMessagesHubAll: Boolean(controls.disableMessagesHubAll),
    disableEmailAIAll: Boolean(controls.disableEmailAIAll),
  };
}

export async function getOrgEntitlements(orgId: string): Promise<OrgEntitlements> {
  const [org, orgSettings, globalControls] = await Promise.all([
    prisma.organization.findUnique({ where: { id: orgId }, select: { plan: true } }),
    prisma.orgSettings.findUnique({ where: { orgId }, select: { data: true } }),
    readGlobalControls(),
  ]);

  const data = (orgSettings?.data as Record<string, unknown>) || {};
  const planConfig = resolvePlanConfig(org?.plan ?? null, data);
  const raw = (data.entitlements as Record<string, unknown>) || {};

  const entitlements: OrgEntitlements = {
    features: normalizeFeatures((raw.features as EntitlementFeatures) || {}, planConfig),
    automation: normalizeAutomation((raw.automation as EntitlementAutomation) || {}),
    limits: normalizeLimits((raw.limits as EntitlementLimits) || {}, planConfig),
    channels: normalizeChannels((raw.channels as EntitlementChannels) || {}),
  };

  if (globalControls.disableEmailAIAll) {
    entitlements.features.emailAi = false;
    entitlements.features.holds = false;
  }
  if (globalControls.disableMessagesHubAll) {
    entitlements.features.messagesHub = false;
  }
  if (globalControls.disableAutoSendAll) {
    entitlements.automation.enableAutoSend = false;
  }

  if (!entitlements.features.messagesHub) {
    entitlements.channels = {
      whatsapp: { enabled: false },
      instagram: { enabled: false },
      webchat: { enabled: false },
    };
  }

  return entitlements;
}

export async function requireOrgFeature(orgId: string, feature: keyof EntitlementFeatures) {
  const entitlements = await getOrgEntitlements(orgId);
  if (!entitlements.features[feature]) {
    return { ok: false, status: 403, error: "Feature not enabled for this org", entitlements } as const;
  }
  return { ok: true, entitlements } as const;
}

export async function requireSessionOrgFeature(feature: keyof EntitlementFeatures) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return { ok: false, status: 401, error: "Not authenticated" } as const;
  }
  const membership = await prisma.membership.findFirst({
    where: { user: { email: session.user.email } },
    select: { orgId: true },
    orderBy: { orgId: "asc" },
  });
  if (!membership?.orgId) {
    return { ok: false, status: 400, error: "No organization" } as const;
  }
  const check = await requireOrgFeature(membership.orgId, feature);
  if (!check.ok) {
    return { ok: false, status: check.status, error: check.error, entitlements: check.entitlements } as const;
  }
  return { ok: true, orgId: membership.orgId, entitlements: check.entitlements } as const;
}
