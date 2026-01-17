import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getMembershipContext } from "@/app/api/org/appointments/utils";
import { generateText, hasAI } from "@/lib/ai/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

type RecoveryItem = {
  type: "missed_call" | "no_show" | "abandoned";
  target: string;
  timing: string;
  message: string;
  ai: boolean;
};

function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export async function GET() {
  const auth = await getMembershipContext();
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const settings = await prisma.orgSettings.findUnique({
    where: { orgId: auth.orgId },
    select: { data: true },
  });
  const data = (settings?.data as Record<string, unknown>) || {};
  const recovery = (data.recovery as Record<string, unknown>) || {};
  const voice = (data.aiVoice as Record<string, unknown>) || {};
  const tone = (voice.tone as string) || "friendly, concise";

  const now = Date.now();
  const since = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const items: RecoveryItem[] = [];

  if (recovery.enableMissedCalls !== false) {
    const calls = await prisma.callLog.findMany({
      where: {
        orgId: auth.orgId,
        outcome: { in: ["NO_ANSWER", "BUSY", "FAILED"] },
        startedAt: { gte: since },
      },
      orderBy: { startedAt: "desc" },
      take: 5,
      select: { callerPhone: true, startedAt: true },
    });

    for (const call of calls) {
      const base = `Kia ora, we missed your call. Would you like to book a time that suits?`;
      let message = base;
      let ai = false;
      if (hasAI()) {
        const text = await generateText(
          `Rewrite this missed-call follow-up in a ${tone} tone, 1-2 sentences:\n${base}`
        );
        if (text) {
          message = text;
          ai = true;
        }
      }
      items.push({
        type: "missed_call",
        target: call.callerPhone,
        timing: "Send within 1 hour",
        message,
        ai,
      });
    }
  }

  if (recovery.enableNoShow !== false) {
    const noShows = await prisma.appointment.findMany({
      where: {
        orgId: auth.orgId,
        status: "NO_SHOW",
        startsAt: { gte: since },
      },
      orderBy: { startsAt: "desc" },
      take: 5,
      select: { customerName: true, customerPhone: true, startsAt: true },
    });

    for (const appt of noShows) {
      const base = `Kia ora ${appt.customerName || ""}, we missed you today. Want to reschedule for another time?`;
      let message = base.trim();
      let ai = false;
      if (hasAI()) {
        const text = await generateText(
          `Rewrite this no-show recovery message in a ${tone} tone, 1-2 sentences:\n${base}`
        );
        if (text) {
          message = text;
          ai = true;
        }
      }
      items.push({
        type: "no_show",
        target: appt.customerPhone,
        timing: "Send within 4 hours",
        message,
        ai,
      });
    }
  }

  return json({ ok: true, items, abandonedDetected: false });
}
