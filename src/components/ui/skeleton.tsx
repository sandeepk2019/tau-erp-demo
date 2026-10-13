import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      // round-8: sweeping shimmer instead of flat pulse (reduced-motion safe via globals.css)
      className={cn("erp-shimmer rounded-md bg-accent/40", className)}
      {...props}
    />
  )
}

export { Skeleton }
