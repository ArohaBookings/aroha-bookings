import React from "react";
import { cx } from "./utils";

type Variant = "neutral" | "success" | "warning" | "info";

type Props = React.HTMLAttributes<HTMLSpanElement> & {
  variant?: Variant;
};

const styles: Record<Variant, string> = {
  neutral: "border-zinc-200 bg-white text-zinc-600",
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warning: "border-amber-200 bg-amber-50 text-amber-700",
  info: "border-blue-200 bg-blue-50 text-blue-700",
};

export default function Badge({ variant = "neutral", className, ...props }: Props) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium",
        styles[variant],
        className
      )}
      {...props}
    />
  );
}
