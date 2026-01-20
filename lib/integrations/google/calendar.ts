// lib/integrations/google/calendar.ts
import { google } from "googleapis";
import { prisma } from "@/lib/db";
import { buildGoogleAuthUrl as buildAuthUrl, getGoogleOAuthClient } from "@/lib/google/connect";
import { readGoogleCalendarIntegration } from "@/lib/orgSettings";

type CalendarConnectionRow = {
  id: string;
  orgId: string;
  provider: string;
  accountEmail: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
};

const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
];

function nowMs() {
  return Date.now();
}

function msFromDate(d?: Date | null) {
  return d ? d.getTime() : 0;
}

export function buildGoogleAuthUrl(state: string) {
  return buildAuthUrl({ scopes: GOOGLE_SCOPES, state });
}

async function refreshAccessToken(connection: CalendarConnectionRow) {
  const oauth2 = getGoogleOAuthClient();
  oauth2.setCredentials({ refresh_token: connection.refreshToken });
  const { credentials } = await oauth2.refreshAccessToken();
  const accessToken = credentials.access_token || connection.accessToken;
  const refreshToken = credentials.refresh_token || connection.refreshToken;
  const expiry = credentials.expiry_date ? new Date(credentials.expiry_date) : new Date(Date.now() + 55 * 60 * 1000);

  await prisma.calendarConnection.update({
    where: { id: connection.id },
    data: {
      accessToken,
      refreshToken,
      expiresAt: expiry,
    },
  });

  return {
    accessToken,
    refreshToken,
    expiresAt: expiry,
  };
}

export async function ensureValidAccessToken(connection: CalendarConnectionRow) {
  const skewMs = 2 * 60 * 1000;
  if (msFromDate(connection.expiresAt) - skewMs > nowMs()) {
    return { accessToken: connection.accessToken, refreshToken: connection.refreshToken, expiresAt: connection.expiresAt };
  }
  return refreshAccessToken(connection);
}

export async function getCalendarConnection(orgId: string) {
  return prisma.calendarConnection.findFirst({
    where: { orgId, provider: "google" },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getCalendarClient(orgId: string) {
  const connection = await getCalendarConnection(orgId);
  if (!connection) return null;
  const tokens = await ensureValidAccessToken(connection);
  const oauth2 = getGoogleOAuthClient();
  oauth2.setCredentials({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    expiry_date: tokens.expiresAt.getTime(),
  });
  return google.calendar({ version: "v3", auth: oauth2 });
}

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

function buildTitle(appt: {
  customerName: string;
  service?: { name: string | null } | null;
  staff?: { name: string | null } | null;
}) {
  const service = appt.service?.name ?? "Appointment";
  const staff = appt.staff?.name ? ` · ${appt.staff.name}` : "";
  return `${service} — ${appt.customerName}${staff}`;
}

export async function upsertEventForAppointment(orgId: string, appointmentId: string) {
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
  } catch (err) {
    console.error("upsertEventForAppointment failed:", err);
  }
}

export async function deleteEventForAppointment(orgId: string, appointmentId: string) {
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
  } catch (err) {
    console.error("deleteEventForAppointment failed:", err);
  }
}
