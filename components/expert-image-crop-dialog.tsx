"use client";

import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Check, Crop, Loader2, RotateCcw, ZoomIn } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  clampCropOffset,
  getCoverScale,
  getCropSourceRect,
  type CropOffset,
  type FrameSize,
  type ImageSize,
} from "@/lib/products/image-crop";
import {
  PRODUCT_COVER_ASPECT_RATIO,
  PRODUCT_COVER_OUTPUT_HEIGHT,
  PRODUCT_COVER_OUTPUT_WIDTH,
} from "@/lib/products/product-cover-spec";

export type ImageCropConfig = {
  title: string;
  description: string;
  aspectRatio: number;
  outputWidth: number;
  outputHeight: number;
  mask: "circle" | "rect";
  outputFilenameStem: string;
  previewAlt: string;
};

export const EXPERT_IMAGE_CROP_CONFIG: ImageCropConfig = {
  title: "Ajustar foto de perfil",
  description:
    "Arraste a imagem para escolher o enquadramento. A área dentro do círculo será exibida no perfil.",
  aspectRatio: 1,
  outputWidth: 512,
  outputHeight: 512,
  mask: "circle",
  outputFilenameStem: "foto-do-expert",
  previewAlt: "Prévia da foto do expert",
};

export const PRODUCT_COVER_CROP_CONFIG: ImageCropConfig = {
  title: "Ajustar capa do produto",
  description:
    "Arraste a imagem para escolher o enquadramento. A capa será exibida em 16:9 no checkout e na biblioteca do cliente.",
  aspectRatio: PRODUCT_COVER_ASPECT_RATIO,
  outputWidth: PRODUCT_COVER_OUTPUT_WIDTH,
  outputHeight: PRODUCT_COVER_OUTPUT_HEIGHT,
  mask: "rect",
  outputFilenameStem: "capa-do-produto",
  previewAlt: "Prévia da capa do produto",
};

type ImageCropDialogProps = {
  file: File | null;
  open: boolean;
  config: ImageCropConfig;
  onCancel: () => void;
  onConfirm: (file: File) => void;
};

