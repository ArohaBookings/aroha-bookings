// components/StatCard.tsx
import { ReactNode } from "react";

export default function StatCard({
  label,
  value,
  icon,
  accent = "indigo",
}: {
  label: string;
  value: string | number;
  icon?: ReactNode;
  accent?: "indigo" | "emerald" | "amber" | "rose" | "sky";
}) {
  const colors: Record<string, string> = {
    indigo: "text-indigo-600 bg-indigo-50 border-indigo-100",
    emerald: "text-emerald-600 bg-emerald-50 border-emerald-100",
    amber: "text-amber-600 bg-amber-50 border-amber-100",
    rose: "text-rose-600 bg-rose-50 border-rose-100",
    sky: "text-sky-600 bg-sky-50 border-sky-100",
  };

  return (
    <div
      className={`group relative rounded-xl border border-zinc-200 bg-white p-4 shadow-sm hover:shadow-md transition-all duration-150 hover:-translate-y-0.5`}
    >
      {/* Accent bar */}
      <div
        className={`absolute inset-x-0 top-0 h-0.5 rounded-t-xl ${colors[accent]}`}
      />

      {/* Top Row */}
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-zinc-500">{label}</div>
        {icon && (
          <div
            className={`ml-2 flex h-7 w-7 items-center justify-center rounded-lg ${colors[accent]} bg-opacity-20`}
          >
            {icon}
          </div>
        )}
      </div>

      {/* Value */}
      <div className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900">
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
    </div>
  );
}
