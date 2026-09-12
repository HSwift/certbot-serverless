import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-[5px] px-4 text-sm font-medium tracking-[0.01em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember-orange/20 disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-ember-orange text-white hover:bg-[#e87316]",
        outline: "bg-white text-graphite ring-1 ring-inset ring-gridline hover:bg-vellum hover:text-ink",
        ghost: "text-graphite hover:bg-vellum hover:text-ink",
        destructive: "bg-ink text-white hover:bg-graphite",
      },
      size: {
        default: "h-9 px-4",
        sm: "h-9 px-3.5 text-[13px]",
        icon: "size-9 px-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
);
Button.displayName = "Button";
