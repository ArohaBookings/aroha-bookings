import { prisma } from "@/lib/db";

export type RuleConditionType = "NO_SHOW_COUNT" | "REPEAT_CLIENT" | "LATE_APPOINTMENT";
export type RuleActionType =
  | "FLAG_CLIENT"
  | "REQUIRE_CONFIRMATION"
  | "SKIP_REMINDER"
  | "NOTIFY_NEXT_CLIENT";

export type AutomationRule = {
  id: string;
  enabled: boolean;
  when: {
    type: RuleConditionType;
    threshold?: number;
    windowDays?: number;
  };
  then: {
    action: RuleActionType;
  };
};

export type SimulationResult = {
  ruleId: string;
  action: RuleActionType;
  triggered: boolean;
  reason: string;
};

function daysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export async function loadAutomationRules(orgId: string): Promise<AutomationRule[]> {
  const settings = await prisma.orgSettings.findUnique({
    where: { orgId },
    select: { data: true },
  });
  const data = (settings?.data as Record<string, unknown>) || {};
  const rules = Array.isArray(data.automationRules) ? data.automationRules : [];
  return rules.filter(Boolean) as AutomationRule[];
}

export async function saveAutomationRules(orgId: string, rules: AutomationRule[]) {
  const settings = await prisma.orgSettings.upsert({
    where: { orgId },
    create: { orgId, data: {} as any },
    update: {},
    select: { data: true },
  });
  const data = { ...(settings.data as Record<string, unknown>) };
  data.automationRules = rules;
  await prisma.orgSettings.update({
    where: { orgId },
    data: { data: data as any },
  });
}

export async function simulateRulesForAppointment(input: {
  orgId: string;
  appointmentId: string;
  rules: AutomationRule[];
}): Promise<SimulationResult[]> {
  const appt = await prisma.appointment.findUnique({
    where: { id: input.appointmentId },
    select: { id: true, orgId: true, customerId: true, customerPhone: true },
  });
  if (!appt || appt.orgId !== input.orgId) {
    return input.rules.map((r) => ({
      ruleId: r.id,
      action: r.then.action,
      triggered: false,
      reason: "Appointment not found.",
    }));
  }

  const customerId = appt.customerId || null;
  const windowDays = Math.max(1, ...input.rules.map((r) => r.when.windowDays ?? 0));
  const since = daysAgo(windowDays || 365);

  const appointments = await prisma.appointment.findMany({
    where: {
      orgId: input.orgId,
      ...(customerId ? { customerId } : { customerPhone: appt.customerPhone }),
      startsAt: { gte: since },
    },
    select: { status: true },
  });

  const noShowCount = appointments.filter((a) => a.status === "NO_SHOW").length;
  const visitCount = appointments.filter((a) => a.status !== "CANCELLED").length;

  return input.rules.map((rule) => {
    if (!rule.enabled) {
      return {
        ruleId: rule.id,
        action: rule.then.action,
        triggered: false,
        reason: "Rule disabled.",
      };
    }

    const threshold = Number(rule.when.threshold ?? 1) || 1;
    const window = Number(rule.when.windowDays ?? 30) || 30;

    switch (rule.when.type) {
      case "NO_SHOW_COUNT": {
        const triggered = noShowCount >= threshold;
        return {
          ruleId: rule.id,
          action: rule.then.action,
          triggered,
          reason: triggered
            ? `Customer has ${noShowCount} no-shows in the last ${window} days.`
            : `Customer has ${noShowCount} no-shows in the last ${window} days.`,
        };
      }
      case "REPEAT_CLIENT": {
        const triggered = visitCount >= threshold;
        return {
          ruleId: rule.id,
          action: rule.then.action,
          triggered,
          reason: triggered
            ? `Customer has ${visitCount} bookings in the last ${window} days.`
            : `Customer has ${visitCount} bookings in the last ${window} days.`,
        };
      }
      case "LATE_APPOINTMENT": {
        return {
          ruleId: rule.id,
          action: rule.then.action,
          triggered: false,
          reason: "Late arrivals are not tracked yet.",
        };
      }
      default:
        return {
          ruleId: rule.id,
          action: rule.then.action,
          triggered: false,
          reason: "Unknown rule type.",
        };
    }
  });
}
