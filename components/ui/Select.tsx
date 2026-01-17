import React from "react";
import { cx } from "./utils";

type Props = React.SelectHTMLAttributes<HTMLSelectElement>;

export default function Select({ className, ...props }: Props) {
  return (
    <select
      className={cx(
        "h-10 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:ring-2 focus:ring-black/10",
        className
      )}
      {...props}
    />
  );
}
