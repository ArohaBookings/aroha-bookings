import React from "react";
import Button from "./Button";
import { cx } from "./utils";

type Props = {
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
};

export default function EmptyState({ title, body, actionLabel, onAction, className }: Props) {
  return (
    <div className={cx("rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 p-6 text-center", className)}>
      <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
      <p className="mt-2 text-xs text-zinc-600">{body}</p>
      {actionLabel && onAction ? (
        <div className="mt-4 flex justify-center">
          <Button variant="secondary" onClick={onAction}>
            {actionLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
