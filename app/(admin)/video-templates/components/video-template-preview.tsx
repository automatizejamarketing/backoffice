"use client";

import { useState } from "react";
import { Play, ImageOff, Loader2 } from "lucide-react";

interface VideoTemplatePreviewProps {
  videoPreviewUrl?: string | null;
  thumbnailUrl?: string | null;
  name?: string;
  isLoading?: boolean;
}

export function VideoTemplatePreview({
  videoPreviewUrl,
  thumbnailUrl,
  name,
  isLoading = false,
}: VideoTemplatePreviewProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasError, setHasError] = useState(false);

  if (isLoading) {
    return (
      <div className="flex aspect-[9/16] w-full flex-col items-center justify-center gap-3 bg-muted">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Gerando preview...</span>
      </div>
    );
  }

  if (hasError || (!videoPreviewUrl && !thumbnailUrl)) {
    return (
      <div className="flex aspect-[9/16] w-full flex-col items-center justify-center gap-3 bg-muted text-muted-foreground">
        <ImageOff className="h-8 w-8" />
        <span className="text-sm">Preview será gerado automaticamente</span>
      </div>
    );
  }

  if (videoPreviewUrl) {
    return (
      <div className="group relative overflow-hidden rounded-xl bg-black">
        <video
          key={videoPreviewUrl}
          src={videoPreviewUrl}
          poster={thumbnailUrl || undefined}
          controls
          muted
          loop
          playsInline
          className="aspect-[9/16] w-full object-cover"
          onError={() => setHasError(true)}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
        />
        {!isPlaying && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90">
              <Play className="h-6 w-6 fill-primary text-primary" />
            </div>
          </div>
        )}
      </div>
    );
  }

  if (thumbnailUrl) {
    return (
      <div className="group relative overflow-hidden rounded-xl bg-black">
        <img
          src={thumbnailUrl}
          alt={name || "Thumbnail do template"}
          className="aspect-[9/16] w-full object-cover"
          onError={() => setHasError(true)}
        />
        <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90">
            <Play className="h-6 w-6 fill-primary text-primary" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex aspect-[9/16] w-full flex-col items-center justify-center gap-3 bg-muted text-muted-foreground">
      <ImageOff className="h-8 w-8" />
      <span className="text-sm">Nenhum preview configurado</span>
    </div>
  );
}