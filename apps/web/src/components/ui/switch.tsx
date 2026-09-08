import * as SwitchPrimitive from "@radix-ui/react-switch";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn("inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-[4px] bg-stone p-0.5 transition-colors data-[state=checked]:bg-ember-orange focus:outline-none focus:ring-2 focus:ring-ember-orange/20 disabled:cursor-not-allowed disabled:opacity-50", className)}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-4 rounded-[2px] bg-white transition-transform data-[state=checked]:translate-x-4" />
    </SwitchPrimitive.Root>
  );
}
