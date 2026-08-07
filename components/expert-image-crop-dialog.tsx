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
  type ImageSize,
} from "@/lib/products/image-crop";

const OUTPUT_SIZE = 512;

type ExpertImageCropDialogProps = {
  file: File | null;
  open: boolean;
  onCancel: () => void;
  onConfirm: (file: File) => void;
};

export function ExpertImageCropDialog({
  file,
  open,
  onCancel,
  onConfirm,
}: ExpertImageCropDialogProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    offset: CropOffset;
  } | null>(null);
  const [imageSize, setImageSize] = useState<ImageSize | null>(null);
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

  function frameSize() {
    return frameRef.current?.clientWidth ?? 320;
  }

  function updateZoom(nextZoom: number) {
    setZoom(nextZoom);
    if (imageSize) {
      setOffset((current) =>
        clampCropOffset(current, imageSize, frameSize(), nextZoom),
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
        frameSize(),
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

      const crop = getCropSourceRect(
        imageSize,
        frameSize(),
        zoom,
        offset,
      );
      const canvas = document.createElement("canvas");
      canvas.width = OUTPUT_SIZE;
      canvas.height = OUTPUT_SIZE;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Não foi possível preparar a imagem.");

      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(
        image,
        crop.x,
        crop.y,
        crop.size,
        crop.size,
        0,
        0,
        OUTPUT_SIZE,
        OUTPUT_SIZE,
      );

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (result) =>
            result ? resolve(result) : reject(new Error("Não foi possível recortar a imagem.")),
          "image/webp",
          0.9,
        );
      });
      const baseName = file.name.replace(/\.[^.]+$/, "") || "foto-do-expert";
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
    ? getCoverScale(imageSize, frameSize()) * zoom
    : 1;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Crop className="size-4" /> Ajustar foto de perfil
          </DialogTitle>
          <DialogDescription>
            Arraste a imagem para escolher o enquadramento. A área dentro do círculo será exibida no perfil.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div
            ref={frameRef}
            className="relative mx-auto aspect-square w-full max-w-80 touch-none cursor-grab select-none overflow-hidden rounded-xl bg-muted active:cursor-grabbing"
            onPointerDown={beginDrag}
            onPointerMove={moveImage}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt="Prévia da foto do expert"
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
            <div className="pointer-events-none absolute inset-0 rounded-full border-2 border-white/90 shadow-[0_0_0_999px_rgba(0,0,0,0.55)]" />
            <div className="pointer-events-none absolute inset-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/70" />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="expert-image-zoom" className="flex items-center gap-2">
                <ZoomIn className="size-4" /> Zoom
              </Label>
              <Button type="button" variant="ghost" size="sm" onClick={resetCrop}>
                <RotateCcw className="size-3.5" /> Redefinir
              </Button>
            </div>
            <Slider
              id="expert-image-zoom"
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
          <Button type="button" onClick={() => void confirmCrop()} disabled={!imageSize || processing}>
            {processing ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            {processing ? "Preparando..." : "Usar esta foto"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
