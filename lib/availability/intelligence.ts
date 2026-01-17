import { prisma } from "@/lib/db";
import { overlaps } from "@/lib/retell/time";
import { getCalendarClient } from "@/lib/integrations/google/calendar";
import { explainAvailabilityReasons, explainDurationSignal, explainRankedSlot } from "@/lib/ai/explain";

type Reason = { code: string; detail: string };

function toDateKey(date: Date, tz: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function weekdayInTZ(date: Date, tz: string) {
  const w = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short" })
    .format(date)
    .slice(0, 3)
    .toLowerCase();
  return w === "sun"
    ? 0
    : w === "mon"
    ? 1
    : w === "tue"
    ? 2
    : w === "wed"
    ? 3
    : w === "thu"
    ? 4
    : w === "fri"
    ? 5
    : 6;
}

function minutesFromMidnight(date: Date, tz: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const hh = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const mm = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hh * 60 + mm;
}

export async function explainAvailability(input: {
  orgId: string;
  start: Date;
  end: Date;
  staffId?: string | null;
}) {
  const org = await prisma.organization.findUnique({
    where: { id: input.orgId },
    select: { id: true, name: true, timezone: true, dashboardConfig: true, niche: true },
  });

  if (!org) {
    return { available: false, reasons: [{ code: "org_missing", detail: "Organization not found." }], explanation: null };
  }

  const tz = org.timezone || "UTC";

  const [hours, holidays, schedules, appts, orgSettings] = await Promise.all([
    prisma.openingHours.findMany({ where: { orgId: input.orgId } }),
    prisma.holiday.findMany({
      where: { orgId: input.orgId, dateISO: toDateKey(input.start, tz) },
      select: { dateISO: true, label: true },
    }),
    input.staffId
      ? prisma.staffSchedule.findMany({
          where: { staffId: input.staffId },
          select: { dayOfWeek: true, startTime: true, endTime: true },
        })
      : Promise.resolve([]),
    prisma.appointment.findMany({
      where: {
        orgId: input.orgId,
        staffId: input.staffId ?? undefined,
        status: { not: "CANCELLED" },
        startsAt: { lt: input.end },
        endsAt: { gt: input.start },
      },
      select: { startsAt: true, endsAt: true },
    }),
    prisma.orgSettings.findUnique({
      where: { orgId: input.orgId },
      select: { data: true },
    }),
  ]);
  const reasons: Reason[] = [];
  const cfg = (org.dashboardConfig as Record<string, unknown>) || {};
  const rules = (cfg.bookingRules as Record<string, unknown>) || {};
  const leadTimeMin = Number(rules.minLeadMin ?? 0) || 0;
  const bufferBeforeMin = Number(rules.bufferBeforeMin ?? 0) || 0;
  const bufferAfterMin = Number(rules.bufferAfterMin ?? 0) || 0;

  const now = new Date();
  if (input.start.getTime() < now.getTime() + leadTimeMin * 60_000) {
    reasons.push({
      code: "lead_time",
      detail: `Lead time rules require bookings at least ${leadTimeMin} minutes in advance.`,
    });
  }

  const dayKey = toDateKey(input.start, tz);
  if (holidays.some((h) => h.dateISO === dayKey)) {
    reasons.push({ code: "holiday", detail: "The selected day is blocked by a holiday." });
  }

  const dow = weekdayInTZ(input.start, tz);
  const opening = hours.find((h) => h.weekday === dow);
  const startMin = minutesFromMidnight(input.start, tz);
  const endMin = minutesFromMidnight(input.end, tz);
  if (!opening || opening.closeMin <= opening.openMin) {
    reasons.push({ code: "outside_hours", detail: "The business is closed at that time." });
  } else if (startMin < opening.openMin || endMin > opening.closeMin) {
    reasons.push({ code: "outside_hours", detail: "That time sits outside opening hours." });
  }

  if (input.staffId) {
    const sched = schedules.filter((s) => s.dayOfWeek === dow);
    if (!sched.length) {
      reasons.push({ code: "outside_staff_hours", detail: "Selected staff is not scheduled at that time." });
    } else {
      const inSched = sched.some((s) => {
        const [sh, sm] = s.startTime.split(":").map(Number);
        const [eh, em] = s.endTime.split(":").map(Number);
        const sMin = sh * 60 + sm;
        const eMin = eh * 60 + em;
        return startMin >= sMin && endMin <= eMin;
      });
      if (!inSched) {
        reasons.push({ code: "outside_staff_hours", detail: "Selected staff is not scheduled at that time." });
      }
    }
  }

  if (appts.length) {
    reasons.push({ code: "staff_busy", detail: "This time overlaps an existing booking." });
  }

  if (bufferBeforeMin || bufferAfterMin) {
    const bufferedStart = new Date(input.start.getTime() - bufferBeforeMin * 60_000);
    const bufferedEnd = new Date(input.end.getTime() + bufferAfterMin * 60_000);
    const bufferedOverlap = appts.some((a) => overlaps(bufferedStart, bufferedEnd, a.startsAt, a.endsAt));
    if (bufferedOverlap) {
      reasons.push({ code: "buffer", detail: "Travel or prep buffers block this time." });
    }
  }

  try {
    const data = (orgSettings?.data as Record<string, unknown>) || {};
    const calendarId = typeof data.googleCalendarId === "string" ? data.googleCalendarId : null;
    if (calendarId) {
      const client = await getCalendarClient(org.id);
      if (client) {
        const resp = await client.freebusy.query({
          requestBody: {
            timeMin: input.start.toISOString(),
            timeMax: input.end.toISOString(),
            items: [{ id: calendarId }],
          },
        });
        const busy = resp.data.calendars?.[calendarId]?.busy ?? [];
        const blocked = busy.some((b) => {
          if (!b.start || !b.end) return false;
          return overlaps(input.start, input.end, new Date(b.start as string), new Date(b.end as string));
        });
        if (blocked) {
          reasons.push({ code: "google_busy", detail: "Google Calendar shows a busy block." });
        }
      }
    }
  } catch {
    // ignore external errors for explainability
  }

  const explanation = await explainAvailabilityReasons({
    orgName: org.name,
    timezone: tz,
    reasons,
    niche: org.niche,
  });

  return {
    available: reasons.length === 0,
    reasons,
    explanation: explanation.text,
    ai: explanation.ai,
  };
}

export async function rankSlots(input: {
  orgId: string;
  slots: Array<{ start: string; end: string; staffId?: string | null }>;
}) {
  if (!input.slots.length) return [];

  const org = await prisma.organization.findUnique({
    where: { id: input.orgId },
    select: { name: true, timezone: true, niche: true },
  });
  const timezone = org?.timezone || "UTC";

  const historyStart = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  const recent = await prisma.appointment.findMany({
    where: { orgId: input.orgId, startsAt: { gte: historyStart } },
    select: { staffId: true, startsAt: true, endsAt: true },
  });

  const staffCounts = new Map<string, number>();
  const hourCounts = new Map<string, number>();
  recent.forEach((a) => {
    if (a.staffId) staffCounts.set(a.staffId, (staffCounts.get(a.staffId) || 0) + 1);
    const hour = minutesFromMidnight(a.startsAt, timezone);
    const key = `${weekdayInTZ(a.startsAt, timezone)}:${Math.floor(hour / 60)}`;
    hourCounts.set(key, (hourCounts.get(key) || 0) + 1);
  });

  const now = new Date();
  const maxStaffCount = Math.max(1, ...Array.from(staffCounts.values()));
  const maxHourCount = Math.max(1, ...Array.from(hourCounts.values()));

  const scored = input.slots.map((slot) => {
    const start = new Date(slot.start);
    const minutesFromNow = Math.max(0, Math.round((start.getTime() - now.getTime()) / 60000));
    const hour = Math.floor(minutesFromMidnight(start, timezone) / 60);
    const dow = weekdayInTZ(start, timezone);
    const hourKey = `${dow}:${hour}`;

    const soonestScore = Math.max(0, 240 - minutesFromNow) / 240;
    const latePenalty = hour >= 17 ? -0.2 : hour <= 8 ? -0.1 : 0;
    const staffLoad = slot.staffId ? staffCounts.get(slot.staffId) || 0 : 0;
    const balanceScore = slot.staffId ? 1 - staffLoad / maxStaffCount : 0;
    const densityScore = (hourCounts.get(hourKey) || 0) / maxHourCount;

    const score = soonestScore * 0.5 + balanceScore * 0.2 + densityScore * 0.3 + latePenalty;
    const rationale: string[] = [];
    if (soonestScore > 0.4) rationale.push("Sooner options tend to be accepted more often.");
    if (densityScore > 0.6) rationale.push("This time is popular for similar bookings.");
    if (balanceScore > 0.6) rationale.push("This staff member has more capacity around this time.");
    if (latePenalty < 0) rationale.push("Later slots often see more reschedules.");

    const explanationBase = rationale.length ? rationale.join(" ") : "Balanced availability for this time window.";

    return {
      slot,
      score: Number(score.toFixed(4)),
      rationale,
      explanationBase,
    };
  });

  scored.sort((a, b) => b.score - a.score);

  const top = scored.slice(0, 3);
  const withAI = await Promise.all(
    top.map(async (item) => {
      const start = new Date(item.slot.start);
      const slotLabel = `${start.toISOString()} (${timezone})`;
      const explanation = await explainRankedSlot({
        orgName: org?.name || "the business",
        slotLabel,
        rationale: item.rationale.length ? item.rationale : ["Balanced availability for this time window."],
        niche: org?.niche ?? null,
      });
      return {
        ...item,
        explanation: explanation.text,
        ai: explanation.ai,
      };
    })
  );

  const aiByStart = new Map(withAI.map((i) => [i.slot.start, i]));

  return scored.map((item) => {
    const ai = aiByStart.get(item.slot.start);
    return {
      ...item.slot,
      score: item.score,
      explanation: ai?.explanation || item.explanationBase,
      ai: ai?.ai || false,
    };
  });
}

export async function predictDuration(input: { orgId: string; serviceId: string }) {
  const org = await prisma.organization.findUnique({
    where: { id: input.orgId },
    select: { name: true, timezone: true, niche: true },
  });
  if (!org) return null;

  const service = await prisma.service.findFirst({
    where: { id: input.serviceId, orgId: input.orgId },
    select: { id: true, name: true, durationMin: true },
  });
  if (!service) return null;

  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const recent = await prisma.appointment.findMany({
    where: {
      orgId: input.orgId,
      serviceId: input.serviceId,
      startsAt: { gte: since },
    },
    select: { startsAt: true, endsAt: true },
  });

  const durations = recent
    .map((a) => Math.max(5, Math.round((a.endsAt.getTime() - a.startsAt.getTime()) / 60000)))
    .filter((n) => Number.isFinite(n));

  const sampleSize = durations.length;
  const sorted = durations.slice().sort((a, b) => a - b);
  const median =
    sorted.length === 0
      ? service.durationMin
      : sorted.length % 2 === 1
      ? sorted[(sorted.length - 1) / 2]
      : Math.round((sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2);

  const avg =
    sorted.length === 0 ? service.durationMin : Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length);

  const predictedMin = Math.max(service.durationMin, median);
  const signal = await explainDurationSignal({
    orgName: org.name,
    serviceName: service.name,
    predictedMin,
    sampleSize,
    niche: org.niche,
  });

  const settings = await prisma.orgSettings.upsert({
    where: { orgId: input.orgId },
    create: { orgId: input.orgId, data: {} as any },
    update: {},
    select: { data: true },
  });

  const data = { ...(settings.data as Record<string, unknown>) };
  const durationSignals = (data.durationSignals as Record<string, unknown>) || {};
  durationSignals[service.id] = {
    avgMin: avg,
    medianMin: median,
    predictedMin,
    sampleSize,
    updatedAt: new Date().toISOString(),
  };
  data.durationSignals = durationSignals;

  await prisma.orgSettings.update({
    where: { orgId: input.orgId },
    data: { data: data as any },
  });

  return {
    predictedMin,
    sampleSize,
    avgMin: avg,
    medianMin: median,
    explanation: signal.text,
    ai: signal.ai,
  };
}
