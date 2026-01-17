import type { Plan } from "@prisma/client";

export type PlanLimits = {
  bookingsPerMonth: number | null;
  staffCount: number | null;
  automations: number | null;
};

export type PlanFeatures = Record<string, boolean>;

export type PlanConfig = {
  plan: string;
  limits: PlanLimits;
  features: PlanFeatures;
};

const DEFAULT_LIMITS: Record<string, PlanLimits> = {
  LITE: { bookingsPerMonth: 200, staffCount: 2, automations: 3 },
  STARTER: { bookingsPerMonth: 500, staffCount: 5, automations: 10 },
  PROFESSIONAL: { bookingsPerMonth: 2000, staffCount: 25, automations: 50 },
  PREMIUM: { bookingsPerMonth: 10000, staffCount: 200, automations: 200 },
};

const DEFAULT_FEATURES: Record<string, PlanFeatures> = {
  LITE: {
    booking: true,
    calls: false,
    emailAI: false,
    googleSync: false,
    staffPortal: true,
    automations: false,
    clientSelfService: true,
    analytics: false,
  },
  STARTER: {
    booking: true,
    calls: true,
    emailAI: false,
    googleSync: true,
    staffPortal: true,
    automations: true,
    clientSelfService: true,
    analytics: true,
  },
  PROFESSIONAL: {
    booking: true,
    calls: true,
    emailAI: true,
    googleSync: true,
    staffPortal: true,
    automations: true,
    clientSelfService: true,
    analytics: true,
  },
  PREMIUM: {
    booking: true,
    calls: true,
    emailAI: true,
    googleSync: true,
    staffPortal: true,
    automations: true,
    clientSelfService: true,
    analytics: true,
  },
};

function coerceLimit(value: unknown): number | null {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (num <= 0) return null;
  return Math.floor(num);
}

function readPlanLimits(input: unknown): Partial<PlanLimits> {
  if (!input || typeof input !== "object") return {};
  const record = input as Record<string, unknown>;
  return {
    bookingsPerMonth: coerceLimit(record.bookingsPerMonth),
    staffCount: coerceLimit(record.staffCount),
    automations: coerceLimit(record.automations),
  };
}

function readPlanFeatures(input: unknown): PlanFeatures {
  if (!input || typeof input !== "object") return {};
  const entries = Object.entries(input as Record<string, unknown>);
  const filtered = entries.filter(([, value]) => typeof value === "boolean");
  return Object.fromEntries(filtered) as PlanFeatures;
}

function mergeFeatures(base: PlanFeatures, override: PlanFeatures): PlanFeatures {
  return { ...base, ...override };
}

export function resolvePlanConfig(
  plan: Plan | string | null | undefined,
  data: Record<string, unknown>
): PlanConfig {
  const planKey = (plan || "PROFESSIONAL").toString().toUpperCase();
  const baseLimits = DEFAULT_LIMITS[planKey] || DEFAULT_LIMITS.PROFESSIONAL;
  const baseFeatures = DEFAULT_FEATURES[planKey] || DEFAULT_FEATURES.PROFESSIONAL;

  const overrides = readPlanLimits(data.planLimits);
  const featuresOverride = readPlanFeatures(data.planFeatures);

  const limits: PlanLimits = {
    bookingsPerMonth: overrides.bookingsPerMonth ?? baseLimits.bookingsPerMonth,
    staffCount: overrides.staffCount ?? baseLimits.staffCount,
    automations: overrides.automations ?? baseLimits.automations,
  };

  return {
    plan: planKey,
    limits,
    features: mergeFeatures(baseFeatures, featuresOverride),
  };
}
