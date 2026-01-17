import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

function isSuperadmin(email?: string | null): boolean {
  if (!email) return false;
  const list = (process.env.SUPERADMINS || "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.trim().toLowerCase());
}

async function requireSuperadmin() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email || null;
  if (!email) return { ok: false, error: "Not signed in", status: 401 } as const;
  if (!isSuperadmin(email)) return { ok: false, error: "Not authorized", status: 403 } as const;
  return { ok: true } as const;
}

function normalizeFeatures(input: unknown): Record<string, boolean> {
  if (!input || typeof input !== "object") return {};
  const entries = Object.entries(input as Record<string, unknown>);
  const filtered = entries
    .filter(([key, value]) => typeof key === "string" && typeof value === "boolean")
    .map(([key, value]) => [key.trim(), value]);
  return Object.fromEntries(filtered);
}

export async function POST(req: Request) {
  const auth = await requireSuperadmin();
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const orgId = typeof (body as any)?.orgId === "string" ? (body as any).orgId.trim() : "";
  if (!orgId) return json({ ok: false, error: "Missing orgId" }, 400);

  const planFeatures = normalizeFeatures((body as any)?.planFeatures);

  const existing = await prisma.orgSettings.findUnique({
    where: { orgId },
    select: { data: true },
  });
  const data = (existing?.data as Record<string, unknown>) || {};

  const next = {
    ...data,
    planFeatures,
  };

  await prisma.orgSettings.upsert({
    where: { orgId },
    create: { orgId, data: next as any },
    update: { data: next as any },
  });

  return json({ ok: true, planFeatures });
}
