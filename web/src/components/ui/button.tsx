import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

// Paper (dev-plans/02-frontend-design-system.md section 6.1): square, no border, no
// shadow. Primary is the blue action, everything else sits on --fill. The focus ring
// is the global :focus-visible outline in index.css.
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 text-[13px] font-medium whitespace-nowrap transition-colors outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-hover",
        destructive: "bg-critical text-white hover:bg-critical/90",
        outline: "bg-fill text-ink hover:bg-fill-hover active:bg-fill-press",
        secondary: "bg-fill text-ink hover:bg-fill-hover active:bg-fill-press",
        ghost: "text-ink-2 hover:bg-fill hover:text-ink active:bg-fill-hover",
        link: "text-link hover:underline",
      },
      size: {
        default: "h-[34px] px-3.5 has-[>svg]:px-3",
        xs: "h-6 gap-1 px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 px-6 has-[>svg]:px-4",
        icon: "size-[34px]",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
