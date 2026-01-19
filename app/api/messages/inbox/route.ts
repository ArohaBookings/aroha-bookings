import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSessionOrgFeature } from "@/lib/entitlements";
import { DEMO_MESSAGES } from "@/lib/messages/demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

type MessageItem = {
  id: string;
  channel: "instagram" | "whatsapp" | "sms";
  fromName: string;
  fromHandle: string;
  preview: string;
  body: string;
  receivedAt: string;
  category: string;
  priority: "low" | "normal" | "high" | "urgent";
  risk: "safe" | "needs_review" | "blocked";
  confidence: number;
  status: "new" | "draft_ready" | "needs_review" | "sent";
  draft?: string | null;
  usedSnippets?: string[];
  quickActions?: string[];
};


const priorityRank: Record<MessageItem["priority"], number> = {
  urgent: 3,
  high: 2,
  normal: 1,
  low: 0,
};

export async function GET(req: Request) {
  const gate = await requireSessionOrgFeature("messagesHub");
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  }
  const orgId = gate.orgId!;

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").toLowerCase();
  const filter = url.searchParams.get("filter") || "all";
  const sort = url.searchParams.get("sort") || "priority";

  const settings = await prisma.orgSettings.findUnique({
    where: { orgId },
    select: { data: true },
  });
  const data = (settings?.data as Record<string, unknown>) || {};
  const demoMode = Boolean(data.demoMode);
  let items = demoMode ? DEMO_MESSAGES.slice() : [];

  if (q) {
    items = items.filter((item) => {
      const haystack = `${item.fromName} ${item.fromHandle} ${item.preview} ${item.body}`.toLowerCase();
      return haystack.includes(q);
    });
  }

  if (filter === "needs_review") {
    items = items.filter((item) => item.risk !== "safe" || item.status === "needs_review");
  } else if (filter === "draft_ready") {
    items = items.filter((item) => Boolean(item.draft));
  } else if (filter === "auto_send") {
    items = items.filter((item) => item.risk === "safe" && item.confidence >= 92);
  } else if (filter === "blocked") {
    items = items.filter((item) => item.risk === "blocked");
  }

  if (sort === "newest") {
    items.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  } else {
    items.sort((a, b) => {
      const p = priorityRank[b.priority] - priorityRank[a.priority];
      if (p !== 0) return p;
      return b.receivedAt.localeCompare(a.receivedAt);
    });
  }

  await prisma.orgSettings.upsert({
    where: { orgId },
    create: { orgId, data: { messagesSync: { lastSuccessAt: new Date().toISOString() } } as any },
    update: {
      data: {
        ...(data as any),
        messagesSync: { ...(data.messagesSync as any), lastSuccessAt: new Date().toISOString() },
      } as any,
    },
  });

  return NextResponse.json({
    ok: true,
    items,
    lastSyncAt: new Date().toISOString(),
  });
}
