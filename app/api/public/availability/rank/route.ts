import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAvailability } from "@/lib/availability/index";
import { rankSlots } from "@/lib/availability/intelligence";

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

function tzOffsetMs(date: Date, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);

  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const asUTC = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second)
  );
  return asUTC - date.getTime();
}

function parseDateInTz(value: string, tz: string, endOfDay = false) {
  if (!value) return null;
  if (value.includes("T")) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  const base = new Date(
    Date.UTC(
      y,
      m - 1,
      d,
      endOfDay ? 23 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 59 : 0
    )
  );
  const offset = tzOffsetMs(base, tz);
  return new Date(base.getTime() - offset);
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
  const fromRaw = (url.searchParams.get("from") || "").trim();
  const toRaw = (url.searchParams.get("to") || "").trim();
  const serviceId = (url.searchParams.get("serviceId") || "").trim() || undefined;
  const staffId = (url.searchParams.get("staffId") || "").trim() || undefined;

  if (!orgSlug || !fromRaw || !toRaw) {
    return json({ ok: false, error: "Missing orgSlug/from/to" }, 400);
  }

  const org = await prisma.organization.findUnique({
    where: { slug: orgSlug },
    select: { id: true, timezone: true },
  });
  if (!org) {
    return json({ ok: false, error: "Organization not found" }, 404);
  }

  const from = parseDateInTz(fromRaw, org.timezone, false);
  const to = parseDateInTz(toRaw, org.timezone, true);
  if (!from || !to) {
    return json({ ok: false, error: "Invalid date format" }, 400);
  }

  const availability = await getAvailability({
    orgId: org.id,
    from,
    to,
    serviceId,
    staffId,
    tz: org.timezone,
  });

  const ranked = await rankSlots({ orgId: org.id, slots: availability.slots });

  return json({
    ok: true,
    slots: availability.slots,
    rankedSlots: ranked,
    meta: availability.meta,
  });
}
