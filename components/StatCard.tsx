// components/StatCard.tsx
export default function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white shadow-card border border-zinc-200 p-4">
      <div className="text-xs font-medium text-zinc-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
    </div>
  );
}
