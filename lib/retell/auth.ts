// lib/retell/auth.ts
import { prisma } from "@/lib/db";
import { getOrgEntitlements } from "@/lib/entitlements";

export type RetellContext = {
  org: { id: string; slug: string; timezone: string };
};

export async function requireRetellContext(req: Request): Promise<RetellContext> {
  const key = req.headers.get("x-retell-key")?.trim();
  if (!key) {
    throw new Response(JSON.stringify({ error: "Missing x-retell-key" }), { status: 401 });
  }

  const apiKey = await prisma.apiKey.findUnique({
    where: { secret: key },
    include: { org: true },
  });

  if (!apiKey || !apiKey.active || !apiKey.org) {
    throw new Response(JSON.stringify({ error: "Invalid API key" }), { status: 401 });
  }

  const entitlements = await getOrgEntitlements(apiKey.org.id);
  if (!entitlements.features.calls && !entitlements.features.aiReceptionist) {
    throw new Response(JSON.stringify({ error: "AI receptionist not enabled for this org" }), { status: 403 });
  }

  return {
    org: { id: apiKey.org.id, slug: apiKey.org.slug, timezone: apiKey.org.timezone },
  };
}
