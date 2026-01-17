import React from "react";
import { cx } from "./utils";

type Tab = { id: string; label: string };

type Props = {
  tabs: Tab[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
};

export default function Tabs({ tabs, value, onChange, className }: Props) {
  return (
    <div className={cx("inline-flex rounded-full border border-zinc-200 bg-white p-1", className)}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={cx(
            "rounded-full px-3 py-1 text-xs font-medium transition",
            value === t.id ? "bg-black text-white" : "text-zinc-600 hover:bg-zinc-100"
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
