"use client";

import React from "react";
import { cx } from "./utils";

export type ToastVariant = "info" | "success" | "error";

type ToastProps = {
  message: string;
  variant?: ToastVariant;
  className?: string;
};

const styles: Record<ToastVariant, string> = {
  info: "bg-zinc-900 text-white",
  success: "bg-emerald-600 text-white",
  error: "bg-red-600 text-white",
};

export default function Toast({ message, variant = "info", className }: ToastProps) {
  return (
    <div className={cx("rounded-md px-3 py-2 text-xs shadow", styles[variant], className)}>
      {message}
    </div>
  );
}
