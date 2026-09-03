"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PageWhatsappNumberResponse } from "@/app/api/meta-marketing/[accountId]/pages/[pageId]/whatsapp-number/route";

const MAX_AUTOMATIC_ATTEMPTS = 3;
const RETRY_DELAY_MS = 800;

export type PageWhatsappNumberState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "resolved"; data: PageWhatsappNumberResponse }
  | { phase: "failed" };

export function usePageWhatsappNumber(
  pageId: string | null | undefined,
  enabled: boolean,
  accountId?: string | null,
  userId?: string | null,
) {
  const [state, setState] = useState<PageWhatsappNumberState>({ phase: "idle" });
  const [attemptToken, setAttemptToken] = useState(0);
  const requestId = useRef(0);

  useEffect(() => {
    if (!enabled || !pageId || !accountId || !userId) {
      setState({ phase: "idle" });
      return;
    }

    const id = ++requestId.current;
    let cancelled = false;
    setState({ phase: "loading" });

    const run = async (attempt: number): Promise<void> => {
      try {
        const response = await fetch(
          `/api/meta-marketing/${encodeURIComponent(accountId)}/pages/${encodeURIComponent(pageId)}/whatsapp-number?userId=${encodeURIComponent(userId)}`,
        );
        const data = (await response.json()) as
          | PageWhatsappNumberResponse
          | { success: false };

        if (cancelled || id !== requestId.current) return;

        if (data.success) {
          setState({ phase: "resolved", data });
          return;
        }
        throw new Error("lookup failed");
      } catch {
        if (cancelled || id !== requestId.current) return;
        if (attempt < MAX_AUTOMATIC_ATTEMPTS) {
          setTimeout(() => {
            if (!cancelled && id === requestId.current) void run(attempt + 1);
          }, RETRY_DELAY_MS * attempt);
          return;
        }
        setState({ phase: "failed" });
      }
    };

    void run(1);
    return () => {
      cancelled = true;
    };
  }, [pageId, enabled, accountId, userId, attemptToken]);

  const reload = useCallback(() => setAttemptToken((n) => n + 1), []);

  return { state, reload };
}
