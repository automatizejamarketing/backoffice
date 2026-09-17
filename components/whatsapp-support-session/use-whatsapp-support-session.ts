"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type WhatsappSupportSessionView = {
  id: string;
  operatorEmail: string;
  targetUserId: string;
  phoneE164: string;
  environment: "staging" | "prod";
  reason: string;
  durationMinutes: number;
  state: "pending" | "active";
  activationCodeExpiresAt: string;
  activatedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
};

type SessionResponse = {
  environment: "staging" | "prod";
  webhookAvailable: boolean;
  session: WhatsappSupportSessionView | null;
  activationCode?: string;
  activationCommand?: string;
};

async function requestSession(
  userId: string,
  init?: RequestInit,
): Promise<SessionResponse> {
  const response = await fetch(
    `/api/users/${userId}/whatsapp-support-session`,
    init,
  );
  const payload = (await response.json().catch(() => null)) as
    | (SessionResponse & { error?: string })
    | null;
  if (!response.ok || !payload) {
    throw new Error(payload?.error ?? "Não foi possível atualizar a sessão.");
  }
  return payload;
}

async function endSession(userId: string, sessionId: string): Promise<void> {
  const response = await fetch(
    `/api/users/${userId}/whatsapp-support-session`,
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    },
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(payload?.error ?? "Não foi possível encerrar a sessão.");
  }
}

export function useWhatsappSupportSession(userId: string) {
  const queryClient = useQueryClient();
  const queryKey = ["whatsapp-support-session", userId] as const;
  const query = useQuery({
    queryKey,
    queryFn: () => requestSession(userId),
    refetchInterval: (current) =>
      current.state.data?.session?.state === "pending" ? 5_000 : false,
  });

  const start = useMutation({
    mutationFn: (input: {
      phone: string;
      durationMinutes: number;
      reason: string;
    }) =>
      requestSession(userId, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data);
    },
  });

  const end = useMutation({
    mutationFn: (sessionId: string) => endSession(userId, sessionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  return { query, start, end };
}
