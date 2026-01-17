import React from "react";
import { cx } from "./utils";

type Props = React.HTMLAttributes<HTMLDivElement> & {
  padded?: boolean;
};

export default function Card({ className, padded = true, ...props }: Props) {
  return (
    <div
      className={cx(
        "rounded-2xl border border-zinc-200 bg-white shadow-sm",
        padded ? "p-6" : "",
        className
      )}
      {...props}
    />
  );
}
