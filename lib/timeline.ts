import { prisma } from "@/lib/db";
import { normalizePhone } from "@/lib/retell/phone";
import { formatCallerPhone } from "@/lib/phone/format";
import { DEMO_MESSAGES } from "@/lib/messages/demo";
import { resolveBookingHolds } from "@/lib/booking/holds";

export type TimelineEvent = {
  type: string;
  at: string;
  detail: string;
};

export type CustomerTimeline = {
  customer: {
    id?: string;
    name?: string | null;
    phone?: string | null;
    email?: string | null;
  };
  events: TimelineEvent[];
};

export async function buildAppointmentTimeline(orgId: string, appointmentId: string) {
  const appt = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      callLogs: { select: { startedAt: true, callId: true } },
    },
  });
  if (!appt || appt.orgId !== orgId) return null;

  const events: TimelineEvent[] = [];
  events.push({
    type: "CREATED",
    at: appt.createdAt.toISOString(),
    detail: `Created (${appt.source || "manual"}).`,
  });

  if (appt.source === "online") {
    events.push({
      type: "BOOKED_ONLINE",
      at: appt.createdAt.toISOString(),
      detail: "Booked online by client.",
    });
  }

  const call = appt.callLogs?.[0];
  if (call?.startedAt) {
    events.push({
      type: "BOOKED_BY_CALL",
      at: call.startedAt.toISOString(),
      detail: `Booked via call ${call.callId}.`,
    });
  }

  if (appt.updatedAt && appt.updatedAt.getTime() !== appt.createdAt.getTime()) {
    events.push({
      type: "UPDATED",
      at: appt.updatedAt.toISOString(),
      detail: "Appointment updated.",
    });
  }

  if (appt.cancelledAt) {
    events.push({
      type: "CANCELLED",
      at: appt.cancelledAt.toISOString(),
      detail: `Cancelled by ${appt.cancelledBy || "system"}.`,
    });
  }

  if (appt.syncedAt) {
    events.push({
      type: "SYNCED",
      at: appt.syncedAt.toISOString(),
      detail: appt.externalProvider
        ? `Synced to ${appt.externalProvider}.`
        : "Sync completed.",
    });
  } else if (appt.externalProvider) {
    events.push({
      type: "SYNC_PENDING",
      at: appt.updatedAt.toISOString(),
      detail: "Sync pending.",
    });
  }

  events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  return {
    appointment: {
      id: appt.id,
      status: appt.status,
      source: appt.source,
      externalProvider: appt.externalProvider,
      externalCalendarId: appt.externalCalendarId,
      externalCalendarEventId: appt.externalCalendarEventId,
      syncedAt: appt.syncedAt?.toISOString() ?? null,
    },
    events,
  };
}

export async function buildCustomerTimeline(input: {
  orgId: string;
  phone?: string | null;
  email?: string | null;
  customerId?: string | null;
  demoMode?: boolean;
}) {
  const phone = (input.phone || "").trim();
  const email = (input.email || "").trim().toLowerCase();
  const normalizedPhone = phone ? normalizePhone(phone) : "";

  const customer =
    input.customerId ||
    phone ||
    email
      ? await prisma.customer.findFirst({
          where: {
            orgId: input.orgId,
            ...(input.customerId ? { id: input.customerId } : {}),
            ...(phone ? { phone } : {}),
            ...(email ? { email } : {}),
          },
          select: { id: true, name: true, phone: true, email: true, createdAt: true },
        })
      : null;

  const events: TimelineEvent[] = [];

  if (customer?.createdAt) {
    events.push({
      type: "CUSTOMER_CREATED",
      at: customer.createdAt.toISOString(),
      detail: "Customer profile created.",
    });
  }

  const [appointments, callLogs, emailLogs] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        orgId: input.orgId,
        ...(customer?.id
          ? { customerId: customer.id }
          : phone
          ? { customerPhone: phone }
          : email
          ? { customerEmail: email }
          : {}),
      },
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        status: true,
        source: true,
        customerName: true,
        service: { select: { name: true } },
        staff: { select: { name: true } },
        createdAt: true,
      },
      orderBy: { startsAt: "desc" },
      take: 40,
    }),
    phone
      ? prisma.callLog.findMany({
        where: { orgId: input.orgId, callerPhone: phone },
        select: {
          id: true,
          startedAt: true,
          outcome: true,
          appointmentId: true,
          businessPhone: true,
        },
          orderBy: { startedAt: "desc" },
          take: 40,
        })
      : Promise.resolve([]),
    prisma.emailAILog.findMany({
      where: { orgId: input.orgId },
      select: {
        id: true,
        subject: true,
        snippet: true,
        action: true,
        direction: true,
        createdAt: true,
        receivedAt: true,
        rawMeta: true,
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  ]);

  appointments.forEach((appt) => {
    events.push({
      type: "BOOKING",
      at: appt.startsAt.toISOString(),
      detail: `${appt.service?.name ?? "Service"} with ${appt.staff?.name ?? "staff"} (${
        appt.status || "SCHEDULED"
      }).`,
    });
    if (appt.status === "CANCELLED") {
      events.push({
        type: "CANCELLED",
        at: appt.startsAt.toISOString(),
        detail: "Appointment cancelled.",
      });
    }
    if (appt.status === "NO_SHOW") {
      events.push({
        type: "NO_SHOW",
        at: appt.startsAt.toISOString(),
        detail: "Marked as no-show.",
      });
    }
  });

  callLogs.forEach((call) => {
    if (!call.startedAt) return;
    events.push({
      type: "CALL",
      at: call.startedAt.toISOString(),
      detail: call.outcome ? `Call outcome: ${call.outcome}` : "Call logged.",
    });
  });

  const matchesEmail = (raw: any) => {
    if (!email) return false;
    const from = String(raw?.from || "").toLowerCase();
    const replyTo = String(raw?.replyTo || "").toLowerCase();
    const to = String(raw?.to || "").toLowerCase();
    if (from.includes(email) || replyTo.includes(email) || to.includes(email)) return true;
    try {
      const text = JSON.stringify(raw || {}).toLowerCase();
      return text.includes(email);
    } catch {
      return false;
    }
  };

  const matchesPhone = (raw: any) => {
    if (!normalizedPhone) return false;
    try {
      const digits = normalizedPhone.replace(/\D/g, "");
      const text = JSON.stringify(raw || {}).replace(/\D/g, "");
      return digits.length >= 7 && text.includes(digits);
    } catch {
      return false;
    }
  };

  emailLogs.forEach((log) => {
    if ((email || normalizedPhone) && !matchesEmail(log.rawMeta) && !matchesPhone(log.rawMeta)) return;
    const label = log.action ? ` (${log.action.replace(/_/g, " ")})` : "";
    events.push({
      type: log.direction === "outbound" ? "EMAIL_SENT" : log.direction === "draft" ? "EMAIL_DRAFT" : "EMAIL_INBOUND",
      at: (log.receivedAt || log.createdAt).toISOString(),
      detail: `${log.subject || "Email"}${label}`,
    });
  });

  if (input.demoMode) {
    const demoMatches = DEMO_MESSAGES.filter((m) => {
      if (!email && !normalizedPhone) return true;
      const handle = m.fromHandle.toLowerCase();
      return (email && handle.includes(email)) || (normalizedPhone && handle.includes(normalizedPhone.replace(/\D/g, "")));
    });
    demoMatches.forEach((msg) => {
      events.push({
        type: "MESSAGE",
        at: msg.receivedAt,
        detail: `${msg.channel.toUpperCase()}: ${msg.preview}`,
      });
    });
  }

  events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  return {
    customer: {
      id: customer?.id,
      name: customer?.name ?? null,
      phone: customer?.phone ?? phone ?? null,
      email: customer?.email ?? email ?? null,
    },
    events,
  } satisfies CustomerTimeline;
}

