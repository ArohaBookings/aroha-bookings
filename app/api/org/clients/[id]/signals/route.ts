import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getMembershipContext } from "@/app/api/org/appointments/utils";
import { computeClientSignals, storeClientSignals, loadClientGuardrails } from "@/lib/clientSignals";
import { summarizeClientSignals, suggestGuardrails } from "@/lib/ai/clientSignals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export async function GET(_req: Request, ctx: { params: { id: string } }) {
  const auth = await getMembershipContext();
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const customerId = ctx.params.id;
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true, orgId: true, name: true },
  });
  if (!customer || customer.orgId !== auth.orgId) {
    return json({ ok: false, error: "Customer not found" }, 404);
  }

  const signals = await computeClientSignals(auth.orgId, customerId);
  await storeClientSignals(auth.orgId, customerId, signals);

  const org = await prisma.organization.findUnique({
    where: { id: auth.orgId },
    select: { name: true },
  });
  const summary = await summarizeClientSignals({
    orgName: org?.name || "the business",
    signals,
  });
  const guardrail = await suggestGuardrails({
    orgName: org?.name || "the business",
    signals,
  });
  const activeGuardrails = await loadClientGuardrails(auth.orgId, customerId);

  const flags = [
    signals.totalVisits >= 5 ? { type: "VIP", label: "VIP client" } : null,
    signals.noShowCount >= 2 ? { type: "NO_SHOW_PATTERN", label: "No-show pattern" } : null,
    signals.cancellationCount >= 2 ? { type: "FREQUENT_RESCHEDULER", label: "Frequent rescheduler" } : null,
  ].filter(Boolean);

  return json({
    ok: true,
    signals,
    summary: summary.text,
    summaryAI: summary.ai,
    suggestedGuardrails: guardrail.suggestions,
    guardrailSummary: guardrail.summary,
    guardrailAI: guardrail.ai,
    activeGuardrails,
    flags,
  });
}
