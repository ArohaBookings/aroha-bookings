// app/api/email-ai/stats/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
    }
    // Find the org for the signed-in user (same pattern you used elsewhere)
    const membership = await prisma.membership.findFirst({
      where: { user: { email: session.user.email } },
      select: { orgId: true },
      orderBy: { orgId: "asc" },
    });
    if (!membership?.orgId) {
      return NextResponse.json({ ok: false, error: "No org" }, { status: 404 });
    }

    const orgId = membership.orgId;

    const [queued, drafted, sent, skipped, total] = await Promise.all([
      prisma.emailAILog.count({ where: { orgId, action: "queued_for_review" } }),
      prisma.emailAILog.count({ where: { orgId, action: "draft_created" } }),
      prisma.emailAILog.count({ where: { orgId, action: "auto_sent" } }),
      prisma.emailAILog.count({ where: { orgId, action: "skipped_blocked" } }),
      prisma.emailAILog.count({ where: { orgId } }),
    ]);

    return NextResponse.json({
      ok: true,
      orgId,
      counts: { queued, drafted, sent, skipped, total },
      ts: Date.now(),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}
