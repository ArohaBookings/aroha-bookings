// lib/integrations/google/calendar.ts
import { google } from "googleapis";
import { prisma } from "@/lib/db";
import { buildGoogleAuthUrl as buildAuthUrl, getGoogleOAuthClient } from "@/lib/google/connect";
import { readGoogleCalendarIntegration, writeGoogleCalendarIntegration } from "@/lib/orgSettings";

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
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
];

function nowMs() {
  return Date.now();
}

function msFromDate(d?: Date | null) {
  return d ? d.getTime() : 0;
}

export function buildGoogleAuthUrl(state: string, redirectUrl?: string) {
  return buildAuthUrl({ scopes: GOOGLE_SCOPES, state, redirectUrl });
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

export async function syncGoogleToArohaRange(
  orgId: string,
  calendarId: string,
  rangeStartUTC: Date,
  rangeEndUTC: Date
): Promise<void> {
  try {
    const gcal = await getCalendarClient(orgId);
    if (!gcal) return;

    const res = await gcal.events.list({
      calendarId,
      timeMin: rangeStartUTC.toISOString(),
      timeMax: rangeEndUTC.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
    });

    const items = res.data.items || [];
    if (!items.length) return;

    const existingBusy = await prisma.appointment.findMany({
      where: { orgId, source: { startsWith: "google-busy:" } },
      select: { id: true, source: true, startsAt: true, endsAt: true },
    });
    const busyByEventId = new Map<string, { id: string; startsAt: Date; endsAt: Date }>();
    existingBusy.forEach((b) => {
      const match = (b.source || "").match(/^google-busy:(.+)$/);
      if (match?.[1]) busyByEventId.set(match[1], { id: b.id, startsAt: b.startsAt, endsAt: b.endsAt });
    });

    for (const ev of items) {
      if (ev.status === "cancelled") continue;
      const eventId = ev.id;
      if (!eventId) continue;

      const startIso = ev.start?.dateTime || ev.start?.date;
      const endIso = ev.end?.dateTime || ev.end?.date;
      if (!startIso || !endIso) continue;

      const startsAt = new Date(startIso);
      const endsAt = new Date(endIso);
      if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) continue;

      const isAllDay = !ev.start?.dateTime && !!ev.start?.date;
      if (isAllDay) {
        startsAt.setHours(9, 0, 0, 0);
        endsAt.setHours(17, 0, 0, 0);
      }

      const privateProps = ev.extendedProperties?.private as Record<string, string> | undefined;
      const sourceFlag = privateProps?.source;
      const bookingId = privateProps?.bookingId;

      if (sourceFlag === "arohabookings" && bookingId) {
        const appt = await prisma.appointment.findUnique({
          where: { id: bookingId },
          select: { id: true, startsAt: true, endsAt: true, externalCalendarEventId: true },
        });
        if (appt) {
          const needsTimeUpdate =
            appt.startsAt.getTime() !== startsAt.getTime() || appt.endsAt.getTime() !== endsAt.getTime();
          await prisma.appointment.update({
            where: { id: appt.id },
            data: {
              ...(needsTimeUpdate ? { startsAt, endsAt } : {}),
              externalProvider: "google",
              externalCalendarEventId: eventId,
              externalCalendarId: calendarId,
              syncedAt: new Date(),
            },
          });
        }
        continue;
      }

      const existing = busyByEventId.get(eventId);
      if (existing) {
        if (existing.startsAt.getTime() !== startsAt.getTime() || existing.endsAt.getTime() !== endsAt.getTime()) {
          await prisma.appointment.update({
            where: { id: existing.id },
            data: {
              startsAt,
              endsAt,
              customerName: ev.summary || "Google busy",
              customerPhone: "",
              source: `google-busy:${eventId}`,
            },
          });
        }
        continue;
      }

      await prisma.appointment.create({
        data: {
          orgId,
          startsAt,
          endsAt,
          customerName: ev.summary || "Google busy",
          customerPhone: "",
          status: "SCHEDULED",
          source: `google-busy:${eventId}`,
        },
      });
    }

    const os = await prisma.orgSettings.findUnique({ where: { orgId }, select: { data: true } });
    const next = writeGoogleCalendarIntegration(
      (os?.data as Record<string, unknown>) || {},
      { lastSyncAt: new Date().toISOString(), lastSyncError: null }
    );
    await prisma.orgSettings.upsert({
      where: { orgId },
      create: { orgId, data: next as any },
      update: { data: next as any },
    });
  } catch (err) {
    console.error("Error in Google -> Aroha calendar sync:", err);
    try {
      const existing = await prisma.orgSettings.findUnique({ where: { orgId }, select: { data: true } });
      const data = (existing?.data as Record<string, unknown>) || {};
      const next = writeGoogleCalendarIntegration(data, {
        lastSyncError: err instanceof Error ? err.message : "Google sync failed",
        lastSyncAt: new Date().toISOString(),
      });
      await prisma.orgSettings.update({ where: { orgId }, data: { data: next as any } });
    } catch {}
  }
}
