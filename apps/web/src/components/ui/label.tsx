import * as LabelPrimitive from "@radix-ui/react-label";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Label({ className, ...props }: ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      className={cn("font-mono text-[12px] uppercase tracking-[0.02em] text-ink", className)}
      {...props}
    />
  );
}
