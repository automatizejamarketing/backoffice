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

type NavigateOptions = {
  replace?: boolean;
  scroll?: boolean;
};

type UsersNavigationContextValue = {
  isFetching: boolean;
  navigate: (href: string, options?: NavigateOptions) => void;
};

const UsersNavigationContext = createContext<UsersNavigationContextValue | null>(
  null,
);

export function UsersNavigationProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [isFetching, startTransition] = useTransition();

  const navigate = useCallback(
    (href: string, options: NavigateOptions = {}) => {
      startTransition(() => {
        if (options.replace) {
          router.replace(href, { scroll: options.scroll });
          return;
        }
        router.push(href, { scroll: options.scroll });
      });
    },
    [router],
  );

  const value = useMemo(
    () => ({ isFetching, navigate }),
    [isFetching, navigate],
  );

  return (
    <UsersNavigationContext.Provider value={value}>
      {children}
    </UsersNavigationContext.Provider>
  );
}

export function useUsersNavigation() {
  const context = useContext(UsersNavigationContext);
  if (!context) {
    throw new Error("useUsersNavigation must be used inside its provider");
  }
  return context;
}

export function UsersFetchingIndicator() {
  const { isFetching } = useUsersNavigation();

  return (
    <span
      className="inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground"
      role="status"
      aria-live="polite"
    >
      {isFetching ? (
        <>
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
          <span className="sr-only">Atualizando usuários</span>
        </>
      ) : null}
    </span>
  );
}
