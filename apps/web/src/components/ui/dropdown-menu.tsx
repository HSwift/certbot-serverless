import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const DropdownMenu = DropdownPrimitive.Root;
export const DropdownMenuTrigger = DropdownPrimitive.Trigger;

export function DropdownMenuContent({ className, ...props }: ComponentProps<typeof DropdownPrimitive.Content>) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content
        align="end"
        sideOffset={6}
        className={cn("z-50 min-w-40 rounded-[4px] bg-white p-1.5 shadow-[0_16px_24px_-12px_rgba(0,0,0,0.08),0_0_0_1px_rgba(0,0,0,0.05)]", className)}
        {...props}
      />
    </DropdownPrimitive.Portal>
  );
}

export function DropdownMenuItem({ className, ...props }: ComponentProps<typeof DropdownPrimitive.Item>) {
  return (
    <DropdownPrimitive.Item
      className={cn("flex h-9 cursor-default select-none items-center gap-2 rounded-[3px] px-2.5 text-sm text-graphite outline-none data-[highlighted]:bg-vellum data-[highlighted]:text-ink", className)}
      {...props}
    />
  );
}
