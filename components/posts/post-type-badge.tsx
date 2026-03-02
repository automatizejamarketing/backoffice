import { Badge } from "@/components/ui/badge";

const POST_TYPE_LABELS: Record<string, string> = {
  post_do_prato: "Post do Prato",
  post_criativo: "Post Criativo",
  story_turbo: "Story Turbo",
  post_interativo: "Post Interativo",
  criador_video: "Criador de Vídeo",
  campanha_whatsapp: "Campanha WhatsApp",
  canvas: "Canvas",
  estilo_livre: "Estilo Livre",
};

const POST_TYPE_VARIANTS: Record<string, "default" | "secondary" | "outline"> = {
  post_do_prato: "default",
  post_criativo: "secondary",
  story_turbo: "outline",
};

export function PostTypeBadge({ type }: { type: string | null }) {
  if (!type) return <Badge variant="outline">Sem tipo</Badge>;
  return (
    <Badge variant={POST_TYPE_VARIANTS[type] ?? "outline"}>
      {POST_TYPE_LABELS[type] ?? type}
    </Badge>
  );
}

const STATUS_LABELS: Record<string, string> = {
  draft: "Rascunho",
  ready: "Pronto",
  scheduled: "Agendado",
  posted: "Publicado",
  failed: "Falhou",
  generating: "Gerando",
  completed: "Concluído",
};

export function StatusBadge({ status }: { status: string }) {
  const variant =
    status === "posted" || status === "completed"
      ? "default"
      : status === "failed"
        ? "secondary"
        : "outline";
  return <Badge variant={variant}>{STATUS_LABELS[status] ?? status}</Badge>;
}
