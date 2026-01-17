import React from "react";
import { cx } from "./utils";

type Props = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, Props>(({ className, ...props }, ref) => {
  return (
    <input
      ref={ref}
      className={cx(
        "h-10 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:ring-2 focus:ring-black/10",
        className
      )}
      {...props}
    />
  );
});

Input.displayName = "Input";

export default Input;
