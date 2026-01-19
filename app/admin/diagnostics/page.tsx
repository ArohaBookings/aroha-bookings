import { prisma } from "@/lib/db";
import { requireOrgOrPurchase } from "@/lib/requireOrgOrPurchase";
import DiagnosticsClient from "./DiagnosticsClient";

export const runtime = "nodejs";

export default async function DiagnosticsPage() {
  const gate = await requireOrgOrPurchase();
  if (!gate.isSuperAdmin) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10 text-sm text-zinc-600">
        Not authorized.
      </div>
    );
  }

  const orgs = await prisma.organization.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <DiagnosticsClient orgs={orgs} />
    </div>
  );
}
