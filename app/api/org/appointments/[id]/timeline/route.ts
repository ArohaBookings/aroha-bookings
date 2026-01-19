import { NextResponse } from "next/server";
import { getMembershipContext } from "@/app/api/org/appointments/utils";
import { prisma } from "@/lib/db";
import { buildAppointmentTimeline } from "@/lib/timeline";
import { summarizeTimeline } from "@/lib/ai/timeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getMembershipContext();
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const { id: appointmentId } = await params;
  const timeline = await buildAppointmentTimeline(auth.orgId, appointmentId);
  if (!timeline) {
    return json({ ok: false, error: "Appointment not found" }, 404);
  }

  const org = await prisma.organization.findUnique({
    where: { id: auth.orgId },
    select: { name: true },
  });
  const summary = await summarizeTimeline({
    orgName: org?.name || "the business",
    events: timeline.events,
  });

  return json({
    ok: true,
    timeline: timeline.events,
    appointment: timeline.appointment,
    summary: summary.text,
    summaryAI: summary.ai,
  });
}
