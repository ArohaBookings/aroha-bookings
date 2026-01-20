// app/api/integrations/google/disconnect/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { writeGoogleCalendarIntegration } from "@/lib/orgSettings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function isSuperadmin(email?: string | null): boolean {
  if (!email) return false;
  const list = (process.env.SUPERADMINS || "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.trim().toLowerCase());
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email || null;
  if (!email) {
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { orgId?: string; accountEmail?: string };
  const orgId = (body.orgId || "").trim();
  const accountEmail = (body.accountEmail || "").trim();

  if (!orgId) {
    return NextResponse.json({ ok: false, error: "Missing orgId" }, { status: 400 });
  }

  const isSuper = isSuperadmin(email);
  if (!isSuper) {
    const membership = await prisma.membership.findFirst({
      where: { orgId, user: { email } },
      select: { id: true },
    });
    if (!membership) {
      return NextResponse.json({ ok: false, error: "Not authorized for org" }, { status: 403 });
    }
  }

  await prisma.calendarConnection.deleteMany({
    where: {
      orgId,
      provider: "google",
      ...(accountEmail ? { accountEmail } : {}),
    },
  });

  const os = await prisma.orgSettings.findUnique({
    where: { orgId },
    select: { data: true },
  });

  if (os) {
    const data = { ...(os.data as Record<string, unknown>) };
    delete (data as any).calendarSyncErrors;
    const next = writeGoogleCalendarIntegration(data, {
      connected: false,
      calendarId: null,
      accountEmail: null,
      syncEnabled: false,
      lastSyncAt: null,
      lastSyncError: null,
    });

    await prisma.orgSettings.update({
      where: { orgId },
      data: { data: next as any },
    });
  }


  return NextResponse.json({ ok: true });
}
