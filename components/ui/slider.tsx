"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

type SliderProps = {
  value?: number[];
  defaultValue?: number[];
  min?: number;
  max?: number;
  step?: number;
  onValueChange?: (value: number[]) => void;
  onValueCommit?: (value: number[]) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
};

const Slider = React.forwardRef<HTMLInputElement, SliderProps>(
  (
    {
      value,
      defaultValue,
      min = 0,
      max = 100,
      step = 1,
      onValueChange,
      onValueCommit,
      disabled,
      className,
      id,
    },
    ref
  ) => {
    const currentValue = value?.[0] ?? defaultValue?.[0] ?? min;
    const percentage = ((currentValue - min) / (max - min)) * 100;

    return (
      <div className={cn("relative flex w-full items-center", className)}>
        {/* Track background */}
        <div className="absolute h-1.5 w-full rounded-full bg-muted-foreground/30" />
        {/* Filled portion */}
        <div
          className="absolute h-1.5 rounded-full bg-primary"
          style={{ width: `${percentage}%` }}
        />
        <input
          ref={ref}
          className={cn(
            "relative h-1.5 w-full cursor-pointer appearance-none rounded-full bg-transparent",
            "[&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4",
            "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full",
            "[&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-primary/50",
            "[&::-webkit-slider-thumb]:bg-background [&::-webkit-slider-thumb]:shadow",
            "[&::-webkit-slider-thumb]:transition-colors",
            "[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4",
            "[&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full",
            "[&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-primary/50",
            "[&::-moz-range-thumb]:bg-background [&::-moz-range-thumb]:shadow",
            "disabled:pointer-events-none disabled:opacity-50"
          )}
          disabled={disabled}
          id={id}
          max={max}
          min={min}
          onChange={(e) => {
            onValueChange?.([Number.parseFloat(e.target.value)]);
          }}
          onMouseUp={(e) => {
            onValueCommit?.([
              Number.parseFloat((e.target as HTMLInputElement).value),
            ]);
          }}
          onKeyUp={(e) => {
            if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
              onValueCommit?.([
                Number.parseFloat((e.target as HTMLInputElement).value),
              ]);
            }
          }}
          step={step}
          type="range"
          value={currentValue}
        />
      </div>
    );
  }
);
Slider.displayName = "Slider";

export { Slider };
