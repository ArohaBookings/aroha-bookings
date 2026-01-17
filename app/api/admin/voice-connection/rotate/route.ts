// app/api/admin/voice-connection/rotate/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { randomBytes } from "crypto";

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

function newSecret() {
  return `whsec_${randomBytes(24).toString("hex")}`;
}

export async function POST(req: Request) {
  const auth = await requireSuperadmin();
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const body = (await req.json().catch(() => ({}))) as {
    orgId?: string;
    provider?: string;
    agentId?: string;
  };

  const orgId = (body.orgId || "").trim();
  const provider = (body.provider || "").trim().toLowerCase();
  const agentId = (body.agentId || "").trim();

  if (!orgId || !provider || !agentId) {
    return json({ ok: false, error: "Missing required fields" }, 400);
  }

  if (provider !== "retell") {
    return json({ ok: false, error: "Unsupported provider" }, 400);
  }

  const webhookSecret = newSecret();

  const connection = await prisma.retellConnection.update({
    where: { orgId_agentId: { orgId, agentId } },
    data: { webhookSecret },
    select: { id: true, orgId: true, agentId: true, webhookSecret: true, active: true },
  });

  return json({ ok: true, connection });
}
