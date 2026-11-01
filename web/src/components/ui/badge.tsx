import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

// Square and borderless (dev-plans/02-frontend-design-system.md): the pill look is gone,
// only status dots are round. pills.ts builds the action buttons on these variants.
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-colors aria-invalid:outline-2 aria-invalid:outline-critical [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a&]:hover:bg-primary-hover",
        secondary: "bg-fill text-ink [a&]:hover:bg-fill-hover",
        destructive: "bg-critical text-white [a&]:hover:bg-critical/90",
        outline: "bg-fill text-ink [a&]:hover:bg-fill-hover",
        ghost: "text-ink-2 [a&]:hover:bg-fill [a&]:hover:text-ink",
        link: "text-link [a&]:hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
