import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getMembershipContext } from "@/app/api/org/appointments/utils";
import { generateText, hasAI } from "@/lib/ai/client";

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

  const appt = await prisma.appointment.findUnique({
    where: { id: ctx.params.id },
    select: {
      id: true,
      orgId: true,
      startsAt: true,
      endsAt: true,
      staffId: true,
      serviceId: true,
    },
  });

  if (!appt || appt.orgId !== auth.orgId) {
    return json({ ok: false, error: "Appointment not found" }, 404);
  }

  const durationMin = Math.max(1, Math.round((appt.endsAt.getTime() - appt.startsAt.getTime()) / 60000));
  const suggestions: Array<{ title: string; detail: string }> = [];

  if (!appt.staffId) {
    suggestions.push({
      title: "Assign a staff member",
      detail: "Assigning a staff member improves workload balance and reduces last-minute reschedules.",
    });
  }
  if (durationMin >= 60) {
    suggestions.push({
      title: "Add buffer time",
      detail: "Consider a 10–15 min buffer after long sessions to avoid knock-on delays.",
    });
  }
  if (durationMin <= 15) {
    suggestions.push({
      title: "Combine short slots",
      detail: "Short appointments can be grouped to reduce idle gaps.",
    });
  }

  const summary =
    hasAI() && suggestions.length
      ? await generateText(
          `Rewrite these scheduling suggestions in a single, helpful sentence:\n${suggestions
            .map((s) => `- ${s.title}: ${s.detail}`)
            .join("\n")}`
        )
      : null;

  return json({ ok: true, suggestions, summary, ai: Boolean(summary) });
}
