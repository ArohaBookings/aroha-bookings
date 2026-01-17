"use client";

import React from "react";
import { cx } from "./utils";

type Props = {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
};

export default function Modal({ open, onClose, title, children }: Props) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className={cx("relative w-full max-w-lg rounded-2xl bg-white shadow-xl", "p-6")}> 
        <div className="flex items-center justify-between">
          {title ? <h2 className="text-sm font-semibold text-zinc-900">{title}</h2> : <div />}
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100"
          >
            Close
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}
