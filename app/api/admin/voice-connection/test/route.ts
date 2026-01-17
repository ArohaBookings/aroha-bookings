// app/api/admin/voice-connection/test/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createHmac, randomBytes } from "crypto";

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

function sign(body: string, secret: string) {
  return createHmac("sha256", secret).update(body).digest("hex");
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

  const connection = await prisma.retellConnection.findFirst({
    where: { orgId, agentId },
    select: { webhookSecret: true, active: true },
  });
  if (!connection || !connection.active) {
    return json({ ok: false, error: "Active connection not found" }, 404);
  }

  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || "").trim();
  if (!baseUrl) {
    return json({ ok: false, error: "NEXT_PUBLIC_APP_URL is not configured" }, 400);
  }

  const callId = `test_${Date.now()}_${randomBytes(4).toString("hex")}`;
  const payload = {
    call_id: callId,
    agent_id: agentId,
    started_at: new Date(Date.now() - 90_000).toISOString(),
    ended_at: new Date().toISOString(),
    caller_phone: "+64210000000",
    transcript: "This is a test webhook payload for Retell.",
    outcome: "COMPLETED",
  };

const rawBody = JSON.stringify(payload);
const signature = sign(rawBody, connection.webhookSecret);

const cleanBaseUrl = baseUrl.endsWith("/")
  ? baseUrl.slice(0, -1)
  : baseUrl;

const targetUrl = `${cleanBaseUrl}/api/webhooks/voice/retell/${orgId}`;


  const resp = await fetch(targetUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-retell-signature": signature,
      "x-retell-agent-id": agentId,
    },
    body: rawBody,
  });

  const result = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    return json({ ok: false, error: "Webhook call failed", status: resp.status, result }, 502);
  }

  return json({ ok: true, result });
}
