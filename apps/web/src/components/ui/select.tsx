import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;

export function SelectTrigger({ className, children, ...props }: ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      className={cn("flex h-10 w-full items-center justify-between rounded-[4px] bg-white px-3 text-sm text-ink ring-1 ring-inset ring-gridline focus:outline-none focus:ring-2 focus:ring-ember-orange/20", className)}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon><ChevronDown className="size-3.5 text-slate" /></SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({ className, children, ...props }: ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position="popper"
        className={cn("z-[60] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-[4px] bg-white p-1 shadow-[0_16px_24px_-12px_rgba(0,0,0,0.08),0_0_0_1px_rgba(0,0,0,0.05)]", className)}
        {...props}
      >
        <SelectPrimitive.Viewport>{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({ className, children, ...props }: ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      className={cn("relative flex h-9 cursor-default select-none items-center rounded-[3px] pl-8 pr-3 text-sm text-graphite outline-none data-[highlighted]:bg-vellum data-[highlighted]:text-ink", className)}
      {...props}
    >
      <span className="absolute left-2.5"><SelectPrimitive.ItemIndicator><Check className="size-3.5" /></SelectPrimitive.ItemIndicator></span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}
