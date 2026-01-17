import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

type VoiceSettings = {
  tone: string;
  signature: string;
  emojiLevel: 0 | 1 | 2;
  forbiddenPhrases: string[];
  lengthPreference: "short" | "medium" | "long";
};

const DEFAULT_VOICE: VoiceSettings = {
  tone: "friendly, concise, local",
  signature: "",
  emojiLevel: 0,
  forbiddenPhrases: [],
  lengthPreference: "medium",
};

function resolveVoice(data: Record<string, unknown>): VoiceSettings {
  const raw = (data.aiVoice as Record<string, unknown>) || {};
  const taboo = Array.isArray(raw.tabooPhrases) ? raw.tabooPhrases.filter(Boolean) : [];
  const forbidden = Array.isArray(raw.forbiddenPhrases) ? raw.forbiddenPhrases.filter(Boolean) : [];
  const lengthRaw = raw.lengthPreference || raw.length;
  return {
    tone: typeof raw.tone === "string" && raw.tone.trim() ? (raw.tone as string) : DEFAULT_VOICE.tone,
    signature: typeof raw.signature === "string" ? (raw.signature as string) : DEFAULT_VOICE.signature,
    emojiLevel:
      raw.emojiLevel === 1 || raw.emojiLevel === 2 ? (raw.emojiLevel as 0 | 1 | 2) : DEFAULT_VOICE.emojiLevel,
    forbiddenPhrases: [...taboo, ...forbidden],
    lengthPreference:
      lengthRaw === "short" || lengthRaw === "long" ? (lengthRaw as "short" | "medium" | "long") : "medium",
  };
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
  }

  const membership = await prisma.membership.findFirst({
    where: { user: { email: session.user.email } },
    select: { orgId: true },
    orderBy: { orgId: "asc" },
  });

  if (!membership?.orgId) {
    return NextResponse.json({ ok: false, error: "No organization" }, { status: 400 });
  }

  const orgSettings = await prisma.orgSettings.findUnique({
    where: { orgId: membership.orgId },
    select: { data: true },
  });

  const data = (orgSettings?.data as Record<string, unknown>) || {};
  return NextResponse.json({ ok: true, settings: resolveVoice(data) });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
  }

  const membership = await prisma.membership.findFirst({
    where: { user: { email: session.user.email } },
    select: { orgId: true },
    orderBy: { orgId: "asc" },
  });

  if (!membership?.orgId) {
    return NextResponse.json({ ok: false, error: "No organization" }, { status: 400 });
  }

  const payload = (await req.json().catch(() => ({}))) as Partial<VoiceSettings>;

  const orgSettings = await prisma.orgSettings.findUnique({
    where: { orgId: membership.orgId },
    select: { data: true },
  });

  const data = (orgSettings?.data as Record<string, unknown>) || {};
  const next = resolveVoice({ ...data, aiVoice: payload });

  await prisma.orgSettings.upsert({
    where: { orgId: membership.orgId },
    update: {
      data: {
        ...data,
        aiVoice: next,
      } as any,
    },
    create: {
      orgId: membership.orgId,
      data: {
        aiVoice: next,
      } as any,
    },
  });

  return NextResponse.json({ ok: true, settings: next });
}
