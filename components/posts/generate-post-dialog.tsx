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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";

type GenerateDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultPrompt?: string;
  defaultAspectRatio?: string;
  defaultReferenceImages?: string[];
  targetUserId: string;
  targetUserEmail: string;
  sourceUserGeneratedImageId?: string;
  sourceBackofficePostId?: string;
  onGenerated?: (result: {
    id: string;
    imageUrl: string;
    caption: string | null;
  }) => void;
};

const ASPECT_RATIOS = [
  { value: "1:1", label: "Quadrado (1:1)" },
  { value: "16:9", label: "Paisagem (16:9)" },
  { value: "9:16", label: "Retrato (9:16)" },
  { value: "4:3", label: "Padrão (4:3)" },
  { value: "3:4", label: "Retrato (3:4)" },
];

export function GeneratePostDialog({
  open,
  onOpenChange,
  defaultPrompt = "",
  defaultAspectRatio = "1:1",
  defaultReferenceImages = [],
  targetUserId,
  targetUserEmail,
  sourceUserGeneratedImageId,
  sourceBackofficePostId,
  onGenerated,
}: GenerateDialogProps) {
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [aspectRatio, setAspectRatio] = useState(defaultAspectRatio);
  const [notes, setNotes] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    id: string;
    imageUrl: string;
    caption: string | null;
  } | null>(null);

  useEffect(() => {
    if (open) {
      setPrompt(defaultPrompt);
      setAspectRatio(defaultAspectRatio);
      setNotes("");
      setResult(null);
      setError(null);
      setProgress(0);
    }
  }, [open, defaultPrompt, defaultAspectRatio]);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;

    setIsGenerating(true);
    setError(null);
    setProgress(10);

    try {
      const formData = new FormData();
      formData.append("prompt", prompt);
      formData.append("aspectRatio", aspectRatio);
      formData.append("targetUserId", targetUserId);
      if (sourceUserGeneratedImageId) formData.append("sourceUserGeneratedImageId", sourceUserGeneratedImageId);
      if (sourceBackofficePostId)
        formData.append("sourceBackofficePostId", sourceBackofficePostId);
      if (notes) formData.append("notes", notes);

      formData.append(
        "referenceImageCount",
        String(defaultReferenceImages.length)
      );
      for (let i = 0; i < defaultReferenceImages.length; i++) {
        formData.append(`referenceImage_${i}`, defaultReferenceImages[i]);
      }

      setProgress(30);

      const response = await fetch("/api/posts/generate", {
        method: "POST",
        body: formData,
      });

      setProgress(90);

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Falha na geração");
      }

      const data = await response.json();
      setProgress(100);
      setResult(data);
      onGenerated?.(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleClose = () => {
    if (!isGenerating) {
      setResult(null);
      setError(null);
      setProgress(0);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Gerar Novo Post</DialogTitle>
          <DialogDescription>
            Gerando post baseado no conteúdo de {targetUserEmail}
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-4">
            <img
              src={result.imageUrl}
              alt="Post gerado"
              className="w-full rounded-md border"
            />
            {result.caption && (
              <div>
                <Label className="text-xs text-muted-foreground">Legenda gerada</Label>
                <p className="mt-1 whitespace-pre-wrap text-sm">{result.caption}</p>
              </div>
            )}
            <DialogFooter>
              <Button onClick={handleClose}>Fechar</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="prompt">Prompt</Label>
              <Textarea
                id="prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Descreva o post que deseja gerar..."
                rows={5}
                disabled={isGenerating}
              />
            </div>

            <div className="space-y-2">
              <Label>Proporção</Label>
              <Select
                value={aspectRatio}
                onValueChange={(v) => v && setAspectRatio(v)}
                disabled={isGenerating}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASPECT_RATIOS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {defaultReferenceImages.length > 0 && (
              <div className="space-y-2">
                <Label>Imagens de Referência ({defaultReferenceImages.length})</Label>
                <div className="flex flex-wrap gap-2">
                  {defaultReferenceImages.map((url, i) => (
                    <img
                      key={`ref-${url.slice(-10)}-${i}`}
                      src={url}
                      alt={`Ref ${i + 1}`}
                      className="h-16 w-16 rounded-md border object-cover"
                    />
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="notes">Notas (opcional)</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Notas internas sobre esta geração..."
                rows={2}
                disabled={isGenerating}
              />
            </div>

            {isGenerating && (
              <div className="space-y-2">
                <Progress value={progress} />
                <p className="text-center text-sm text-muted-foreground">
                  Gerando post... Isso pode levar alguns segundos.
                </p>
              </div>
            )}

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={handleClose} disabled={isGenerating}>
                Cancelar
              </Button>
              <Button
                onClick={handleGenerate}
                disabled={isGenerating || !prompt.trim()}
              >
                {isGenerating ? "Gerando..." : "Gerar Post"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
