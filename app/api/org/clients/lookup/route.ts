import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getMembershipContext } from "@/app/api/org/appointments/utils";

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
  const auth = await getMembershipContext();
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const url = new URL(req.url);
  const email = (url.searchParams.get("email") || "").trim().toLowerCase();
  const phone = (url.searchParams.get("phone") || "").trim();

  if (!email && !phone) {
    return json({ ok: false, error: "Missing email or phone" }, 400);
  }

  const customer = await prisma.customer.findFirst({
    where: {
      orgId: auth.orgId,
      ...(email ? { email: { equals: email, mode: "insensitive" } } : {}),
      ...(phone ? { phone: { contains: phone } } : {}),
    },
    select: { id: true, name: true, email: true, phone: true },
  });

  if (!customer) {
    return json({ ok: false, error: "Not found" }, 404);
  }

  return json({ ok: true, customer });
}
