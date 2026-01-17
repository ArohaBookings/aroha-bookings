import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { buildCustomerTimeline } from "@/lib/timeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
  }

  const membership = await prisma.membership.findFirst({
    where: { user: { email: session.user.email } },
    select: { orgId: true },
    orderBy: { orgId: "asc" },
  });

  if (!membership?.orgId) {
    return NextResponse.json({ ok: false, error: "No organization" }, { status: 400 });
  }

  const url = new URL(req.url);
  const phone = (url.searchParams.get("phone") || "").trim();
  const email = (url.searchParams.get("email") || "").trim();
  const customerId = (url.searchParams.get("customerId") || "").trim();

  if (!phone && !email && !customerId) {
    return NextResponse.json({ ok: false, error: "Missing phone/email/customerId" }, { status: 400 });
  }

  const timeline = await buildCustomerTimeline({
    orgId: membership.orgId,
    phone: phone || undefined,
    email: email || undefined,
    customerId: customerId || undefined,
  });

  return NextResponse.json({ ok: true, timeline });
}
