"use client"

import * as React from "react"
import * as ProgressPrimitive from "@radix-ui/react-progress"

import { cn } from "@/lib/utils"

function Progress({
  className,
  children,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root> & {
  children?: React.ReactNode
}) {
  return (
    <div className={cn("flex flex-wrap gap-3", className)} data-slot="progress">
      {children}
      <ProgressTrack value={value} {...props} />
    </div>
  )
}

const ProgressTrack = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>
>(({ className, value, ...props }, ref) => (
  <ProgressPrimitive.Root
    ref={ref}
    className={cn(
      "relative h-1 w-full overflow-hidden rounded-md bg-muted",
      className
    )}
    value={value ?? undefined}
    data-slot="progress-track"
    {...props}
  >
    <ProgressIndicator value={value ?? undefined} />
  </ProgressPrimitive.Root>
))
ProgressTrack.displayName = "ProgressTrack"

const ProgressIndicator = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Indicator>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Indicator> & {
    value?: number | null
  }
>(({ className, value, ...props }, ref) => (
  <ProgressPrimitive.Indicator
    ref={ref}
    className={cn("h-full w-full flex-1 bg-primary transition-all", className)}
    style={{ transform: `translateX(-${100 - (value ?? 0)}%)` }}
    data-slot="progress-indicator"
    {...props}
  />
))
ProgressIndicator.displayName = ProgressPrimitive.Indicator.displayName

function ProgressLabel({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("text-xs/relaxed font-medium", className)}
      data-slot="progress-label"
      {...props}
    />
  )
}

function ProgressValue({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "text-muted-foreground ml-auto text-xs/relaxed tabular-nums",
        className
      )}
      data-slot="progress-value"
      {...props}
    />
  )
}

export {
  Progress,
  ProgressTrack,
  ProgressIndicator,
  ProgressLabel,
  ProgressValue,
}
