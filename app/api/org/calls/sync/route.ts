// FILE MAP: app layout at app/layout.tsx; Retell webhook at app/api/webhooks/voice/[provider]/[orgId]/route.ts.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSessionOrgFeature } from "@/lib/entitlements";
import type { Prisma } from "@prisma/client";
import { retellListCalls } from "@/lib/retell/client";
import { parseRetellPayload, upsertRetellCall } from "@/lib/retell/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function isAbortError(err: unknown) {
  const msg = String((err as any)?.message || "").toLowerCase();
  const code = (err as any)?.code as string | undefined;
  return code === "ECONNRESET" || msg.includes("aborted") || msg.includes("aborterror");
}

async function updateSyncMeta(
  orgId: string,
  meta: {
    lastSyncAt: string;
    lastSyncError?: string | null;
    lastSyncTraceId?: string | null;
    lastSyncHttpStatus?: number | null;
    lastSyncEndpointTried?: string | null;
  }
) {
  const settings = await prisma.orgSettings.findUnique({
    where: { orgId },
    select: { data: true },
  });

  const data = (settings?.data as Record<string, unknown>) || {};
  const calls = (data.calls as Record<string, unknown>) || {};

  calls.lastSyncAt = meta.lastSyncAt;
  if (meta.lastSyncError !== undefined) calls.lastSyncError = meta.lastSyncError;
  if (meta.lastSyncTraceId !== undefined) calls.lastSyncTraceId = meta.lastSyncTraceId;
  if (meta.lastSyncHttpStatus !== undefined) calls.lastSyncHttpStatus = meta.lastSyncHttpStatus;
  if (meta.lastSyncEndpointTried !== undefined) calls.lastSyncEndpointTried = meta.lastSyncEndpointTried;

  data.calls = calls;

  if (settings) {
    await prisma.orgSettings.update({
      where: { orgId },
      data: { data: data as Prisma.InputJsonValue },
    });
  } else {
    await prisma.orgSettings.create({
      data: { orgId, data: data as Prisma.InputJsonValue },
    });
  }
}

export async function POST(req: Request) {
  if (req.signal.aborted) {
    return NextResponse.json({ ok: false, error: "aborted" }, { status: 499 });
  }

  try {
    const auth = await requireSessionOrgFeature("callsInbox");
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const connection = await prisma.retellConnection.findFirst({
      where: { orgId: auth.orgId, active: true },
      orderBy: { updatedAt: "desc" },
      select: { agentId: true, apiKeyEncrypted: true },
    });

    if (!connection?.agentId) {
      await updateSyncMeta(auth.orgId, {
        lastSyncAt: new Date().toISOString(),
        lastSyncError: "Retell not configured",
        lastSyncTraceId: null,
        lastSyncHttpStatus: 400,
        lastSyncEndpointTried: null,
      });
      return NextResponse.json({ ok: false, error: "Retell not configured" }, { status: 400 });
    }

    const apiKey = (connection.apiKeyEncrypted || process.env.RETELL_API_KEY || "").trim();
    if (!apiKey) {
      await updateSyncMeta(auth.orgId, {
        lastSyncAt: new Date().toISOString(),
        lastSyncError: "Missing Retell API key",
        lastSyncTraceId: null,
        lastSyncHttpStatus: 400,
        lastSyncEndpointTried: null,
      });
      return NextResponse.json({ ok: false, error: "Missing Retell API key" }, { status: 400 });
    }

    const list = await retellListCalls({
      agentId: connection.agentId,
      apiKey,
      limit: 100,
      signal: req.signal,
    });

    if (!list.ok) {
      await updateSyncMeta(auth.orgId, {
        lastSyncAt: new Date().toISOString(),
        lastSyncError: "Retell sync failed",
        lastSyncTraceId: null,
        lastSyncHttpStatus: list.status ?? 502,
        lastSyncEndpointTried: list.chosenUrl ?? list.tried?.[list.tried.length - 1]?.url ?? null,
      });
      return NextResponse.json({ ok: false, error: "Retell sync failed" }, { status: 502 });
    }

    let upserted = 0;
    for (const call of list.calls || []) {
      if (req.signal.aborted) break;
      const parsed = parseRetellPayload(call as Record<string, unknown>);
      if (!parsed) continue;
      await upsertRetellCall(auth.orgId, parsed);
      upserted += 1;
    }

    const now = new Date().toISOString();
    await updateSyncMeta(auth.orgId, {
      lastSyncAt: now,
      lastSyncError: null,
      lastSyncTraceId: null,
      lastSyncHttpStatus: list.status ?? 200,
      lastSyncEndpointTried: list.chosenUrl,
    });

    return NextResponse.json({ ok: true, mode: "retell", upserted });
  } catch (err) {
    if (req.signal.aborted || isAbortError(err)) {
      return NextResponse.json({ ok: false, error: "aborted" }, { status: 499 });
    }
    return NextResponse.json({ ok: false, error: "Sync failed" }, { status: 500 });
  }
}

export async function GET() {
  const auth = await requireSessionOrgFeature("callsInbox");
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const settings = await prisma.orgSettings.findUnique({
    where: { orgId: auth.orgId },
    select: { data: true },
  });
  const data = (settings?.data as Record<string, unknown>) || {};
  const calls = (data.calls as Record<string, unknown>) || {};

  return NextResponse.json({
    ok: true,
    meta: {
      lastSyncAt: typeof calls.lastSyncAt === "string" ? calls.lastSyncAt : null,
      lastSyncError: typeof calls.lastSyncError === "string" ? calls.lastSyncError : null,
      lastSyncTraceId: typeof calls.lastSyncTraceId === "string" ? calls.lastSyncTraceId : null,
      lastSyncHttpStatus: typeof calls.lastSyncHttpStatus === "number" ? calls.lastSyncHttpStatus : null,
      lastSyncEndpointTried:
        typeof calls.lastSyncEndpointTried === "string" ? calls.lastSyncEndpointTried : null,
      lastWebhookAt: typeof calls.lastWebhookAt === "string" ? calls.lastWebhookAt : null,
      lastWebhookError: typeof calls.lastWebhookError === "string" ? calls.lastWebhookError : null,
      lastWebhookErrorAt: typeof calls.lastWebhookErrorAt === "string" ? calls.lastWebhookErrorAt : null,
    },
  });
}
