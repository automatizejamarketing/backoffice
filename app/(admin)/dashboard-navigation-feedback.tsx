"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useTransition,
  type ReactNode,
} from "react";
import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";

type DashboardNavigationContextValue = {
  isFetching: boolean;
  navigate: (href: string) => void;
};

const DashboardNavigationContext =
  createContext<DashboardNavigationContextValue | null>(null);

export function DashboardNavigationProvider({
  children,
}: {
  children: ReactNode;
}) {
  const router = useRouter();
  const [isFetching, startTransition] = useTransition();

  const navigate = useCallback(
    (href: string) => {
      startTransition(() => {
        router.push(href);
      });
    },
    [router],
  );

  const value = useMemo(
    () => ({ isFetching, navigate }),
    [isFetching, navigate],
  );

  return (
    <DashboardNavigationContext.Provider value={value}>
      {children}
    </DashboardNavigationContext.Provider>
  );
}

export function useDashboardNavigation() {
  const context = useContext(DashboardNavigationContext);
  if (!context) {
    throw new Error(
      "useDashboardNavigation must be used inside its provider",
    );
  }
  return context;
}

export function DashboardFetchingIndicator() {
  const { isFetching } = useDashboardNavigation();

  return (
    <span
      className="inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground"
      role="status"
      aria-live="polite"
    >
      {isFetching ? (
        <>
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
          <span className="sr-only">Atualizando conversão</span>
        </>
      ) : null}
    </span>
  );
}
