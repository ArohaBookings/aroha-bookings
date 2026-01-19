// FILE MAP: app layout at app/layout.tsx; Retell webhook at app/api/webhooks/voice/[provider]/[orgId]/route.ts.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSessionOrgFeature } from "@/lib/entitlements";
import { generateText, hasAI } from "@/lib/ai/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

function buildBookingUrl(orgSlug: string) {
  const base = (process.env.NEXT_PUBLIC_APP_URL || "").trim();
  const path = `/book/${orgSlug}`;
  if (!base) return path;
  const clean = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${clean}${path}`;
}

export async function POST(req: Request) {
  const auth = await requireSessionOrgFeature("callsInbox");
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const body = (await req.json().catch(() => ({}))) as {
    callId?: string;
    rewrite?: boolean;
  };
  const callId = String(body.callId || "").trim();
  if (!callId) return json({ ok: false, error: "Missing callId" }, 400);

  const call = await prisma.callLog.findFirst({
    where: { orgId: auth.orgId, OR: [{ id: callId }, { callId }] },
    include: { org: { select: { name: true, slug: true } } },
  });
  if (!call) return json({ ok: false, error: "Call not found" }, 404);

  const orgName = call.org?.name || "our team";
  const bookingUrl = call.org?.slug ? buildBookingUrl(call.org.slug) : "";

  const customer = call.callerPhone
    ? await prisma.customer.findUnique({
        where: { orgId_phone: { orgId: auth.orgId, phone: call.callerPhone } },
        select: { id: true, name: true, email: true, phone: true },
      })
    : null;
  const profile = customer
    ? await prisma.clientProfile.findUnique({
        where: { customerId: customer.id },
        select: { preferredDays: true, preferredTimes: true, tonePreference: true, notes: true },
      })
    : null;

  const recipientName = customer?.name || "there";
  const preferredDays = Array.isArray(profile?.preferredDays) ? profile?.preferredDays : [];
  const preferredTimes = Array.isArray(profile?.preferredTimes) ? profile?.preferredTimes : [];
  const prefsLine =
    preferredDays.length || preferredTimes.length
      ? `We can prioritize ${[...preferredDays, ...preferredTimes].join(", ")}.`
      : "";
  const smsDraft = `Hi ${recipientName}, sorry we missed your call to ${orgName}. Book here: ${bookingUrl}.${prefsLine ? ` ${prefsLine}` : ""} Reply if you'd like us to call you back.`;
  const emailSubject = "Sorry we missed your call — quick booking link";
  let emailBody = [
    `Hi ${recipientName},`,
    "",
    `Sorry we missed your call to ${orgName}. You can grab a time here: ${bookingUrl}.`,
    prefsLine || null,
    "",
    "If you'd prefer, reply with your preferred time and we'll call you back.",
    "",
    "Thanks,",
    orgName,
  ]
    .filter((line) => line !== null)
    .join("\n");

  let aiRewritten = false;
  if (body.rewrite && auth.entitlements?.features.emailAi && hasAI()) {
    const prompt = [
      "Rewrite the message below to be concise and warm.",
      "Do not add new facts, links, or promises.",
      "Keep the booking URL intact.",
      "Message:",
      emailBody,
    ].join("\n");
    const rewritten = await generateText(prompt);
    if (rewritten) {
      emailBody = rewritten;
      aiRewritten = true;
    }
  }

  return json({
    ok: true,
    draft: {
      toName: recipientName,
      toEmail: customer?.email || null,
      toPhone: customer?.phone || call.callerPhone || null,
      sms: smsDraft,
      emailSubject,
      emailBody,
      bookingUrl,
      aiRewritten,
    },
  });
}
