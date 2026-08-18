"use client";

import { useCallback, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { Loader2, UploadCloud, Video as VideoIcon, X } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

export type DeviceUploadSelection = {
  blobUrl: string;
  mediaType: "image" | "video";
  previewUrl: string;
};

const ACCEPTED = "image/jpeg,image/png,video/mp4,video/quicktime,video/webm";
const IMAGE_TYPES = ["image/jpeg", "image/png"];
const MAX_IMAGE = 5 * 1024 * 1024;
const MAX_VIDEO = 300 * 1024 * 1024;

type DeviceUploadTabProps = {
  userId: string;
  selected: DeviceUploadSelection[];
  onSelect: (selection: DeviceUploadSelection[]) => void;
  maxSelection?: number;
};

export function DeviceUploadTab({
  userId,
  selected,
  onSelect,
  maxSelection = 1,
}: DeviceUploadTabProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const remaining = maxSelection - selected.length;

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);

      const isImage = IMAGE_TYPES.includes(file.type);
      const isVideo = file.type.startsWith("video/");
      if (!isImage && !isVideo) {
        setError("Formato não suportado. Use JPG, PNG, MP4, MOV ou WEBM.");
        return;
      }
      if (isImage && file.size > MAX_IMAGE) {
        setError("Imagem acima do limite de 5 MB.");
        return;
      }
      if (isVideo && file.size > MAX_VIDEO) {
        setError("Vídeo acima do limite de 300 MB.");
        return;
      }

      setIsUploading(true);
      setProgress(0);
      try {
        const result = await upload(file.name, file, {
          access: "public",
          handleUploadUrl: "/api/files/upload",
          multipart: isVideo,
          clientPayload: JSON.stringify({
            userId,
            source: "campaign_media",
          }),
          onUploadProgress: (event) => setProgress(event.percentage),
        });

        const registerResponse = await fetch("/api/files/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "register",
            userId,
            blobUrl: result.url,
            pathname: result.pathname,
            contentType: result.contentType,
            source: "campaign_media",
          }),
        });
        if (!registerResponse.ok) {
          const data = await registerResponse.json().catch(() => ({}));
          throw new Error(
            data.error ?? "Falha ao registrar o upload. Tente novamente.",
          );
        }

        const next: DeviceUploadSelection = {
          blobUrl: result.url,
          mediaType: isVideo ? "video" : "image",
          previewUrl: URL.createObjectURL(file),
        };
        onSelect(maxSelection === 1 ? [next] : [...selected, next]);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Falha ao enviar o arquivo.",
        );
      } finally {
        setIsUploading(false);
      }
    },
    [maxSelection, onSelect, selected, userId],
  );

  return (
    <div className="flex flex-col gap-3 py-4">
      {selected.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {selected.map((item) => (
            <div key={item.blobUrl} className="relative">
              {item.mediaType === "video" ? (
                <video
                  src={item.previewUrl}
                  className="aspect-square w-full rounded-lg border object-cover"
                  controls
                />
              ) : (
                <img
                  src={item.previewUrl}
                  alt="Mídia enviada"
                  className="aspect-square w-full rounded-lg border object-cover"
                />
              )}
              <button
                type="button"
                onClick={() =>
                  onSelect(selected.filter((entry) => entry.blobUrl !== item.blobUrl))
                }
                className="absolute -right-2 -top-2 flex size-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow"
                aria-label="Remover"
              >
                <X className="size-3.5" />
              </button>
              {item.mediaType === "video" ? (
                <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                  <VideoIcon className="size-3" />
                  Vídeo
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {remaining > 0 ? (
        <button
          type="button"
          disabled={isUploading}
          onClick={() => inputRef.current?.click()}
          className={cn(
            "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border px-6 py-10 text-center transition-colors",
            isUploading ? "opacity-70" : "hover:border-primary/40",
          )}
        >
          {isUploading ? (
            <Loader2 className="size-7 animate-spin text-muted-foreground" />
          ) : (
            <UploadCloud className="size-7 text-muted-foreground" />
          )}
          <span className="text-sm font-medium">
            {isUploading
              ? "Enviando..."
              : selected.length > 0
                ? "Adicionar outro arquivo"
                : "Selecionar arquivo do dispositivo"}
          </span>
          <span className="text-xs text-muted-foreground">
            Imagem (JPG/PNG, até 5 MB) ou vídeo (MP4/MOV/WEBM, até 300 MB)
            {maxSelection > 1 ? ` · até ${remaining} restante(s)` : ""}
          </span>
        </button>
      ) : null}

      {isUploading && (
        <div className="space-y-1">
          <Progress value={progress} />
          <p className="text-right text-[11px] text-muted-foreground">
            {progress}%
          </p>
        </div>
      )}

      {error && (
        <p className="text-center text-xs text-destructive">{error}</p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
