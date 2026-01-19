// FILE MAP: app layout at app/layout.tsx; Retell webhook at app/api/webhooks/voice/[provider]/[orgId]/route.ts.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSessionOrgFeature } from "@/lib/entitlements";
import type { Prisma } from "@prisma/client";

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

    const now = new Date().toISOString();
    await updateSyncMeta(auth.orgId, {
      lastSyncAt: now,
      lastSyncError: null,
      lastSyncTraceId: null,
      lastSyncHttpStatus: 200,
      lastSyncEndpointTried: "webhook",
    });

    return NextResponse.json({ ok: true, mode: "webhook", upserted: 0 });
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
