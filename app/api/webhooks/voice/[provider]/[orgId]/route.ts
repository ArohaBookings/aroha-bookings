// FILE MAP: app layout at app/layout.tsx; Retell webhook at app/api/webhooks/voice/[provider]/[orgId]/route.ts.
// app/api/webhooks/voice/[provider]/[orgId]/route.ts
import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/db";
import {
  parseRetellPayload,
  touchLastWebhook,
  touchLastWebhookError,
  upsertRetellCall,
} from "@/lib/retell/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/* ──────────────────────────────────────────────
   RATE LIMIT (best-effort, in-memory per IP)
────────────────────────────────────────────── */
const callsByIp = new Map<string, { last: number; count: number }>();
function rateLimit(ip: string, maxPerMinute = 180) {
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

function parseSignatureHeader(header: string | null): { signatures: string[]; timestamp: string | null } {
  if (!header) return { signatures: [], timestamp: null };
  const parts = header.split(",").map((p) => p.trim()).filter(Boolean);
  const signatures: string[] = [];
  let timestamp: string | null = null;
  if (parts.length === 0) return { signatures, timestamp };
  for (const part of parts) {
    const [k, v] = part.split("=").map((s) => s.trim());
    if (!v) {
      signatures.push(part);
      continue;
    }
    if (k === "t") timestamp = v;
    if (k === "v1" || k === "sig" || k === "signature") signatures.push(v);
  }
  if (signatures.length === 0) signatures.push(header.trim());
  return { signatures, timestamp };
}

function safeCompare(a: string, b: string) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function verifySignature(rawBody: string, signatureHeader: string | null, secret: string, tsHeader: string | null) {
  if (!signatureHeader || !secret) return false;
  const { signatures, timestamp } = parseSignatureHeader(signatureHeader);
  const now = Date.now();
  const ts = timestamp || tsHeader;
  if (ts) {
    const tsMs = Number(ts) * 1000;
    if (!Number.isNaN(tsMs) && Math.abs(now - tsMs) > 5 * 60_000) return false;
  }

  const hmac = (input: string, encoding: "hex" | "base64") =>
    createHmac("sha256", secret).update(input).digest(encoding);
  const expectedHex = hmac(rawBody, "hex");
  const expectedBase64 = hmac(rawBody, "base64");

  return signatures.some((sig) => safeCompare(sig, expectedHex) || safeCompare(sig, expectedBase64));
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ provider: string; orgId: string }> }
) {
  let scopedOrgId: string | null = null;
  try {
    const { provider, orgId } = await params;
    scopedOrgId = orgId;
    const providerKey = (provider || "").toLowerCase();

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      (req as { ip?: string }).ip ||
      "0.0.0.0";
    if (!rateLimit(ip, 180)) {
      return NextResponse.json({ ok: false, error: "Rate limit" }, { status: 429 });
    }

    const rawBody = await req.text();
    if (!rawBody) {
      return NextResponse.json({ ok: false, error: "Missing body" }, { status: 400 });
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
    }

    if (providerKey !== "retell") {
      return NextResponse.json({ ok: false, error: "Unsupported provider" }, { status: 400 });
    }

    const parsed = parseRetellPayload(payload, req.headers);
    if (!parsed?.agentId) {
      return NextResponse.json({ ok: false, error: "Missing agentId" }, { status: 400 });
    }

    const connection = await prisma.retellConnection.findFirst({
      where: { orgId, agentId: parsed.agentId, active: true },
      select: { orgId: true, webhookSecret: true },
    });
    if (!connection) {
      return NextResponse.json({ ok: false, error: "Unknown agent" }, { status: 401 });
    }

    const signatureHeader =
      req.headers.get("x-retell-signature") || req.headers.get("retell-signature");
    const tsHeader = req.headers.get("x-retell-timestamp");
    const signatureOk = verifySignature(rawBody, signatureHeader, connection.webhookSecret, tsHeader);
    const enforceSignature = Boolean(connection.webhookSecret) && process.env.NODE_ENV === "production";
    if (!signatureOk && enforceSignature) {
      return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 401 });
    }

    if (!parsed.callId) {
      return NextResponse.json({ ok: false, error: "Missing callId" }, { status: 400 });
    }
    await upsertRetellCall(connection.orgId, parsed);
    await touchLastWebhook(connection.orgId);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    console.error("voice.webhook error:", e);
    if (scopedOrgId) {
      const message = e instanceof Error ? e.message : "Webhook error";
      try {
        await touchLastWebhookError(scopedOrgId, message);
      } catch {
        // ignore error tracking failures
      }
    }
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}
