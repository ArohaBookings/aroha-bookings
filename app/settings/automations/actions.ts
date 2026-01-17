"use server";

import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { loadAutomationRules, saveAutomationRules, type AutomationRule } from "@/lib/automation/rules";
import { resolvePlanConfig } from "@/lib/plan";

async function requireOrg() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/api/auth/signin");

  const me = await prisma.user.findUnique({
    where: { email: session.user.email },
    include: { memberships: { include: { org: true } } },
  });

  const org = me?.memberships?.[0]?.org;
  if (!org) redirect("/onboarding");
  return org;
}

export async function loadAutomationSettings(): Promise<{
  rules: AutomationRule[];
  planLimits: { bookingsPerMonth: number | null; staffCount: number | null; automations: number | null };
  planFeatures: Record<string, boolean>;
}> {
  const org = await requireOrg();
  const [rules, orgSettings, orgRow] = await Promise.all([
    loadAutomationRules(org.id),
    prisma.orgSettings.findUnique({ where: { orgId: org.id }, select: { data: true } }),
    prisma.organization.findUnique({ where: { id: org.id }, select: { plan: true } }),
  ]);

  const planConfig = resolvePlanConfig(orgRow?.plan ?? null, (orgSettings?.data as Record<string, unknown>) || {});

  return {
    rules,
    planLimits: planConfig.limits,
    planFeatures: planConfig.features,
  };
}

export async function saveAutomationSettings(rules: AutomationRule[]) {
  const org = await requireOrg();
  await saveAutomationRules(org.id, rules);
  return { ok: true } as const;
}
