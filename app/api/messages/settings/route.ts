import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSessionOrgFeature } from "@/lib/entitlements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

type MessagesSettings = {
  enableAutoDraft: boolean;
  enableAutoSend: boolean;
  minConfidence: number;
  blockedCategories: string[];
  dailySendCap: number;
  businessHoursOnly: boolean;
  requireApprovalForFirstN: number;
};

type KnowledgeBaseEntry = {
  id: string;
  title: string;
  content: string;
  tags?: string[];
};

const DEFAULT_SETTINGS: MessagesSettings = {
  enableAutoDraft: true,
  enableAutoSend: false,
  minConfidence: 92,
  blockedCategories: ["complaint", "legal", "medical_sensitive"],
  dailySendCap: 20,
  businessHoursOnly: true,
  requireApprovalForFirstN: 25,
};

function normalizeSettings(input: Partial<MessagesSettings> | null | undefined): MessagesSettings {
  return {
    enableAutoDraft: Boolean(input?.enableAutoDraft ?? DEFAULT_SETTINGS.enableAutoDraft),
    enableAutoSend: Boolean(input?.enableAutoSend ?? DEFAULT_SETTINGS.enableAutoSend),
    minConfidence:
      typeof input?.minConfidence === "number" && Number.isFinite(input.minConfidence)
        ? input.minConfidence
        : DEFAULT_SETTINGS.minConfidence,
    blockedCategories: Array.isArray(input?.blockedCategories)
      ? input!.blockedCategories.filter((x) => typeof x === "string" && x.trim())
      : DEFAULT_SETTINGS.blockedCategories,
    dailySendCap:
      typeof input?.dailySendCap === "number" && Number.isFinite(input.dailySendCap)
        ? input.dailySendCap
        : DEFAULT_SETTINGS.dailySendCap,
    businessHoursOnly: Boolean(input?.businessHoursOnly ?? DEFAULT_SETTINGS.businessHoursOnly),
    requireApprovalForFirstN:
      typeof input?.requireApprovalForFirstN === "number" && Number.isFinite(input.requireApprovalForFirstN)
        ? input.requireApprovalForFirstN
        : DEFAULT_SETTINGS.requireApprovalForFirstN,
  };
}

function normalizeKnowledgeBase(input: unknown): KnowledgeBaseEntry[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const raw = item as Record<string, unknown>;
      const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : null;
      const title = typeof raw.title === "string" ? raw.title.trim() : "";
      const content = typeof raw.content === "string" ? raw.content.trim() : "";
      if (!id || !title || !content) return null;
      const tags = Array.isArray(raw.tags)
        ? raw.tags.filter((t) => typeof t === "string" && t.trim()).map((t) => t.trim())
        : [];
      return { id, title, content, tags };
    })
    .filter(Boolean) as KnowledgeBaseEntry[];
}

export async function GET() {
  const gate = await requireSessionOrgFeature("messagesHub");
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  }
  const orgId = gate.orgId!;

  const orgSettings = await prisma.orgSettings.findUnique({
    where: { orgId },
    select: { data: true },
  });
  const data = (orgSettings?.data as Record<string, unknown>) || {};
  const settings = normalizeSettings((data.messagesSettings as Partial<MessagesSettings>) || {});
  const entitlements = gate.entitlements;
  const effectiveSettings = entitlements
    ? {
        ...settings,
        enableAutoDraft: settings.enableAutoDraft && entitlements.automation.enableAutoDraft,
        enableAutoSend: settings.enableAutoSend && entitlements.automation.enableAutoSend,
        minConfidence: Math.max(settings.minConfidence, entitlements.automation.minConfidence),
        dailySendCap: Math.min(settings.dailySendCap, entitlements.automation.dailySendCap),
        requireApprovalForFirstN: Math.max(
          settings.requireApprovalForFirstN,
          entitlements.automation.requireApprovalFirstN
        ),
      }
    : settings;
  const knowledgeBase = normalizeKnowledgeBase(data.knowledgeBase);

  return NextResponse.json({ ok: true, settings: effectiveSettings, knowledgeBase });
}

export async function POST(req: Request) {
  const gate = await requireSessionOrgFeature("messagesHub");
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  }
  const orgId = gate.orgId!;

  const payload = (await req.json().catch(() => ({}))) as {
    settings?: Partial<MessagesSettings>;
    knowledgeBase?: KnowledgeBaseEntry[];
  };

  const orgSettings = await prisma.orgSettings.findUnique({
    where: { orgId },
    select: { data: true },
  });
  const data = (orgSettings?.data as Record<string, unknown>) || {};

  let settings = normalizeSettings(payload.settings || (data.messagesSettings as Partial<MessagesSettings>));
  const entitlements = gate.entitlements;
  if (entitlements) {
    settings = {
      ...settings,
      enableAutoDraft: settings.enableAutoDraft && entitlements.automation.enableAutoDraft,
      enableAutoSend: settings.enableAutoSend && entitlements.automation.enableAutoSend,
      minConfidence: Math.max(settings.minConfidence, entitlements.automation.minConfidence),
      dailySendCap: Math.min(settings.dailySendCap, entitlements.automation.dailySendCap),
      requireApprovalForFirstN: Math.max(
        settings.requireApprovalForFirstN,
        entitlements.automation.requireApprovalFirstN
      ),
    };
  }
  const knowledgeBase = normalizeKnowledgeBase(
    payload.knowledgeBase ?? (data.knowledgeBase as KnowledgeBaseEntry[] | undefined),
  );

  await prisma.orgSettings.upsert({
    where: { orgId },
    create: { orgId, data: { ...data, messagesSettings: settings, knowledgeBase } as any },
    update: { data: { ...data, messagesSettings: settings, knowledgeBase } as any },
  });

  return NextResponse.json({ ok: true, settings, knowledgeBase });
}
