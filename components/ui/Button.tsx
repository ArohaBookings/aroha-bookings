import React from "react";
import { cx } from "./utils";

type Variant = "primary" | "secondary" | "ghost" | "destructive";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
};

const base =
  "inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-black/20 disabled:opacity-60 disabled:pointer-events-none";

const styles: Record<Variant, string> = {
  primary: "bg-black text-white hover:bg-zinc-800",
  secondary: "border border-zinc-300 text-zinc-800 hover:bg-zinc-50",
  ghost: "text-zinc-700 hover:bg-zinc-100",
  destructive: "border border-red-300 text-red-600 hover:bg-red-50",
};

export default function Button({ variant = "primary", className, ...props }: Props) {
  return <button className={cx(base, styles[variant], className)} {...props} />;
}
