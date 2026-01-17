export const runtime = "nodejs";

export default function AutomationsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">Automations</h1>
        <p className="text-sm text-zinc-600">
          Manage workflows, reminders, and AI-enabled automations.
        </p>
      </div>
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-sm text-zinc-600 shadow-sm">
        Add rule-based automations here. AI helpers stay optional and fully configurable.
      </div>
    </div>
  );
}
