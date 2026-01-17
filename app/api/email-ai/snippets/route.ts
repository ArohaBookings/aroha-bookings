import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

type Snippet = {
  id: string;
  title: string;
  body: string;
  keywords: string[];
};

function normalizeSnippets(raw: unknown): Snippet[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      const item = row as Record<string, unknown>;
      const title = String(item.title || "").trim();
      const body = String(item.body || "").trim();
      const keywords = Array.isArray(item.keywords)
        ? item.keywords.map((k) => String(k || "").trim()).filter(Boolean)
        : [];
      if (!title || !body) return null;
      return {
        id: String(item.id || `snippet_${Math.random().toString(36).slice(2)}`),
        title,
        body,
        keywords,
      };
    })
    .filter(Boolean) as Snippet[];
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
  const snippets = normalizeSnippets(data.emailSnippets);

  return NextResponse.json({ ok: true, snippets });
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

  const payload = (await req.json().catch(() => ({}))) as { snippets?: Snippet[] };
  const snippets = normalizeSnippets(payload.snippets);

  const orgSettings = await prisma.orgSettings.findUnique({
    where: { orgId: membership.orgId },
    select: { data: true },
  });
  const data = (orgSettings?.data as Record<string, unknown>) || {};

  await prisma.orgSettings.upsert({
    where: { orgId: membership.orgId },
    update: { data: { ...data, emailSnippets: snippets } as any },
    create: { orgId: membership.orgId, data: { emailSnippets: snippets } as any },
  });

  return NextResponse.json({ ok: true, snippets });
}
