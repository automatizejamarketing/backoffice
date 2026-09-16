"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SelectionSubmitBody } from "@/lib/backoffice/meta-asset-mutation-plan";
import type { MetaAssetsResponse } from "@/lib/backoffice/meta-assets-types";

export const metaAssetsQueryKey = (userId: string) =>
  ["meta-assets", userId] as const;

async function readError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  return body?.error ?? "request_failed";
}

export function useMetaAssets(userId: string) {
  return useQuery({
    queryKey: metaAssetsQueryKey(userId),
    queryFn: async (): Promise<MetaAssetsResponse> => {
      const response = await fetch(`/api/users/${userId}/meta-assets`);
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      return (await response.json()) as MetaAssetsResponse;
    },
    enabled: Boolean(userId),
  });
}

export function useUpdateMetaAssetLimits(userId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      adAccountLimit: number;
      identityLimit: number;
    }) => {
      const response = await fetch(`/api/users/${userId}/meta-assets/limits`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        throw new Error(await readError(response));
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: metaAssetsQueryKey(userId) });
    },
  });
}

export function useRequestMetaAssetSelection(userId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (note: string) => {
      const response = await fetch(
        `/api/users/${userId}/meta-assets/selection-request`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note }),
        },
      );
      if (!response.ok) {
        throw new Error(await readError(response));
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: metaAssetsQueryKey(userId) });
    },
  });
}

export class MetaAssetSelectionSetError extends Error {
  readonly code: string;
  readonly solution?: string;

  constructor(code: string, message: string, solution?: string) {
    super(message);
    this.name = "MetaAssetSelectionSetError";
    this.code = code;
    this.solution = solution;
  }
}

export function useSetMetaAssetSelection(userId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (body: SelectionSubmitBody) => {
      const response = await fetch(
        `/api/users/${userId}/meta-assets/selection`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
          message?: string;
          solution?: string;
        } | null;
        throw new MetaAssetSelectionSetError(
          payload?.error ?? "request_failed",
          payload?.message ?? "Não foi possível definir a seleção",
          payload?.solution,
        );
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: metaAssetsQueryKey(userId) });
    },
  });
}
