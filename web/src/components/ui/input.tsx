import * as React from "react"
import { cn } from "@/lib/utils"

// Paper (dev-plans/02-frontend-design-system.md section 6.3): --fill background, no
// border, square, 34 px tall. The focus ring is the global :focus-visible outline.
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-[34px] w-full min-w-0 bg-fill px-3 py-1 text-[13px] text-ink transition-colors outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-[13px] file:font-medium file:text-ink placeholder:text-ink-3 hover:bg-fill-hover disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:outline-2 aria-invalid:outline-critical",
        className
      )}
      {...props}
    />
  )
}

export { Input }
