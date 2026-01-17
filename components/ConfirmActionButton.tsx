"use client";

import React from "react";

type Props = {
  label: string;
  confirmText: string;
  className?: string;
};

export default function ConfirmActionButton({ label, confirmText, className }: Props) {
  return (
    <button
      type="submit"
      className={className}
      onClick={(event) => {
        if (!confirm(confirmText)) {
          event.preventDefault();
        }
      }}
    >
      {label}
    </button>
  );
}
