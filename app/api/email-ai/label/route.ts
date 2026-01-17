// app/api/email-ai/label/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
    }

    const payload = (await req.json()) as { ids?: string[]; label?: string };
    const ids = Array.isArray(payload?.ids) ? payload.ids.filter(Boolean) : [];
    const label = (payload?.label || "").trim();

    if (!ids.length || !label) {
      return NextResponse.json({ ok: false, error: "Missing ids or label" }, { status: 400 });
    }

    const membership = await prisma.membership.findFirst({
      where: { user: { email: session.user.email } },
      select: { orgId: true },
      orderBy: { orgId: "asc" },
    });

    if (!membership?.orgId) {
      return NextResponse.json({ ok: false, error: "No organization" }, { status: 400 });
    }

    const logs = await prisma.emailAILog.findMany({
      where: { id: { in: ids }, orgId: membership.orgId },
      select: { id: true, rawMeta: true },
    });

    await Promise.all(
      logs.map((log) => {
        const prev = (log.rawMeta as Record<string, unknown>) || {};
        const existing = Array.isArray(prev.labels) ? (prev.labels as string[]) : [];
        const next = Array.from(new Set([...existing, label]));
        return prisma.emailAILog.update({
          where: { id: log.id },
          data: {
            rawMeta: {
              ...prev,
              labels: next,
            } as any,
          },
        });
      })
    );

    return NextResponse.json({ ok: true, updated: logs.length });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Server error" },
      { status: 500 }
    );
  }
}
