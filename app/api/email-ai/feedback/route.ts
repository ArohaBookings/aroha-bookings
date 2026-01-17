import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email || null;
  if (!email) return json({ ok: false, error: "Not authenticated" }, 401);

  const membership = await prisma.membership.findFirst({
    where: { user: { email } },
    select: { orgId: true },
  });
  if (!membership?.orgId) return json({ ok: false, error: "No organization" }, 403);

  const body = (await req.json().catch(() => ({}))) as {
    logId?: string;
    action?: string;
    note?: string;
    source?: string;
  };

  const logId = (body.logId || "").trim();
  const action = (body.action || "").trim();
  if (!logId || !action) {
    return json({ ok: false, error: "Missing logId/action" }, 400);
  }

  const settings = await prisma.orgSettings.upsert({
    where: { orgId: membership.orgId },
    create: { orgId: membership.orgId, data: {} as any },
    update: {},
    select: { data: true },
  });

  const data = { ...(settings.data as Record<string, unknown>) };
  const list = Array.isArray(data.emailAIFeedback) ? data.emailAIFeedback.slice(0) : [];
  list.unshift({
    at: new Date().toISOString(),
    logId,
    action,
    note: body.note ? String(body.note).slice(0, 500) : undefined,
    source: body.source ? String(body.source).slice(0, 40) : undefined,
  });
  data.emailAIFeedback = list.slice(0, 200);

  await prisma.orgSettings.update({
    where: { orgId: membership.orgId },
    data: { data: data as any },
  });

  return json({ ok: true });
}
