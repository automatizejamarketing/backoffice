import { z } from "zod";
import { normalizeBrazilianPhone } from "@/lib/phone";

export const campaignInput = z.object({
  title: z.string().trim().min(1).max(160),
  templateName: z.string().regex(/^[a-z0-9_]{1,255}$/),
  body: z.string().trim().min(1).max(1024),
  unitCostMicros: z.number().int().min(0).max(100_000_000),
  budgetMicros: z.number().int().min(0).max(100_000_000_000),
}).superRefine((value, ctx) => {
  if (value.body.replaceAll("{{1}}", "").match(/{{|}}|\[(?:LINK|NOME|PERÍODO|RESULTADO)/)) {
    ctx.addIssue({ code: "custom", path: ["body"], message: "Use apenas {{1}} para o primeiro nome e substitua todos os links pendentes." });
  }
});

export function campaignPhone(value: string | null): string | null {
  const digits = normalizeBrazilianPhone(value);
  return digits && /^[1-9]{2}(?:9\d{8}|[2-5]\d{7})$/.test(digits) ? `55${digits}` : null;
}

export function firstName(name: string | null): string {
  return name?.trim().split(/\s+/)[0]?.slice(0, 60) || "tudo bem";
}

export function campaignTemplateDefinition(name: string, body: string) {
  return {
    name, language: "pt_BR", category: "MARKETING",
    components: [{ type: "BODY", text: body,
      ...(body.includes("{{1}}") ? { example: { body_text: [["João"]] } } : {}),
    }],
  };
}

export function assertSchedule(input: {
  scheduledAt: Date; now: Date; count: number; unitCostMicros: number;
  budgetMicros: number; templateStatus: string; templateBody: string; body: string;
  dispatchMode?: "manual" | "scheduled";
}) {
  if (!Number.isFinite(input.scheduledAt.getTime()) || (input.dispatchMode !== "manual" && input.scheduledAt <= input.now))
    throw new Error("Escolha uma data e hora futuras (horário de Brasília).");
  if (!input.count) throw new Error("Nenhum destinatário elegível selecionado.");
  if (input.templateStatus !== "APPROVED" || input.templateBody !== input.body)
    throw new Error("O texto precisa corresponder ao template aprovado pela Meta.");
  if (input.unitCostMicros <= 0 || input.count * input.unitCostMicros > input.budgetMicros)
    throw new Error("A estimativa excede o orçamento. Ajuste o público ou o orçamento.");
}

export const CAMPAIGN_STATE_LABELS: Record<string, string> = {
  draft: "Rascunho salvo", scheduled: "Agendada", paused: "Pausada", completed: "Concluída",
};
export const RECIPIENT_STATE_LABELS: Record<string, string> = {
  pending: "Na fila", sending: "Em envio", sent: "Enviado", failed: "Falhou",
  skipped: "Não elegível", unknown: "Verificar envio", excluded: "Excluído",
};


export type CampaignMetaLookup = "found" | "missing" | "unavailable" | "disconnected";
export function campaignMetaLookupLabel(lookup: CampaignMetaLookup): string {
  return { found: "Consultado", missing: "Template não encontrado", unavailable: "Consulta indisponível", disconnected: "Conexão pendente" }[lookup];
}
export function canConfirmCampaignSend(enabled: boolean, status?: string): boolean {
  return enabled && status === "APPROVED";
}
