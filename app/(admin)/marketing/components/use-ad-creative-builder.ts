"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AdCreativeFormValue } from "./ad-creative-form";
import type { SelectedMedia } from "./media-source-picker";

export type AdCreativeBuilderPhase =
  | "editing"
  | "submitting"
  | "processing"
  | "done"
  | "error";

export type AdCreativeBuilderResult =
  | { kind: "created"; adId: string; creativeId: string }
  | { kind: "repoint"; adId: string; creativeId: string }
  | {
      kind: "duplicate_paused";
      newAdId: string;
      pausedAdId: string;
      creativeId: string;
      message: string;
    };

type BuilderTarget =
  | { mode: "create"; accountId: string; userId: string; adsetId: string }
  | { mode: "edit"; accountId: string; userId: string; adId: string };

const POLL_INTERVAL_MS = 5000;

function mediaToRequest(media: SelectedMedia) {
  if (media.source === "instagram") {
    return { source: "instagram", instagramMediaId: media.instagramMediaId };
  }
  if (media.source === "automatize_media") {
    return {
      source: "automatize_media",
      generatedImageId: media.generatedImageId,
    };
  }
  return {
    source: "device",
    blobUrl: media.blobUrl,
    mediaType: media.mediaType,
  };
}

export function useAdCreativeBuilder(target: BuilderTarget) {
  const [phase, setPhase] = useState<AdCreativeBuilderPhase>("editing");
  const [error, setError] = useState<string | null>(null);
  const [videoProgress, setVideoProgress] = useState<number | null>(null);
  const [result, setResult] = useState<AdCreativeBuilderResult | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastBodyRef = useRef<Record<string, unknown> | null>(null);

  const endpoint =
    target.mode === "create"
      ? `/api/meta-marketing/${target.accountId}/adsets/${target.adsetId}/ads?userId=${target.userId}`
      : `/api/meta-marketing/${target.accountId}/ads/${target.adId}/creative?userId=${target.userId}`;

  const clearPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => clearPoll, [clearPoll]);

  const postBody = useCallback(
    async (body: Record<string, unknown>) => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      return { response, data } as const;
    },
    [endpoint],
  );

  const finishFromData = useCallback(
    (data: Record<string, unknown>) => {
      if (data.strategy === "repoint") {
        setResult({
          kind: "repoint",
          adId: String(data.adId),
          creativeId: String(data.creativeId),
        });
      } else if (data.strategy === "duplicate_paused") {
        setResult({
          kind: "duplicate_paused",
          newAdId: String(data.newAdId),
          pausedAdId: String(data.pausedAdId),
          creativeId: String(data.creativeId),
          message: String(data.message ?? ""),
        });
      } else {
        setResult({
          kind: "created",
          adId: String(data.adId),
          creativeId: String(data.creativeId),
        });
      }
      setPhase("done");
    },
    [],
  );

  const pollVideo = useCallback(
    async (videoId: string) => {
      try {
        const params = new URLSearchParams({
          userId: target.userId,
          videoIds: videoId,
        });
        const response = await fetch(
          `/api/meta-marketing/${target.accountId}/ads/video-status?${params}`,
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.success === false) {
          return;
        }
        const status = data.data?.statuses?.[videoId];
        if (typeof status?.progress === "number") {
          setVideoProgress(status.progress);
        }
        if (data.data?.hasError) {
          clearPoll();
          setError(
            status?.errorMessage ?? "Falha ao processar o vídeo na Meta.",
          );
          setPhase("error");
          return;
        }
        if (data.data?.allReady) {
          clearPoll();
          const confirmBody = {
            ...(lastBodyRef.current ?? {}),
            confirmVideoId: videoId,
          };
          const { response: r2, data: d2 } = await postBody(confirmBody);
          if (!r2.ok || d2.success === false) {
            setError(d2.message ?? "Falha ao concluir a criação do anúncio.");
            setPhase("error");
            return;
          }
          finishFromData(d2 as Record<string, unknown>);
        }
      } catch {
        // Transient poll failure — keep polling.
      }
    },
    [clearPoll, finishFromData, postBody, target.accountId, target.userId],
  );

  const submit = useCallback(
    async (input: { media: SelectedMedia; text: AdCreativeFormValue }) => {
      setError(null);
      setResult(null);
      setVideoProgress(null);
      setPhase("submitting");

      // Instagram preserves its own caption — send no titles/texts.
      const isInstagram = input.media.source === "instagram";
      const text: Record<string, unknown> = {
        ctaType: input.text.ctaType,
        linkUrl: input.text.linkUrl.trim(),
      };
      if (!isInstagram) {
        text.titles = input.text.titles
          .map((t) => t.trim())
          .filter(Boolean);
        text.texts = input.text.texts.map((t) => t.trim()).filter(Boolean);
      }

      const body: Record<string, unknown> = {
        media: mediaToRequest(input.media),
        text,
        status: input.text.status,
      };
      lastBodyRef.current = body;

      try {
        const { response, data } = await postBody(body);

        if (response.status === 202 && data.phase === "processing") {
          setPhase("processing");
          setVideoProgress(0);
          const videoId = String(data.videoId);
          pollRef.current = setInterval(() => {
            void pollVideo(videoId);
          }, POLL_INTERVAL_MS);
          return;
        }

        if (!response.ok || data.success === false) {
          setError(data.message ?? "Falha ao processar o anúncio.");
          setPhase("error");
          return;
        }

        finishFromData(data as Record<string, unknown>);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Erro de rede. Tente de novo.",
        );
        setPhase("error");
      }
    },
    [finishFromData, postBody, pollVideo],
  );

  const reset = useCallback(() => {
    clearPoll();
    setPhase("editing");
    setError(null);
    setResult(null);
    setVideoProgress(null);
    lastBodyRef.current = null;
  }, [clearPoll]);

  return { phase, error, videoProgress, result, submit, reset };
}
