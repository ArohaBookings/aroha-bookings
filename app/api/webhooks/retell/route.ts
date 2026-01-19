// FILE MAP: app layout at app/layout.tsx; Retell webhook at app/api/webhooks/voice/[provider]/[orgId]/route.ts.
// app/api/webhooks/retell/route.ts
import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/db";
import {
  parseRetellPayload,
  touchLastWebhook,
  touchLastWebhookError,
  upsertRetellCall,
} from "@/lib/retell/ingest";
import {
  enqueueForwardJob,
  resolveZapierDestination,
  updateRetellWebhookTimestamp,
} from "@/lib/retell/forwardQueue";
import type { Prisma } from "@prisma/client";

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

function parseSignatureHeader(
  header: string | null
): { signatures: string[]; timestamp: string | null } {
  if (!header) return { signatures: [], timestamp: null };
  const parts = header
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  const signatures: string[] = [];
  let timestamp: string | null = null;

  for (const part of parts) {
    const [kRaw, vRaw] = part.split("=").map((s) => s.trim());
    const k = kRaw || "";
    const v = vRaw || "";

    // If it isn't key=value format, treat whole token as signature
    if (!vRaw) {
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

function verifySignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
  tsHeader: string | null
) {
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

function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  const first = xff?.split(",")[0]?.trim();
  if (first) return first;
  const maybeIp = (req as { ip?: string }).ip;
  return maybeIp || "0.0.0.0";
}

export async function POST(req: Request) {
  let orgId: string | null = null;
  try {
    const ip = getClientIp(req);
    if (!rateLimit(ip, 180)) {
      return NextResponse.json({ ok: false, error: "Rate limit" }, { status: 429 });
    }

    const rawBody = await req.text();
    if (!rawBody) {
      return NextResponse.json({ ok: false, error: "Missing body" }, { status: 400 });
    }

    let rawJson: Record<string, unknown>;
    try {
      rawJson = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
    }

    const parsed = parseRetellPayload(rawJson, req.headers);
    if (!parsed?.agentId) {
      return NextResponse.json({ ok: false, error: "Missing agentId" }, { status: 400 });
    }
    if (!parsed.callId) {
      return NextResponse.json({ ok: false, error: "Missing callId" }, { status: 400 });
    }

    const connection = await prisma.retellConnection.findFirst({
      where: { agentId: parsed.agentId, active: true },
      select: { orgId: true, webhookSecret: true },
    });

    if (!connection) {
      return NextResponse.json({ ok: false, error: "Unknown agent" }, { status: 401 });
    }
    orgId = connection.orgId;

    const signatureHeader =
      req.headers.get("x-retell-signature") || req.headers.get("retell-signature");
    const tsHeader = req.headers.get("x-retell-timestamp");

    const signatureOk = verifySignature(rawBody, signatureHeader, connection.webhookSecret, tsHeader);
    const enforceSignature = Boolean(connection.webhookSecret) && process.env.NODE_ENV === "production";

    if (!signatureOk && enforceSignature) {
      return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 401 });
    }

    // Persist call first (primary)
    await upsertRetellCall(connection.orgId, parsed);
    if (process.env.NODE_ENV !== "production") {
      console.log("[retell.webhook] ingested", { orgId: connection.orgId, callId: parsed.callId });
    }

    // Update timestamps (best-effort)
    await Promise.all([
      touchLastWebhook(connection.orgId),
      updateRetellWebhookTimestamp(connection.orgId),
    ]);

// Enqueue Zapier forward (best-effort)
try {
  const destinationUrl = await resolveZapierDestination(connection.orgId);
  if (destinationUrl) {
    const forwardPayload = ({
      provider: "retell",
      orgId: connection.orgId,
      retellCallId: parsed.callId,
      data: rawJson, // original webhook JSON
    } as unknown) as Prisma.InputJsonValue;

    await enqueueForwardJob({
      orgId: connection.orgId,
      retellCallId: parsed.callId,
      destinationUrl,
      payload: forwardPayload,
    } as any);
  }
} catch (err) {
  console.warn("retell.webhook enqueue failed:", err);
}

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    console.error("retell.webhook error:", e);
    const message = e instanceof Error ? e.message : "Webhook error";
    if (orgId) {
      try {
        await touchLastWebhookError(orgId, message);
      } catch {
        // ignore error tracking failures
      }
    }
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}
