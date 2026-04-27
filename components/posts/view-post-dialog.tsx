"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { ReferenceImagesGallery } from "./reference-images-gallery";
import { useIsMobile } from "@/hooks/use-mobile";

type ViewPostDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  post: {
    id: string;
    prompt: string;
    aspectRatio: string;
    imageUrl: string | null;
    currentImageUrl: string | null;
    referenceImages?: { id: string; imageUrl: string }[];
  } | null;
  targetUserId: string;
  targetUserEmail: string;
  onGenerateClick?: () => void;
};

export function ViewPostDialog({
  open,
  onOpenChange,
  post,
  targetUserId,
  targetUserEmail,
  onGenerateClick,
}: ViewPostDialogProps) {
  const isMobile = useIsMobile();
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [postDetails, setPostDetails] = useState<{
    prompt: string;
    aspectRatio: string;
    referenceImages: { id: string; imageUrl: string }[];
  } | null>(null);

  useEffect(() => {
    if (open && post) {
      setIsLoadingDetails(true);
      // Fetch full post details to get reference images
      fetch(`/api/posts/${post.id}`)
        .then((res) => {
          if (res.ok) {
            return res.json();
          }
          throw new Error("Failed to fetch post details");
        })
        .then((data) => {
          setPostDetails({
            prompt: data.prompt ?? post.prompt,
            aspectRatio: data.aspectRatio ?? post.aspectRatio,
            referenceImages: data.referenceImages ?? [],
          });
        })
        .catch(() => {
          // Fallback to post data if API fails
          setPostDetails({
            prompt: post.prompt,
            aspectRatio: post.aspectRatio,
            referenceImages: post.referenceImages ?? [],
          });
        })
        .finally(() => {
          setIsLoadingDetails(false);
        });
    } else if (!open) {
      setPostDetails(null);
    }
  }, [open, post]);

  const handleGenerateClick = () => {
    onOpenChange(false);
    onGenerateClick?.();
  };

  const mainImage = post?.currentImageUrl || post?.imageUrl;
  const referenceImages = postDetails?.referenceImages ?? post?.referenceImages ?? [];
  const prompt = postDetails?.prompt ?? post?.prompt ?? "";
  const aspectRatio = postDetails?.aspectRatio ?? post?.aspectRatio ?? "1:1";

  const content = (
    <div className="space-y-6">
      {/* Input Section */}
      <div className="space-y-4">
        <div>
          <Label className="text-sm font-medium">Imagens de Referência</Label>
          {isLoadingDetails ? (
            <p className="mt-2 text-sm text-muted-foreground">Carregando...</p>
          ) : referenceImages.length > 0 ? (
            <div className="mt-2">
              <ReferenceImagesGallery images={referenceImages} />
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              Sem imagens de referência
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-medium">Prompt</Label>
          <div className="rounded-md bg-muted p-3">
            <p className="whitespace-pre-wrap text-sm">{prompt}</p>
          </div>
        </div>
      </div>

      {/* Result Section */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">Imagem Gerada</Label>
        {mainImage ? (
          <div className="flex justify-center">
            <img
              src={mainImage}
              alt="Post gerado"
              className="max-w-md w-full rounded-md border"
            />
          </div>
        ) : (
          <div className="flex h-64 items-center justify-center rounded-md bg-muted text-muted-foreground">
            Sem imagem disponível
          </div>
        )}
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Ver Post</SheetTitle>
            <SheetDescription>
              Detalhes do post de {targetUserEmail}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4">{content}</div>
          <SheetFooter className="mt-6">
            <Button onClick={handleGenerateClick} className="w-full">
              Gerar
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ver Post</DialogTitle>
          <DialogDescription>
            Detalhes do post de {targetUserEmail}
          </DialogDescription>
        </DialogHeader>
        {content}
        <DialogFooter className="mt-4">
          <Button onClick={handleGenerateClick} className="w-full">
            Gerar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
