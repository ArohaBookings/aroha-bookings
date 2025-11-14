import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ ok:false, error:"Not authenticated" }, { status:401 });

  const { calendarId } = await req.json();
  if (!calendarId) return NextResponse.json({ ok:false, error:"Missing calendarId" }, { status:400 });

  // find org for this user (first membership wins)
  const m = await prisma.membership.findFirst({
    where: { user: { email: session.user.email } },
    select: { orgId: true },
    orderBy: { orgId: "asc" },
  });
  if (!m?.orgId) return NextResponse.json({ ok:false, error:"No organization" }, { status:400 });

  // upsert a connection row (one per org/provider/email)
  const accountEmail = session.user.email;
  const row = await prisma.calendarConnection.upsert({
    where: { orgId_provider_accountEmail: { orgId: m.orgId, provider: "google", accountEmail } },
    update: { updatedAt: new Date() },
    create: {
      orgId: m.orgId,
      provider: "google",
      accountEmail,
      accessToken: "session", // we’re using NextAuth session tokens (no DB store)
      refreshToken: "session",
      expiresAt: new Date(Date.now() + 3600_000),
    },
  });

  // stash chosen calendarId inside OrgSettings JSON to keep schema stable
  const current = await prisma.orgSettings.upsert({
    where: { orgId: m.orgId },
    create: { orgId: m.orgId, data: {} },
    update: {},
  });

  const data = (current.data as any) || {};
  data.googleCalendarId = calendarId;

  await prisma.orgSettings.update({
    where: { orgId: m.orgId },
    data: { data },
  });

  return NextResponse.json({ ok:true, connectionId: row.id, calendarId });
}
