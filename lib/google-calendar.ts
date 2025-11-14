// lib/google-calendar.ts
import { google } from "googleapis";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * Build a Google Calendar client using the Google tokens we store on the NextAuth session.
 * This relies on your Google provider having access_type=offline + prompt=consent.
 */
export async function getGCal() {
  const session = await getServerSession(authOptions);
  const g = (session as any)?.google ?? {};

  if (!g?.access_token) {
    throw new Error("No Google access token on session. Connect Google first.");
  }

  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
  );

  oauth2.setCredentials({
    access_token: g.access_token as string,
    refresh_token: g.refresh_token as string | undefined,
    // next-auth stores ms epoch; googleapis expects ms epoch in `expiry_date`
    expiry_date: typeof g.expires_at === "number" ? g.expires_at : undefined,
  });

  return google.calendar({ version: "v3", auth: oauth2 });
}

/**
 * Push a single appointment to Google Calendar if the org has a calendarId configured.
 * Stores the created Google event id back on the appointment (in `source` string).
 */
export async function pushAppointmentToGoogle(appointmentId: string) {
  const appt = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: { org: true, service: true, staff: true },
  });
  if (!appt) return;

  // Read org settings → chosen Google calendarId lives inside org.settings.data
  const os = await prisma.orgSettings.findUnique({ where: { orgId: appt.orgId } });
  const calendarId = (os?.data as any)?.googleCalendarId as string | undefined;
  if (!calendarId) return; // not connected

  const gcal = await getGCal();

  const title = `${appt.customerName} — ${appt.service?.name ?? "Appointment"}${
    appt.staff ? ` · ${appt.staff.name}` : ""
  }`;

  const res = await gcal.events.insert({
    calendarId,
    requestBody: {
      summary: title,
      description: appt.notes || undefined,
      start: { dateTime: appt.startsAt.toISOString() },
      end: { dateTime: appt.endsAt.toISOString() },
      attendees: appt.customerEmail ? [{ email: appt.customerEmail }] : undefined,
    },
  });

  // Persist the Google event id somewhere useful (keep simple: piggyback on `source`)
  try {
    await prisma.appointment.update({
      where: { id: appointmentId },
      data: { source: `google-sync:${res.data.id ?? ""}` },
    });
  } catch {
    // ignore – optional
  }
}

/** Update a previously synced Google event (if the appointment’s source has an event id). */
export async function updateAppointmentInGoogle(appointmentId: string) {
  const appt = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: { org: true, service: true, staff: true },
  });
  if (!appt) return;

  const os = await prisma.orgSettings.findUnique({ where: { orgId: appt.orgId } });
  const calendarId = (os?.data as any)?.googleCalendarId as string | undefined;
  if (!calendarId) return;

  const match = (appt.source || "").match(/^google-sync:(.+)$/);
  const eventId = match?.[1];
  if (!eventId) return;

  const gcal = await getGCal();

  const title = `${appt.customerName} — ${appt.service?.name ?? "Appointment"}${
    appt.staff ? ` · ${appt.staff.name}` : ""
  }`;

  await gcal.events.patch({
    calendarId,
    eventId,
    requestBody: {
      summary: title,
      description: appt.notes || undefined,
      start: { dateTime: appt.startsAt.toISOString() },
      end: { dateTime: appt.endsAt.toISOString() },
      attendees: appt.customerEmail ? [{ email: appt.customerEmail }] : undefined,
    },
  });
}

/** Delete the Google event if one exists for this appointment. */
export async function deleteAppointmentFromGoogle(appointmentId: string) {
  const appt = await prisma.appointment.findUnique({ where: { id: appointmentId } });
  if (!appt) return;

  const os = await prisma.orgSettings.findUnique({ where: { orgId: appt.orgId } });
  const calendarId = (os?.data as any)?.googleCalendarId as string | undefined;
  if (!calendarId) return;

  const match = (appt.source || "").match(/^google-sync:(.+)$/);
  const eventId = match?.[1];
  if (!eventId) return;

  const gcal = await getGCal();
  await gcal.events.delete({ calendarId, eventId });
}
