// app/api/email-ai/skip/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const Body = z.object({
  logId: z.string().min(1),
  reason: z.string().max(500).optional(), // optional operator note
});

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
    }

    // 1) Validate body
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid body", issues: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const { logId, reason } = parsed.data;

    // 2) Fetch log and enforce org access
    const log = await prisma.emailAILog.findUnique({ where: { id: logId } });
    if (!log) {
      return NextResponse.json({ ok: false, error: "Log not found" }, { status: 404 });
    }

    const membership = await prisma.membership.findFirst({
      where: { user: { email: session.user.email }, orgId: log.orgId },
      select: { orgId: true },
    });
    if (!membership) {
      return NextResponse.json({ ok: false, error: "No access to this organization" }, { status: 403 });
    }

    // 3) Idempotency: if already terminal, just echo current state
    const terminal = new Set(["skipped_blocked", "auto_sent"]);
    if (terminal.has(log.action ?? "")) {
      return NextResponse.json({ ok: true, log });
    }

    // 4) Update as skipped and append audit trail
    const previousMeta = ((log.rawMeta as any) ?? {});
    const previousAudit = Array.isArray(previousMeta.audit) ? previousMeta.audit : [];

    const updated = await prisma.emailAILog.update({
      where: { id: logId },
      data: {
        action: "skipped_blocked",                 // keep consistent with UI filters
        reason: reason || "manually skipped",
        rawMeta: {
          ...previousMeta,
          audit: [
            ...previousAudit,
            {
              at: new Date().toISOString(),
              by: session.user.email,
              action: "skipped_blocked",
              reason: reason || "manually skipped",
            },
          ],
        } as any,
      },
    });

    return NextResponse.json({ ok: true, log: updated });
  } catch (err: any) {
    console.error("email-ai/skip error:", err);
    return NextResponse.json({ ok: false, error: err?.message ?? "Skip failed" }, { status: 500 });
  }
}