export async function buildOrgTimeline(input: {
  orgId: string;
  from?: Date | null;
  to?: Date | null;
  demoMode?: boolean;
  page?: number;
  limit?: number;
}) {
  const from = input.from || null;
  const to = input.to || null;
  const page = Math.max(1, input.page || 1);
  const limit = Math.max(20, Math.min(200, input.limit || 120));
  const skip = (page - 1) * limit;

  const [calls, appointments, emailLogs, orgSettings, totalBookings] = await Promise.all([
    prisma.callLog.findMany({
      where: {
        orgId: input.orgId,
        ...(from && to ? { startedAt: { gte: from, lte: to } } : {}),
      },
      select: { startedAt: true, callerPhone: true, businessPhone: true, outcome: true },
      orderBy: { startedAt: "desc" },
      take: limit,
    }),
    prisma.appointment.findMany({
      where: {
        orgId: input.orgId,
        ...(from && to ? { startsAt: { gte: from, lte: to } } : {}),
      },
      select: {
        startsAt: true,
        status: true,
        service: { select: { name: true } },
        staff: { select: { name: true } },
        customerName: true,
      },
      orderBy: { startsAt: "desc" },
      take: limit,
      skip,
    }),
    prisma.emailAILog.findMany({
      where: {
        orgId: input.orgId,
        ...(from && to ? { createdAt: { gte: from, lte: to } } : {}),
      },
      select: { createdAt: true, receivedAt: true, subject: true, action: true, direction: true },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    prisma.orgSettings.findUnique({
      where: { orgId: input.orgId },
      select: { data: true },
    }),
    prisma.appointment.count({
      where: {
        orgId: input.orgId,
        ...(from && to ? { startsAt: { gte: from, lte: to } } : {}),
      },
    }),
  ]);

  const events: TimelineEvent[] = [];

  calls.forEach((call) => {
    events.push({
      type: "CALL",
      at: call.startedAt.toISOString(),
      detail: `Call from ${formatCallerPhone(call.callerPhone, call.businessPhone)} (${call.outcome || "unknown"}).`,
    });
  });

  appointments.forEach((appt) => {
    events.push({
      type: "BOOKING",
      at: appt.startsAt.toISOString(),
      detail: `${appt.customerName} · ${appt.service?.name ?? "Service"} with ${
        appt.staff?.name ?? "staff"
      } (${appt.status || "SCHEDULED"}).`,
    });
  });

  emailLogs.forEach((log) => {
    const label = log.action ? ` (${log.action.replace(/_/g, " ")})` : "";
    events.push({
      type: log.direction === "outbound" ? "EMAIL_SENT" : log.direction === "draft" ? "EMAIL_DRAFT" : "EMAIL_INBOUND",
      at: (log.receivedAt || log.createdAt).toISOString(),
      detail: `${log.subject || "Email"}${label}`,
    });
  });

  const data = (orgSettings?.data as Record<string, unknown>) || {};
  const holds = resolveBookingHolds(data);
  holds.forEach((hold) => {
    events.push({
      type: "HOLD",
      at: hold.createdAt,
      detail: `Hold created for ${new Date(hold.start).toLocaleString()}.`,
    });
  });

  if (input.demoMode) {
    DEMO_MESSAGES.forEach((msg) => {
      events.push({
        type: "MESSAGE",
        at: msg.receivedAt,
        detail: `${msg.channel.toUpperCase()}: ${msg.preview}`,
      });
    });
  }

  events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  return { events, page, limit, totalBookings };
}
