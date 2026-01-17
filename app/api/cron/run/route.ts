import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  sendFollowUpEmail,
  sendFollowUpSMS,
  sendReminderEmail,
  sendReminderSMS,
} from "@/lib/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

type AutomationRecord = {
  remindersSent?: Array<{ type: string; hoursBefore?: number; at: string; channel: string }>;
  followUpsSent?: Array<{ type: string; at: string; channel: string }>;
};

function getAutomationMap(data: Record<string, unknown>) {
  return (data.appointmentAutomation as Record<string, AutomationRecord> | undefined) || {};
}

function shouldSendReminder(
  record: AutomationRecord | undefined,
  hoursBefore: number,
  channel: string
) {
  const list = record?.remindersSent ?? [];
  return !list.some((r) => r.type === "reminder" && r.hoursBefore === hoursBefore && r.channel === channel);
}

function shouldSendFollowUp(record: AutomationRecord | undefined, channel: string) {
  const list = record?.followUpsSent ?? [];
  return !list.some((r) => r.type === "followup" && r.channel === channel);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const secret =
    req.headers.get("x-cron-secret") ||
    req.headers.get("authorization")?.replace("Bearer ", "") ||
    url.searchParams.get("secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  const [orgs, orgSettings] = await Promise.all([
    prisma.organization.findMany({
      select: { id: true, name: true, slug: true, timezone: true, dashboardConfig: true },
    }),
    prisma.orgSettings.findMany({ select: { orgId: true, data: true } }),
  ]);

  const settingsMap = new Map<string, Record<string, unknown>>();
  orgSettings.forEach((s) => settingsMap.set(s.orgId, (s.data as Record<string, unknown>) || {}));

  const now = new Date();
  const updatedOrgs: string[] = [];

  for (const org of orgs) {
    const data = settingsMap.get(org.id) ?? {};
    const notifications = (data.notifications as Record<string, unknown>) || {};
    const remindersCfg = (notifications.reminders as Record<string, unknown>) || {};
    const followUpsCfg = (notifications.followUps as Record<string, unknown>) || {};
    const dashboardConfig = (org.dashboardConfig as Record<string, unknown>) || {};
    const dashboardNotifications = (dashboardConfig.notifications as Record<string, unknown>) || {};
    const contact = (dashboardConfig.contact as Record<string, unknown>) || {};
    const orgPhone = typeof contact.phone === "string" ? contact.phone : null;
    const orgAddress = typeof contact.address === "string" ? contact.address : null;
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
    const bookingUrl = org.slug && appUrl ? `${appUrl}/book/${org.slug}` : null;

    const remindersEnabled = remindersCfg.enabled !== false;
    const followUpsEnabled = followUpsCfg.enabled === true;
    const beforeHours = Array.isArray(remindersCfg.beforeHours) && remindersCfg.beforeHours.length
      ? remindersCfg.beforeHours.map((n) => Number(n)).filter((n) => Number.isFinite(n))
      : [24, 2];

    const emailEnabled = dashboardNotifications.emailEnabled !== false;
    const smsEnabled = dashboardNotifications.smsEnabled === true;

    const automation = getAutomationMap(data);
    let changed = false;

    if (remindersEnabled && beforeHours.length > 0) {
      for (const hours of beforeHours) {
        const rangeStart = new Date(now.getTime() + (hours * 60 - 10) * 60_000);
        const rangeEnd = new Date(now.getTime() + (hours * 60 + 10) * 60_000);

        const appts = await prisma.appointment.findMany({
          where: {
            orgId: org.id,
            status: "SCHEDULED",
            startsAt: { gte: rangeStart, lte: rangeEnd },
          },
          select: {
            id: true,
            startsAt: true,
            customerName: true,
            customerEmail: true,
            customerPhone: true,
          },
        });

        for (const appt of appts) {
          const record = automation[appt.id];
          const tasks: Promise<unknown>[] = [];

          if (emailEnabled && shouldSendReminder(record, hours, "email")) {
            tasks.push(
              sendReminderEmail({
                orgId: org.id,
                orgName: org.name,
                timezone: org.timezone,
                startsAt: appt.startsAt,
                customerName: appt.customerName,
                customerEmail: appt.customerEmail,
                customerPhone: appt.customerPhone,
                orgAddress,
                orgPhone,
                bookingUrl,
              })
            );
            automation[appt.id] = {
              ...record,
              remindersSent: [
                { type: "reminder", hoursBefore: hours, at: now.toISOString(), channel: "email" },
                ...(record?.remindersSent ?? []),
              ].slice(0, 10),
            };
            changed = true;
          }

          if (smsEnabled && shouldSendReminder(record, hours, "sms")) {
            tasks.push(
              sendReminderSMS({
                orgId: org.id,
                orgName: org.name,
                timezone: org.timezone,
                startsAt: appt.startsAt,
                customerName: appt.customerName,
                customerEmail: appt.customerEmail,
                customerPhone: appt.customerPhone,
                orgAddress,
                orgPhone,
                bookingUrl,
              })
            );
            automation[appt.id] = {
              ...automation[appt.id],
              remindersSent: [
                { type: "reminder", hoursBefore: hours, at: now.toISOString(), channel: "sms" },
                ...(automation[appt.id]?.remindersSent ?? []),
              ].slice(0, 10),
            };
            changed = true;
          }

          if (tasks.length) {
            await Promise.allSettled(tasks);
          }
        }
      }
    }

    if (followUpsEnabled) {
      const rangeStart = new Date(now.getTime() - 2 * 60 * 60_000);
      const rangeEnd = new Date(now.getTime() - 30 * 60_000);

      const appts = await prisma.appointment.findMany({
        where: {
          orgId: org.id,
          status: "COMPLETED",
          endsAt: { gte: rangeStart, lte: rangeEnd },
        },
        select: {
          id: true,
          endsAt: true,
          customerName: true,
          customerEmail: true,
          customerPhone: true,
        },
      });

      for (const appt of appts) {
        const record = automation[appt.id];
        const tasks: Promise<unknown>[] = [];

        if (emailEnabled && shouldSendFollowUp(record, "email")) {
            tasks.push(
              sendFollowUpEmail({
                orgId: org.id,
                orgName: org.name,
                timezone: org.timezone,
                startsAt: appt.endsAt,
                customerName: appt.customerName,
                customerEmail: appt.customerEmail,
                customerPhone: appt.customerPhone,
                orgAddress,
                orgPhone,
                bookingUrl,
              })
            );
          automation[appt.id] = {
            ...record,
            followUpsSent: [
              { type: "followup", at: now.toISOString(), channel: "email" },
              ...(record?.followUpsSent ?? []),
            ].slice(0, 10),
          };
          changed = true;
        }

        if (smsEnabled && shouldSendFollowUp(record, "sms")) {
            tasks.push(
              sendFollowUpSMS({
                orgId: org.id,
                orgName: org.name,
                timezone: org.timezone,
                startsAt: appt.endsAt,
                customerName: appt.customerName,
                customerEmail: appt.customerEmail,
                customerPhone: appt.customerPhone,
                orgAddress,
                orgPhone,
                bookingUrl,
              })
            );
          automation[appt.id] = {
            ...automation[appt.id],
            followUpsSent: [
              { type: "followup", at: now.toISOString(), channel: "sms" },
              ...(automation[appt.id]?.followUpsSent ?? []),
            ].slice(0, 10),
          };
          changed = true;
        }

        if (tasks.length) {
          await Promise.allSettled(tasks);
        }
      }
    }

    const next = {
      ...data,
      ...(changed ? { appointmentAutomation: automation } : {}),
      cronLastRun: new Date().toISOString(),
    };
    if (changed || !data.cronLastRun) {
      await prisma.orgSettings.upsert({
        where: { orgId: org.id },
        create: { orgId: org.id, data: next as any },
        update: { data: next as any },
      });
      updatedOrgs.push(org.id);
    }
  }

  return json({ ok: true, updatedOrgs: updatedOrgs.length });
}
