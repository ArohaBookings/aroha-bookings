import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { predictDuration } from "@/lib/availability/intelligence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const callsByIp = new Map<string, { last: number; count: number }>();
function rateLimit(ip: string, maxPerMinute = 60) {
  const now = Date.now();
  const m = callsByIp.get(ip) || { last: now, count: 0 };
  if (now - m.last > 60_000) {
    m.last = now;
    m.count = 0;
  }
  m.count++;
  callsByIp.set(ip, m);
  return m.count <= maxPerMinute;
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export async function GET(req: Request) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    (req as { ip?: string }).ip ||
    "0.0.0.0";
  if (!rateLimit(ip, 80)) {
    return json({ ok: false, error: "Rate limit" }, 429);
  }

  const url = new URL(req.url);
  const orgSlug = (url.searchParams.get("orgSlug") || "").trim();
  const serviceId = (url.searchParams.get("serviceId") || "").trim();

  if (!orgSlug || !serviceId) {
    return json({ ok: false, error: "Missing orgSlug/serviceId" }, 400);
  }

  const org = await prisma.organization.findUnique({
    where: { slug: orgSlug },
    select: { id: true },
  });
  if (!org) {
    return json({ ok: false, error: "Organization not found" }, 404);
  }

  const result = await predictDuration({ orgId: org.id, serviceId });
  if (!result) {
    return json({ ok: false, error: "Service not found" }, 404);
  }

  return json({ ok: true, ...result });
}
