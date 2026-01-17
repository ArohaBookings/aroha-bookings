import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { explainAvailability } from "@/lib/availability/intelligence";

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
  const startISO = (url.searchParams.get("start") || "").trim();
  const endISO = (url.searchParams.get("end") || "").trim();
  const staffId = (url.searchParams.get("staffId") || "").trim() || null;

  if (!orgSlug || !startISO || !endISO) {
    return json({ ok: false, error: "Missing orgSlug/start/end" }, 400);
  }

  const start = new Date(startISO);
  const end = new Date(endISO);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return json({ ok: false, error: "Invalid start/end" }, 400);
  }

  const org = await prisma.organization.findUnique({
    where: { slug: orgSlug },
    select: { id: true },
  });
  if (!org) {
    return json({ ok: false, error: "Organization not found" }, 404);
  }

  const result = await explainAvailability({
    orgId: org.id,
    start,
    end,
    staffId,
  });

  return json({
    ok: true,
    available: result.available,
    reasons: result.reasons,
    explanation: result.explanation,
    ai: result.ai,
  });
}
