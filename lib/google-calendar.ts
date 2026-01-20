// lib/google-calendar.ts
import { google } from "googleapis";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readGoogleCalendarIntegration } from "@/lib/orgSettings";

/* --------------------------------------------------------------------------
   GOOGLE OAUTH CLIENT FACTORY (Safe, token-shape tolerant)
   -------------------------------------------------------------------------- */

async function buildOAuthClient() {
  const session = await getServerSession(authOptions);
  const s: any = session ?? {};

  // Most common shapes:
  // - session.google.{ access_token, refresh_token, expires_at }
  // - session.{ accessToken, refreshToken, expiresAt }
  // - session.token?.{ accessToken, refreshToken, expiresAt }
  const g = s.google ?? {};

  const accessToken: string | null =
    g.access_token ??
    g.accessToken ??
    s.accessToken ??
    s.token?.accessToken ??
    null;

  const refreshToken: string | undefined =
    g.refresh_token ??
    g.refreshToken ??
    s.refreshToken ??
    s.token?.refreshToken ??
    undefined;

  const expiresAtRaw: number | undefined =
    typeof g.expires_at === "number"
      ? g.expires_at
      : typeof g.expiresAt === "number"
      ? g.expiresAt
      : typeof s.expires_at === "number"
      ? s.expires_at
      : typeof s.expiresAt === "number"
      ? s.expiresAt
      : undefined;

  if (!accessToken) {
    // IMPORTANT: do NOT throw. Just log once and allow callers to no-op.
    console.warn(
      "[google-calendar] No usable Google access token on session. " +
        "Google Calendar operations will be skipped for this request.",
    );
    return null;
  }

  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
  );

  oauth2.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
    // googleapis expects ms epoch
    expiry_date: typeof expiresAtRaw === "number" ? expiresAtRaw : undefined,
  });

  return oauth2;
}

/* --------------------------------------------------------------------------
   GOOGLE CALENDAR CLIENT (May return null if not available)
   -------------------------------------------------------------------------- */

export async function getGCal() {
  const auth = await buildOAuthClient();
  if (!auth) return null;
  return google.calendar({ version: "v3", auth });
}

/* --------------------------------------------------------------------------
   HELPERS
   -------------------------------------------------------------------------- */

/** Extract google eventId from appointment.source if present. */
function extractGoogleEventId(source?: string | null): string | null {
  if (!source) return null;
  const match = source.match(/^google-sync:(.+)$/);
  return match?.[1] ?? null;
}

/** Build calendar title consistently */
function buildTitle(appt: any) {
  const service = appt.service?.name ?? "Appointment";
  const staff = appt.staff?.name ? ` · ${appt.staff.name}` : "";
  return `${service} — ${appt.customerName}${staff}`;
}

/** Resolve org's Google calendarId from OrgSettings.data, or null */
async function getOrgCalendarId(orgId: string): Promise<string | null> {
  const os = await prisma.orgSettings.findUnique({
    where: { orgId },
    select: { data: true },
  });

  const data = (os?.data as Record<string, unknown>) ?? {};
  const google = readGoogleCalendarIntegration(data);
  if (!google.syncEnabled || !google.connected) return null;
  return google.calendarId || null;
}

/* --------------------------------------------------------------------------
   PUSH (CREATE) APPOINTMENT → GOOGLE CALENDAR
   -------------------------------------------------------------------------- */

export async function pushAppointmentToGoogle(appointmentId: string) {
  try {
    const appt = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { org: true, service: true, staff: true },
    });
    if (!appt) return;

    const calendarId = await getOrgCalendarId(appt.orgId);
    if (!calendarId) return; // org not connected

    // Already synced → don't duplicate
    const existing = extractGoogleEventId(appt.source);
    if (existing) return;

    const gcal = await getGCal();
    if (!gcal) return; // no usable Google client this request

    const description = [
      (appt as any).notes || "",
      "Created by Aroha Bookings",
      `Booking ID: ${appt.id}`,
      appt.org?.name ? `Organization: ${appt.org.name}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const event = {
      summary: buildTitle(appt),
      description,
      start: { dateTime: appt.startsAt.toISOString() },
      end: { dateTime: appt.endsAt.toISOString() },
      attendees: (appt as any).customerEmail
        ? [{ email: (appt as any).customerEmail }]
        : undefined,
      extendedProperties: {
        private: { source: "arohabookings", bookingId: appt.id },
      },
    };

    const res = await gcal.events.insert({
      calendarId,
      requestBody: event,
    });

    const eventId = res.data.id || "";
    if (!eventId) return;

    // Save eventId → appointment.source
    await prisma.appointment.update({
      where: { id: appointmentId },
      data: { source: `google-sync:${eventId}` },
    });
  } catch (err) {
    console.error("pushAppointmentToGoogle failed:", err);
    // never throw — Aroha must continue
  }
}

/* --------------------------------------------------------------------------
   UPDATE APPOINTMENT → GOOGLE CALENDAR
   -------------------------------------------------------------------------- */

export async function updateAppointmentInGoogle(appointmentId: string) {
  try {
    const appt = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { org: true, service: true, staff: true },
    });
    if (!appt) return;

    const calendarId = await getOrgCalendarId(appt.orgId);
    if (!calendarId) return;

    const eventId = extractGoogleEventId(appt.source);
    if (!eventId) return; // appointment was never synced

    const gcal = await getGCal();
    if (!gcal) return;

    const description = [
      (appt as any).notes || "",
      "Created by Aroha Bookings",
      `Booking ID: ${appt.id}`,
      appt.org?.name ? `Organization: ${appt.org.name}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const patch = {
      summary: buildTitle(appt),
      description,
      start: { dateTime: appt.startsAt.toISOString() },
      end: { dateTime: appt.endsAt.toISOString() },
      attendees: (appt as any).customerEmail
        ? [{ email: (appt as any).customerEmail }]
        : undefined,
      extendedProperties: {
        private: { source: "arohabookings", bookingId: appt.id },
      },
    };

    await gcal.events.patch({
      calendarId,
      eventId,
      requestBody: patch,
    });
  } catch (err) {
    console.error("updateAppointmentInGoogle failed:", err);
  }
}

/* --------------------------------------------------------------------------
   DELETE APPOINTMENT → GOOGLE CALENDAR
   -------------------------------------------------------------------------- */

export async function deleteAppointmentFromGoogle(appointmentId: string) {
  try {
    const appt = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: { orgId: true, source: true },
    });
    if (!appt) return;

    const calendarId = await getOrgCalendarId(appt.orgId);
    if (!calendarId) return;

    const eventId = extractGoogleEventId(appt.source);
    if (!eventId) return;

    const gcal = await getGCal();
    if (!gcal) return;

    await gcal.events.delete({
      calendarId,
      eventId,
    });
  } catch (err) {
    console.error("deleteAppointmentFromGoogle failed:", err);
  }
}

/* --------------------------------------------------------------------------
   GOOGLE → AROHA HOOK (for CalendarPage range import)
   -------------------------------------------------------------------------- */

/**
 * List raw Google events for a given calendar + time range.
 * CalendarPage / syncGoogleToArohaRange uses this to import blocks.
 */
export async function listGoogleEvents(
  calendarId: string,
  timeMin: string,
  timeMax: string,
) {
  try {
    const gcal = await getGCal();
    if (!gcal) return [];

    const res = await gcal.events.list({
      calendarId,
      singleEvents: true,
      orderBy: "startTime",
      timeMin,
      timeMax,
    });

    return res.data.items ?? [];
  } catch (err) {
    console.error("listGoogleEvents failed:", err);
    return [];
  }
}
