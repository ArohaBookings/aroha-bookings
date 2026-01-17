import { prisma } from "@/lib/db";

export type ClientSignals = {
  noShowCount: number;
  cancellationCount: number;
  totalVisits: number;
  preferredStaffId?: string | null;
  preferredTimeWindow?: "morning" | "afternoon" | "evening" | "unknown";
  lastVisit?: string | null;
  updatedAt: string;
};

function timeWindow(date: Date) {
  const hour = date.getHours();
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 22) return "evening";
  return "unknown";
}

export async function computeClientSignals(orgId: string, customerId: string) {
  const since = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
  const appts = await prisma.appointment.findMany({
    where: { orgId, customerId, startsAt: { gte: since } },
    select: { status: true, staffId: true, startsAt: true },
    orderBy: { startsAt: "desc" },
  });

  const noShowCount = appts.filter((a) => a.status === "NO_SHOW").length;
  const cancellationCount = appts.filter((a) => a.status === "CANCELLED").length;
  const totalVisits = appts.filter((a) => a.status !== "CANCELLED").length;
  const lastVisit = appts[0]?.startsAt?.toISOString() ?? null;

  const staffCounts = new Map<string, number>();
  const timeCounts = new Map<string, number>();
  appts.forEach((a) => {
    if (a.staffId) staffCounts.set(a.staffId, (staffCounts.get(a.staffId) || 0) + 1);
    timeCounts.set(timeWindow(a.startsAt), (timeCounts.get(timeWindow(a.startsAt)) || 0) + 1);
  });

  const preferredStaffId = Array.from(staffCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const preferredTimeWindow =
    (Array.from(timeCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] as
      | "morning"
      | "afternoon"
      | "evening"
      | "unknown"
      | undefined) ?? "unknown";

  return {
    noShowCount,
    cancellationCount,
    totalVisits,
    preferredStaffId,
    preferredTimeWindow,
    lastVisit,
    updatedAt: new Date().toISOString(),
  } satisfies ClientSignals;
}

export async function storeClientSignals(orgId: string, customerId: string, signals: ClientSignals) {
  const settings = await prisma.orgSettings.upsert({
    where: { orgId },
    create: { orgId, data: {} as any },
    update: {},
    select: { data: true },
  });
  const data = { ...(settings.data as Record<string, unknown>) };
  const map = (data.clientSignals as Record<string, unknown>) || {};
  map[customerId] = signals;
  data.clientSignals = map;
  await prisma.orgSettings.update({
    where: { orgId },
    data: { data: data as any },
  });
}

export async function loadClientGuardrails(orgId: string, customerId: string) {
  const settings = await prisma.orgSettings.findUnique({
    where: { orgId },
    select: { data: true },
  });
  const data = (settings?.data as Record<string, unknown>) || {};
  const guardrails = (data.clientGuardrails as Record<string, unknown>) || {};
  return guardrails[customerId] as Record<string, unknown> | undefined;
}

export async function storeClientGuardrails(
  orgId: string,
  customerId: string,
  guardrail: Record<string, unknown>
) {
  const settings = await prisma.orgSettings.upsert({
    where: { orgId },
    create: { orgId, data: {} as any },
    update: {},
    select: { data: true },
  });
  const data = { ...(settings.data as Record<string, unknown>) };
  const map = (data.clientGuardrails as Record<string, unknown>) || {};
  map[customerId] = guardrail;
  data.clientGuardrails = map;
  await prisma.orgSettings.update({
    where: { orgId },
    data: { data: data as any },
  });
}
