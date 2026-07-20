"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { type VideoTemplate } from "@/lib/db/schema";
import { VideoTemplateDialog } from "./video-template-dialog";
import { toast } from "sonner";

export function VideoTemplatesClient({
  initialTemplates,
}: {
  initialTemplates: VideoTemplate[];
}) {
  const router = useRouter();
  const [templates, setTemplates] = useState(initialTemplates);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<VideoTemplate | null>(
    null
  );

  const handleCreate = () => {
    setSelectedTemplate(null);
    setDialogOpen(true);
  };

  const handleEdit = (template: VideoTemplate) => {
    setSelectedTemplate(template);
    setDialogOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Tem certeza que deseja remover este template?")) return;

    try {
      const res = await fetch(`/api/backoffice/video-templates?id=${id}`, {
        method: "DELETE",
      });

      if (!res.ok) throw new Error("Erro ao excluir");

      setTemplates((prev) => prev.filter((t) => t.id !== id));
      toast.success("Template excluído com sucesso");
      router.refresh();
    } catch (error) {
      toast.error("Erro ao excluir template");
    }
  };

  const handleSave = (savedTemplate: VideoTemplate) => {
    setTemplates((prev) => {
      const exists = prev.find((t) => t.id === savedTemplate.id);
      if (exists) {
        return prev.map((t) => (t.id === savedTemplate.id ? savedTemplate : t));
      }
      return [...prev, savedTemplate];
    });
    router.refresh();
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={handleCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Novo Template
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Thumbnail</TableHead>
              <TableHead>Nome</TableHead>
              <TableHead>Preview</TableHead>
              <TableHead>ID Creatomate</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {templates.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  Nenhum template cadastrado.
                </TableCell>
              </TableRow>
            ) : (
              templates.map((template) => (
                <TableRow key={template.id}>
                  <TableCell>
                    {template.thumbnailUrl ? (
                      <img
                        src={template.thumbnailUrl}
                        alt={template.name}
                        className="h-12 w-12 rounded object-cover"
                      />
                    ) : (
                      <div className="h-12 w-12 rounded bg-muted flex items-center justify-center text-xs">
                        Sem Img
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="font-medium">{template.name}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant={template.thumbnailUrl ? "secondary" : "outline"}>
                        {template.thumbnailUrl ? "Thumbnail OK" : "Sem thumbnail"}
                      </Badge>
                      <Badge variant={template.videoPreviewUrl ? "default" : "outline"}>
                        {template.videoPreviewUrl ? "Video OK" : "Sem video"}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <code className="bg-muted px-1 py-0.5 rounded text-xs">
                      {template.creatomateTemplateId}
                    </code>
                  </TableCell>
                  <TableCell>
                    <Badge variant={template.status === "active" ? "default" : "secondary"}>
                      {template.status === "active" ? "Ativo" : "Inativo"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleEdit(template)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive"
                      onClick={() => handleDelete(template.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <VideoTemplateDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        template={selectedTemplate}
        onSave={handleSave}
      />
    </div>
  );
}
