import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-[4px] bg-white px-2.5 font-mono text-[11px] uppercase tracking-[0.02em] text-slate ring-1 ring-inset ring-gridline",
        className,
      )}
      {...props}
    />
  );
}
