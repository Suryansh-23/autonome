import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          "flex h-12 w-full rounded-xl border border-zinc-300 bg-white px-4 py-2 text-base outline-none transition placeholder:text-zinc-400",
          "focus-visible:ring-2 focus-visible:ring-blue-400 dark:focus-visible:ring-blue-500",
          "dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-700",
          className
        )}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";
