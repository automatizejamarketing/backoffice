/**
 * Biblioteca de mídias — hooks React (espelhado no backoffice).
 * `endpoints` deve ser estável (useMemo) para não refazer a busca a cada render.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  MEDIA_LIBRARY_ERROR_MESSAGES,
  validateMediaLibraryUpload,
  type MediaLibraryClientErrorCode,
  type MediaLibraryTypeFilter,
} from "@/lib/media-library/policy";
import type { MediaLibraryItem, MediaLibrarySummary } from "@/lib/media-library/service";
import {
  toMediaLibraryClientError,
  uploadMediaLibraryFile,
  type MediaLibraryEndpoints,
  type MediaLibraryListResponse,
} from "@/lib/media-library/client";

/** Junta a próxima página sem repetir o que já está na tela (uploads recentes no topo). */
export function mergeMediaLibraryPages(
  previous: MediaLibraryItem[],
  next: MediaLibraryItem[],
): MediaLibraryItem[] {
  const seen = new Set(previous.map((item) => item.id));
  return [...previous, ...next.filter((item) => !seen.has(item.id))];
}

function matchesFilter(item: MediaLibraryItem, type: MediaLibraryTypeFilter): boolean {
  if (type === "image") return !item.isVideo;
  if (type === "video") return item.isVideo;
  return true;
}

export function useMediaLibrary({
  endpoint,
  type = "all",
  enabled = true,
}: {
  endpoint: string;
  type?: MediaLibraryTypeFilter;
  enabled?: boolean;
}) {
  const [items, setItems] = useState<MediaLibraryItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [library, setLibrary] = useState<MediaLibrarySummary | null>(null);
  const [viewer, setViewer] = useState<{ canWrite: boolean } | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const requestId = useRef(0);

  const fetchPage = useCallback(
    async (cursor: string | null): Promise<MediaLibraryListResponse> => {
      const params = new URLSearchParams();
      if (type !== "all") params.set("type", type);
      if (cursor) params.set("cursor", cursor);
      const query = params.toString();
      const response = await fetch(query ? `${endpoint}?${query}` : endpoint, { cache: "no-store" });
      if (!response.ok) throw new Error(`media_library_${response.status}`);
      return (await response.json()) as MediaLibraryListResponse;
    },
    [endpoint, type],
  );

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    setStatus("loading");
    try {
      const data = await fetchPage(null);
      if (id !== requestId.current) return;
      setItems(data.items);
      setNextCursor(data.nextCursor);
      setTotal(data.total);
      setLibrary(data.library);
      setViewer(data.viewer ?? null);
      setStatus("ready");
    } catch {
      if (id === requestId.current) setStatus("error");
    }
  }, [fetchPage]);

  useEffect(() => {
    if (enabled) void refresh();
  }, [enabled, refresh]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    const id = requestId.current;
    try {
      const data = await fetchPage(nextCursor);
      if (id !== requestId.current) return;
      setItems((previous) => mergeMediaLibraryPages(previous, data.items));
      setNextCursor(data.nextCursor);
      setTotal(data.total);
    } catch (error) {
      console.error("[media-library] carregar mais falhou", error);
    } finally {
      setLoadingMore(false);
    }
  }, [fetchPage, loadingMore, nextCursor]);

  const prepend = useCallback(
    (item: MediaLibraryItem) => {
      if (!matchesFilter(item, type)) return;
      setItems((previous) => (previous.some((entry) => entry.id === item.id) ? previous : [item, ...previous]));
      setTotal((value) => value + 1);
    },
    [type],
  );

  const removeLocal = useCallback((id: string) => {
    setItems((previous) => previous.filter((item) => item.id !== id));
    setTotal((value) => Math.max(0, value - 1));
  }, []);

  return {
    items,
    total,
    library,
    viewer,
    status,
    hasMore: nextCursor !== null,
    loadingMore,
    refresh,
    loadMore,
    prepend,
    removeLocal,
  };
}

export type MediaLibraryUploadQueueItem = {
  id: string;
  name: string;
  size: number;
  progress: number;
  status: "uploading" | "done" | "error";
  errorCode?: MediaLibraryClientErrorCode;
  errorMessage?: string;
};

let queueSequence = 0;

export function useMediaLibraryUpload({
  endpoints,
  onUploaded,
}: {
  endpoints: MediaLibraryEndpoints;
  onUploaded: (item: MediaLibraryItem) => void;
}) {
  const [queue, setQueue] = useState<MediaLibraryUploadQueueItem[]>([]);
  const onUploadedRef = useRef(onUploaded);
  useEffect(() => {
    onUploadedRef.current = onUploaded;
  }, [onUploaded]);

  const update = useCallback((id: string, patch: Partial<MediaLibraryUploadQueueItem>) => {
    setQueue((previous) => previous.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));
  }, []);

  const enqueue = useCallback(
    (files: File[]) => {
      for (const file of files) {
        queueSequence += 1;
        const id = `upload-${queueSequence}`;
        const validation = validateMediaLibraryUpload({ contentType: file.type, size: file.size });
        if (!validation.ok) {
          setQueue((previous) => [
            ...previous,
            {
              id,
              name: file.name,
              size: file.size,
              progress: 0,
              status: "error",
              errorCode: validation.code,
              errorMessage: MEDIA_LIBRARY_ERROR_MESSAGES[validation.code],
            },
          ]);
          continue;
        }
        setQueue((previous) => [...previous, { id, name: file.name, size: file.size, progress: 0, status: "uploading" }]);
        uploadMediaLibraryFile(endpoints, file, (progress) => update(id, { progress }))
          .then((item) => {
            update(id, { status: "done", progress: 100 });
            onUploadedRef.current(item);
            setTimeout(() => setQueue((previous) => previous.filter((entry) => entry.id !== id)), 1500);
          })
          .catch((error: unknown) => {
            const clientError = toMediaLibraryClientError(error);
            update(id, { status: "error", errorCode: clientError.code, errorMessage: clientError.message });
          });
      }
    },
    [endpoints, update],
  );

  const dismiss = useCallback((id: string) => {
    setQueue((previous) => previous.filter((entry) => entry.id !== id));
  }, []);

  return { queue, enqueue, dismiss, isUploading: queue.some((entry) => entry.status === "uploading") };
}