export function ImageCropDialog({
  file,
  open,
  config,
  onCancel,
  onConfirm,
}: ImageCropDialogProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    offset: CropOffset;
  } | null>(null);
  const [imageSize, setImageSize] = useState<ImageSize | null>(null);
  const [frameSize, setFrameSize] = useState<FrameSize>({
    width: 320,
    height: 320,
  });
  const [offset, setOffset] = useState<CropOffset>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [processing, setProcessing] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const nextPreviewUrl = URL.createObjectURL(file);
    setPreviewUrl(nextPreviewUrl);
    return () => {
      URL.revokeObjectURL(nextPreviewUrl);
    };
  }, [file]);

  useEffect(() => {
    if (!open) return;
    setImageSize(null);
    setOffset({ x: 0, y: 0 });
    setZoom(1);
    setProcessing(false);
  }, [open, file]);

  useEffect(() => {
    if (!open || !frameRef.current) return;

    const updateFrameSize = () => {
      const element = frameRef.current;
      if (!element) return;
      setFrameSize({
        width: element.clientWidth,
        height: element.clientHeight,
      });
    };

    updateFrameSize();
    const observer = new ResizeObserver(updateFrameSize);
    observer.observe(frameRef.current);
    return () => observer.disconnect();
  }, [open, config.aspectRatio]);

  function updateZoom(nextZoom: number) {
    setZoom(nextZoom);
    if (imageSize) {
      setOffset((current) =>
        clampCropOffset(current, imageSize, frameSize, nextZoom),
      );
    }
  }

  function resetCrop() {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }

  function beginDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!imageSize) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offset,
    };
  }

  function moveImage(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !imageSize) return;
    setOffset(
      clampCropOffset(
        {
          x: drag.offset.x + event.clientX - drag.startX,
          y: drag.offset.y + event.clientY - drag.startY,
        },
        imageSize,
        frameSize,
        zoom,
      ),
    );
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  }

  async function confirmCrop() {
    if (!file || !previewUrl || !imageSize) return;
    setProcessing(true);
    try {
      const image = new Image();
      image.src = previewUrl;
      await image.decode();

      const crop = getCropSourceRect(imageSize, frameSize, zoom, offset);
      const canvas = document.createElement("canvas");
      canvas.width = config.outputWidth;
      canvas.height = config.outputHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Não foi possível preparar a imagem.");

      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(
        image,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
        0,
        0,
        config.outputWidth,
        config.outputHeight,
      );

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (result) =>
            result
              ? resolve(result)
              : reject(new Error("Não foi possível recortar a imagem.")),
          "image/webp",
          0.9,
        );
      });
      const baseName = file.name.replace(/\.[^.]+$/, "") || config.outputFilenameStem;
      onConfirm(
        new File([blob], `${baseName}-recortada.webp`, {
          type: "image/webp",
          lastModified: Date.now(),
        }),
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível preparar a imagem.",
      );
    } finally {
      setProcessing(false);
    }
  }

  const displayScale = imageSize
    ? getCoverScale(imageSize, frameSize) * zoom
    : 1;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Crop className="size-4" /> {config.title}
          </DialogTitle>
          <DialogDescription>{config.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div
            ref={frameRef}
            className="relative mx-auto w-full max-w-80 touch-none cursor-grab select-none overflow-hidden rounded-xl bg-muted active:cursor-grabbing"
            style={{ aspectRatio: config.aspectRatio }}
            onPointerDown={beginDrag}
            onPointerMove={moveImage}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt={config.previewAlt}
                draggable={false}
                className="pointer-events-none absolute max-w-none"
                style={
                  imageSize
                    ? {
                        width: imageSize.width * displayScale,
                        height: imageSize.height * displayScale,
                        left: `calc(50% + ${offset.x}px)`,
                        top: `calc(50% + ${offset.y}px)`,
                        transform: "translate(-50%, -50%)",
                      }
                    : undefined
                }
                onLoad={(event) =>
                  setImageSize({
                    width: event.currentTarget.naturalWidth,
                    height: event.currentTarget.naturalHeight,
                  })
                }
              />
            ) : null}
            {config.mask === "circle" ? (
              <>
                <div className="pointer-events-none absolute inset-0 rounded-full border-2 border-white/90 shadow-[0_0_0_999px_rgba(0,0,0,0.55)]" />
                <div className="pointer-events-none absolute inset-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/70" />
              </>
            ) : (
              <div className="pointer-events-none absolute inset-0 rounded-lg border-2 border-white/90 shadow-[0_0_0_999px_rgba(0,0,0,0.55)]" />
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="image-crop-zoom" className="flex items-center gap-2">
                <ZoomIn className="size-4" /> Zoom
              </Label>
              <Button type="button" variant="ghost" size="sm" onClick={resetCrop}>
                <RotateCcw className="size-3.5" /> Redefinir
              </Button>
            </div>
            <Slider
              id="image-crop-zoom"
              min={1}
              max={3}
              step={0.01}
              value={[zoom]}
              onValueChange={([value]) => updateZoom(value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} disabled={processing}>
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={() => void confirmCrop()}
            disabled={!imageSize || processing}
          >
            {processing ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            {processing ? "Preparando..." : "Usar esta imagem"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type PresetImageCropDialogProps = Omit<ImageCropDialogProps, "config">;

export function ExpertImageCropDialog(props: PresetImageCropDialogProps) {
  return <ImageCropDialog {...props} config={EXPERT_IMAGE_CROP_CONFIG} />;
}

export function ProductCoverCropDialog(props: PresetImageCropDialogProps) {
  return <ImageCropDialog {...props} config={PRODUCT_COVER_CROP_CONFIG} />;
}
