export const runtime = "nodejs";

export default function ServicesPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">Services</h1>
        <p className="text-sm text-zinc-600">
          Configure offerings, pricing, and durations. This area is ready for setup.
        </p>
      </div>
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-sm text-zinc-600 shadow-sm">
        Add your core services, set pricing, and assign staff availability.
      </div>
    </div>
  );
}
