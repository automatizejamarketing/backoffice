"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertCircle, ImageOff } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { type VideoTemplate } from "@/lib/db/schema";
import { toast } from "sonner";

const formSchema = z.object({
  name: z.string().min(1, "Obrigatório"),
  description: z.string().optional(),
  creatomateTemplateId: z.string().min(1, "Obrigatório"),
  videoSourceKey: z.string().min(1, "Obrigatório").default("Video-1"),
  thumbnailUrl: z.string().url("URL inválida").optional().or(z.literal("")),
  videoPreviewUrl: z.string().url("URL inválida").optional().or(z.literal("")),
  category: z.string().optional(),
  maxDuration: z.coerce.number().int().positive().optional().or(z.literal("")),
  status: z.enum(["active", "inactive"]),
});

type FormValues = z.infer<typeof formSchema>;
type FormInputValues = z.input<typeof formSchema>;

export function VideoTemplateDialog({
  open,
  onOpenChange,
  template,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: VideoTemplate | null;
  onSave: (template: VideoTemplate) => void;
}) {
  const form = useForm<FormInputValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      description: "",
      creatomateTemplateId: "",
      videoSourceKey: "Video-1",
      thumbnailUrl: "",
      videoPreviewUrl: "",
      category: "",
      maxDuration: "",
      status: "inactive",
    },
  });

  useEffect(() => {
    if (open) {
      if (template) {
        form.reset({
          name: template.name,
          description: template.description || "",
          creatomateTemplateId: template.creatomateTemplateId,
          videoSourceKey: template.videoSourceKey,
          thumbnailUrl: template.thumbnailUrl || "",
          videoPreviewUrl: template.videoPreviewUrl || "",
          category: template.category || "",
          maxDuration: template.maxDuration || "",
          status: template.status,
        });
      } else {
        form.reset({
          name: "",
          description: "",
          creatomateTemplateId: "",
          videoSourceKey: "Video-1",
          thumbnailUrl: "",
          videoPreviewUrl: "",
          category: "",
          maxDuration: "",
          status: "inactive",
        });
      }
    }
  }, [open, template, form]);

  const onSubmit = async (data: FormInputValues) => {
    try {
      const res = await fetch("/api/backoffice/video-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          videoSourceKey: data.videoSourceKey ?? "Video-1",
          id: template?.id,
        }),
      });

      const payload = (await res.json().catch(() => null)) as
        | { error?: string }
        | VideoTemplate
        | null;

      if (!res.ok) {
        const message =
          (payload && "error" in payload && payload.error) ||
          (res.status === 401 ? "Faça login como admin para salvar." : null) ||
          "Erro ao salvar template";
        throw new Error(message);
      }

      const saved = payload as VideoTemplate;
      toast.success("Template salvo com sucesso!");
      onSave(saved);
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Erro ao salvar template"
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            {template ? "Editar Template" : "Novo Template"}
          </DialogTitle>
          <DialogDescription>
            Cadastre links de thumbnail e video preview para que o cliente consiga
            visualizar a referencia antes de escolher o estilo.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Nome</FormLabel>
                        <FormControl>
                          <Input placeholder="Ex: Upgrade de Estúdio" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="status"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Status</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Selecione..." />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="active">Ativo</SelectItem>
                            <SelectItem value="inactive">Inativo</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Descrição</FormLabel>
                      <FormControl>
                        <Textarea placeholder="Breve descrição da referência..." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="creatomateTemplateId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Creatomate Template ID</FormLabel>
                        <FormControl>
                          <Input placeholder="Ex: abc123def456" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="videoSourceKey"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Chave do Vídeo Base (RenderScript)</FormLabel>
                        <FormControl>
                          <Input placeholder="Ex: Video-1" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="maxDuration"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Duração Máxima (segundos)</FormLabel>
                        <FormControl>
                          <Input type="number" placeholder="Ex: 30" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="thumbnailUrl"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>URL da Thumbnail</FormLabel>
                        <FormControl>
                          <Input placeholder="https://..." {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="videoPreviewUrl"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>URL do Vídeo Preview (MP4)</FormLabel>
                        <FormControl>
                          <Input placeholder="https://..." {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
                <div>
                  <h3 className="font-medium">Preview do cliente</h3>
                  <p className="text-sm text-muted-foreground">
                    O que aparecer aqui sera exibido na etapa de referencia do Criar Video.
                  </p>
                </div>

                <div className="overflow-hidden rounded-xl border bg-black">
                  {form.watch("videoPreviewUrl") ? (
                    <video
                      key={form.watch("videoPreviewUrl")}
                      src={form.watch("videoPreviewUrl")}
                      poster={form.watch("thumbnailUrl") || undefined}
                      controls
                      muted
                      loop
                      playsInline
                      className="aspect-[9/16] w-full object-cover"
                    />
                  ) : form.watch("thumbnailUrl") ? (
                    <img
                      src={form.watch("thumbnailUrl") || ""}
                      alt={form.watch("name") || "Thumbnail do template"}
                      className="aspect-[9/16] w-full object-cover"
                    />
                  ) : (
                    <div className="flex aspect-[9/16] w-full flex-col items-center justify-center gap-3 bg-muted text-muted-foreground">
                      <ImageOff className="h-8 w-8" />
                      <span className="text-sm">Nenhum preview configurado</span>
                    </div>
                  )}
                </div>

                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <p>
                      Recomendado: cadastre pelo menos uma thumbnail. Para uma experiencia
                      melhor, adicione tambem um MP4 curto em <code>videoPreviewUrl</code>.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="mr-2">
                Cancelar
              </Button>
              <Button type="submit">Salvar</Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
