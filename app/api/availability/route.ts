// app/api/availability/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getAvailability } from "@/lib/availability/index";




export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return json({ ok: false, error: "Not authenticated" }, 401);
  }

  const membership = await prisma.membership.findFirst({
    where: { user: { email: session.user.email } },
    select: { orgId: true },
    orderBy: { orgId: "asc" },
  });
  if (!membership) {
    return json({ ok: false, error: "No organization" }, 400);
  }

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const serviceId = url.searchParams.get("serviceId") || undefined;
  const staffId = url.searchParams.get("staffId") || undefined;

  if (!from || !to) {
    return json({ ok: false, error: "Missing from/to" }, 400);
  }

  const fromDate = new Date(from);
  const toDate = new Date(to);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    return json({ ok: false, error: "Invalid date format" }, 400);
  }

  const data = await getAvailability({
    orgId: membership.orgId,
    from: fromDate,
    to: toDate,
    serviceId,
    staffId,
  });

  return json({ ok: true, ...data });
}
