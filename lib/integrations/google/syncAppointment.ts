// lib/integrations/google/syncAppointment.ts
import { prisma } from "@/lib/db";
import { getCalendarClient } from "@/lib/integrations/google/calendar";
import { readGoogleCalendarIntegration, writeGoogleCalendarIntegration } from "@/lib/orgSettings";

type SyncErrorPayload = {
  action: "create" | "update" | "delete";
  appointmentId: string;
  error: string;
  ts: string;
};

async function getOrgCalendarId(orgId: string): Promise<string | null> {
  const os = await prisma.orgSettings.findUnique({
    where: { orgId },
    select: { data: true },
  });
  const data = (os?.data as Record<string, unknown>) || {};
  const google = readGoogleCalendarIntegration(data);
  if (!google.syncEnabled || !google.connected) return null;
  return google.calendarId || null;
}

async function logSyncError(orgId: string, payload: SyncErrorPayload) {
  try {
    const existing = await prisma.orgSettings.upsert({
      where: { orgId },
      create: { orgId, data: {} as any },
      update: {},
      select: { data: true },
    });

    const data = { ...(existing.data as Record<string, unknown>) };
    const list = Array.isArray(data.calendarSyncErrors)
      ? (data.calendarSyncErrors as unknown[]).slice(0)
      : [];

    list.unshift(payload as unknown);
    data.calendarSyncErrors = list.slice(0, 20);
    const next = writeGoogleCalendarIntegration(data, {
      lastSyncError: payload.error,
      lastSyncAt: payload.ts,
    });

    await prisma.orgSettings.update({
      where: { orgId },
      data: { data: next as any },
    });
  } catch (err) {
    console.error("logSyncError failed:", err);
  }
}

async function markCalendarSync(orgId: string) {
  try {
    const existing = await prisma.orgSettings.upsert({
      where: { orgId },
      create: { orgId, data: {} as any },
      update: {},
      select: { data: true },
    });
    const data = { ...(existing.data as Record<string, unknown>) };
    const nowIso = new Date().toISOString();
    const next = writeGoogleCalendarIntegration(data, { lastSyncAt: nowIso, lastSyncError: null });
    await prisma.orgSettings.update({
      where: { orgId },
      data: { data: next as any },
    });
  } catch (err) {
    console.error("markCalendarSync failed:", err);
  }
}

function buildTitle(appt: {
  customerName: string;
  service?: { name: string | null } | null;
  staff?: { name: string | null } | null;
}) {
  const service = appt.service?.name ?? "Appointment";
  const staff = appt.staff?.name ? ` · ${appt.staff.name}` : "";
  return `${service} — ${appt.customerName}${staff}`;
}

export async function createOrUpdateAppointmentEvent(orgId: string, appointmentId: string) {
  try {
    const [calendarId, appt] = await Promise.all([
      getOrgCalendarId(orgId),
      prisma.appointment.findUnique({
        where: { id: appointmentId },
        include: { org: true, service: true, staff: true },
      }),
    ]);
    if (!calendarId || !appt) return;

    const client = await getCalendarClient(orgId);
    if (!client) return;

    const description = [
      appt.notes ?? "",
      "Created by Aroha Bookings",
      `Booking ID: ${appt.id}`,
      appt.org?.name ? `Organization: ${appt.org.name}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const event = {
      summary: buildTitle(appt),
      description,
      start: { dateTime: appt.startsAt.toISOString(), timeZone: appt.org.timezone },
      end: { dateTime: appt.endsAt.toISOString(), timeZone: appt.org.timezone },
      attendees: appt.customerEmail ? [{ email: appt.customerEmail }] : undefined,
      extendedProperties: {
        private: {
          source: "arohabookings",
          bookingId: appt.id,
        },
      },
    };

    if (appt.externalCalendarEventId && appt.externalProvider === "google") {
      await client.events.patch({
        calendarId: appt.externalCalendarId || calendarId,
        eventId: appt.externalCalendarEventId,
        requestBody: event,
      });

      await prisma.appointment.update({
        where: { id: appt.id },
        data: { syncedAt: new Date() },
      });
      await markCalendarSync(orgId);
      return;
    }

    const res = await client.events.insert({
      calendarId,
      requestBody: event,
    });

    const eventId = res.data.id || null;
    if (!eventId) return;

    await prisma.appointment.update({
      where: { id: appt.id },
      data: {
        externalCalendarEventId: eventId,
        externalCalendarId: calendarId,
        externalProvider: "google",
        syncedAt: new Date(),
      },
    });
    await markCalendarSync(orgId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("createOrUpdateAppointmentEvent failed:", err);
    await logSyncError(orgId, {
      action: "update",
      appointmentId,
      error: message,
      ts: new Date().toISOString(),
    });
  }
}

export async function deleteAppointmentEvent(orgId: string, appointmentId: string) {
  try {
    const appt = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: {
        id: true,
        externalCalendarEventId: true,
        externalCalendarId: true,
        externalProvider: true,
      },
    });
    if (!appt || appt.externalProvider !== "google" || !appt.externalCalendarEventId) return;

    const client = await getCalendarClient(orgId);
    if (!client) return;

    await client.events.delete({
      calendarId: appt.externalCalendarId || "primary",
      eventId: appt.externalCalendarEventId,
    });

    await prisma.appointment.update({
      where: { id: appt.id },
      data: {
        externalCalendarEventId: null,
        externalCalendarId: null,
        externalProvider: null,
        syncedAt: new Date(),
      },
    });
    await markCalendarSync(orgId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("deleteAppointmentEvent failed:", err);
    await logSyncError(orgId, {
      action: "delete",
      appointmentId,
      error: message,
      ts: new Date().toISOString(),
    });
  }
}
