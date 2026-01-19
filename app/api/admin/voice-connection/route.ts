// FILE MAP: app layout at app/layout.tsx; Retell webhook at app/api/webhooks/voice/[provider]/[orgId]/route.ts.
// app/api/admin/voice-connection/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getOrgEntitlements } from "@/lib/entitlements";
import { canAccessSuperAdminByEmail } from "@/lib/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

async function requireSuperadmin() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email || null;
  if (!email) return { ok: false, error: "Not signed in", status: 401 } as const;
  const allowed = await canAccessSuperAdminByEmail(email);
  if (!allowed) return { ok: false, error: "Not authorized", status: 403 } as const;
  return { ok: true } as const;
}

export async function GET(req: Request) {
  const auth = await requireSuperadmin();
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const url = new URL(req.url);
  const orgId = (url.searchParams.get("orgId") || "").trim();
  const provider = (url.searchParams.get("provider") || "").trim().toLowerCase();

  if (!orgId || !provider) return json({ ok: false, error: "Missing orgId or provider" }, 400);

  if (provider !== "retell") {
    return json({ ok: false, error: "Unsupported provider" }, 400);
  }

  const entitlements = await getOrgEntitlements(orgId);
  if (!entitlements.features.calls && !entitlements.features.aiReceptionist) {
    return json({ ok: false, error: "AI receptionist is not enabled for this org." }, 403);
  }

  const connection = await prisma.retellConnection.findFirst({
    where: { orgId },
    orderBy: { updatedAt: "desc" },
    select: { id: true, orgId: true, agentId: true, webhookSecret: true, active: true, apiKeyEncrypted: true },
  });

  return json({ ok: true, connection });
}

export async function POST(req: Request) {
  const auth = await requireSuperadmin();
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const body = (await req.json().catch(() => ({}))) as {
    orgId?: string;
    provider?: string;
    agentId?: string;
    webhookSecret?: string;
    active?: boolean;
    apiKeyEncrypted?: string | null;
    clear?: boolean;
  };

  const orgId = (body.orgId || "").trim();
  const provider = (body.provider || "").trim().toLowerCase();
  const agentId = (body.agentId || "").trim();
  const webhookSecret = (body.webhookSecret || "").trim();
  const active = Boolean(body.active);

  // ✅ Make this string | undefined (NOT null)
  const apiKeyEncrypted =
    typeof body.apiKeyEncrypted === "string" ? body.apiKeyEncrypted : undefined;

  if (!orgId || !provider) {
    return json({ ok: false, error: "Missing orgId or provider" }, 400);
  }
  if (provider !== "retell") {
    return json({ ok: false, error: "Unsupported provider" }, 400);
  }
  if (body.clear) {
    await prisma.retellConnection.deleteMany({ where: { orgId } });
    return json({ ok: true, cleared: true });
  }
  if (!agentId || !webhookSecret) {
    return json({ ok: false, error: "Missing required fields" }, 400);
  }

  const entitlements = await getOrgEntitlements(orgId);
  if (!entitlements.features.calls && !entitlements.features.aiReceptionist) {
    return json({ ok: false, error: "AI receptionist is not enabled for this org." }, 403);
  }

  const connection = await prisma.retellConnection.upsert({
    where: { orgId_agentId: { orgId, agentId } },
    update: {
      webhookSecret,
      active,
      ...(apiKeyEncrypted !== undefined ? { apiKeyEncrypted } : {}),
    },
    create: {
      orgId,
      agentId,
      webhookSecret,
      active,
      apiKeyEncrypted: apiKeyEncrypted ?? "",
    },
    select: {
      id: true,
      orgId: true,
      agentId: true,
      webhookSecret: true,
      active: true,
      apiKeyEncrypted: true,
    },
  });

  return json({ ok: true, connection });
}
