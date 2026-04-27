"use client";

import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function ReferenceImagesGallery({
  images,
}: {
  images: { id: string; imageUrl: string }[];
}) {
  if (images.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Sem imagens de referência
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-3">
      {images.map((img) => (
        <Dialog key={img.id}>
          <DialogTrigger asChild>
            <button
              type="button"
              className="overflow-hidden rounded-md border hover:ring-2 hover:ring-primary transition-all"
            >
              <img
                src={img.imageUrl}
                alt="Referência"
                className="h-20 w-20 object-cover"
              />
            </button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogTitle className="sr-only">Imagem de referência</DialogTitle>
            <img
              src={img.imageUrl}
              alt="Referência"
              className="w-full rounded-md"
            />
          </DialogContent>
        </Dialog>
      ))}
    </div>
  );
}
