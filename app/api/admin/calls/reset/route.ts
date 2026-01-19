import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canAccessSuperAdminByEmail } from "@/lib/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

async function requireSuperadmin() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email || null;
  if (!email) return { ok: false, error: "Not signed in", status: 401 } as const;
  const allowed = await canAccessSuperAdminByEmail(email);
  if (!allowed) return { ok: false, error: "Not authorized", status: 403 } as const;
  return { ok: true } as const;
}

export async function POST(req: Request) {
  const auth = await requireSuperadmin();
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const body = (await req.json().catch(() => ({}))) as { orgId?: string };
  const orgId = (body.orgId || "").trim();
  if (!orgId) return json({ ok: false, error: "Missing orgId" }, 400);

  let forwardJobsDeleted = 0;
  const forwardDelegate = (prisma as any).webhookForwardJob;
  if (forwardDelegate?.deleteMany) {
    const result = await forwardDelegate.deleteMany({ where: { orgId } });
    forwardJobsDeleted = Number(result?.count || 0);
  } else {
    try {
      const result = await prisma.$executeRawUnsafe(
        `DELETE FROM "public"."WebhookForwardJob" WHERE "orgId" = $1`,
        orgId
      );
      forwardJobsDeleted = Number(result) || 0;
    } catch {
      forwardJobsDeleted = 0;
    }
  }

  const callLogs = await prisma.callLog.deleteMany({ where: { orgId } });

  return json({
    ok: true,
    deletedCallLogs: callLogs.count,
    deletedForwardJobs: forwardJobsDeleted,
  });
}
