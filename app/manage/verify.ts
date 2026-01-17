import { prisma } from "@/lib/db";
import { verifyManageToken } from "@/lib/manage/token";
import { createHash } from "crypto";

export type ManageContext = {
  appointment: {
    id: string;
    orgId: string;
    startsAt: Date;
    endsAt: Date;
    status: "SCHEDULED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
    customerName: string;
    customerPhone: string;
    customerEmail: string | null;
    staffId: string | null;
    serviceId: string | null;
    externalProvider: string | null;
    externalCalendarId: string | null;
    externalCalendarEventId: string | null;
    syncedAt: Date | null;
    org: { id: string; name: string; slug: string; timezone: string };
    staff: { id: string; name: string } | null;
    service: { id: string; name: string; durationMin: number } | null;
  };
};

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function getManageContext(token: string) {
  const payload = verifyManageToken(token);
  if (!payload) {
    return { ok: false, error: "Invalid or expired manage link" } as const;
  }

  const appointment = await prisma.appointment.findUnique({
    where: { id: payload.appointmentId },
    include: {
      org: { select: { id: true, name: true, slug: true, timezone: true } },
      staff: { select: { id: true, name: true } },
      service: { select: { id: true, name: true, durationMin: true } },
    },
  });

  if (!appointment) {
    return { ok: false, error: "Booking not found" } as const;
  }

  const settings = await prisma.orgSettings.findUnique({
    where: { orgId: appointment.orgId },
    select: { data: true },
  });

  const data = (settings?.data as Record<string, unknown>) || {};
  const tokens =
    (data.manageTokens as Record<
      string,
      { hash: string; expiresAt: string }
    >) ?? {};

  const record = tokens[appointment.id];
  if (!record) {
    return { ok: false, error: "Manage link expired" } as const;
  }

  const now = Date.now();
  const expired = new Date(record.expiresAt).getTime() < now;
  const hashMatches = record.hash === hashToken(token);

  if (!hashMatches || expired) {
    return { ok: false, error: "Manage link expired" } as const;
  }

  return { ok: true, appointment } as const;
}
