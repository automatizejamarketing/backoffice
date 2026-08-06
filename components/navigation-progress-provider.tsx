"use client";

import { ProgressProvider } from "@bprogress/next/app";
import {
  NAVIGATION_PROGRESS_BAR_COLOR,
  NAVIGATION_PROGRESS_BAR_DELAY_MS,
  NAVIGATION_PROGRESS_BAR_HEIGHT,
  NAVIGATION_PROGRESS_BAR_START_POSITION,
  NAVIGATION_PROGRESS_BAR_STOP_DELAY_MS,
  navigationProgressOptions,
} from "@/lib/navigation-progress";

type NavigationProgressProviderProps = {
  children: React.ReactNode;
};

export function NavigationProgressProvider({
  children,
}: NavigationProgressProviderProps) {
  return (
    <ProgressProvider
      color={NAVIGATION_PROGRESS_BAR_COLOR}
      delay={NAVIGATION_PROGRESS_BAR_DELAY_MS}
      height={NAVIGATION_PROGRESS_BAR_HEIGHT}
      options={navigationProgressOptions}
      startPosition={NAVIGATION_PROGRESS_BAR_START_POSITION}
      stopDelay={NAVIGATION_PROGRESS_BAR_STOP_DELAY_MS}
    >
      {children}
    </ProgressProvider>
  );
}
