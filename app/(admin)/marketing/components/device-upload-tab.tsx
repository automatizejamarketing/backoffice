"use client";

import { useCallback, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { Loader2, UploadCloud, Video as VideoIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  selected: DeviceUploadSelection | null;
  onSelect: (selection: DeviceUploadSelection | null) => void;
};

export function DeviceUploadTab({
  userId,
  selected,
  onSelect,
}: DeviceUploadTabProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

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

        // Persist the blob_uploads row while the admin session cookie is
        // present (proxy.ts would block Vercel's cookie-less callback).
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

        onSelect({
          blobUrl: result.url,
          mediaType: isVideo ? "video" : "image",
          previewUrl: URL.createObjectURL(file),
        });
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Falha ao enviar o arquivo.",
        );
      } finally {
        setIsUploading(false);
      }
    },
    [onSelect, userId],
  );

  if (selected) {
    return (
      <div className="flex flex-col items-center gap-3 py-6">
        <div className="relative">
          {selected.mediaType === "video" ? (
            <video
              src={selected.previewUrl}
              className="max-h-56 rounded-lg border"
              controls
            />
          ) : (
            <img
              src={selected.previewUrl}
              alt="Mídia enviada"
              className="max-h-56 rounded-lg border object-contain"
            />
          )}
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="absolute -right-2 -top-2 flex size-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow"
            aria-label="Remover"
          >
            <X className="size-3.5" />
          </button>
        </div>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {selected.mediaType === "video" ? (
            <VideoIcon className="size-3.5" />
          ) : null}
          Arquivo enviado e pronto para uso.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 py-4">
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
          {isUploading ? "Enviando..." : "Selecionar arquivo do dispositivo"}
        </span>
        <span className="text-xs text-muted-foreground">
          Imagem (JPG/PNG, até 5 MB) ou vídeo (MP4/MOV/WEBM, até 300 MB)
        </span>
      </button>

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
