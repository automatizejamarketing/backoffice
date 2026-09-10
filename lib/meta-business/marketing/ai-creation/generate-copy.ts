/**
 * Escrever o anúncio a partir da OFERTA que o usuário descreve (ADR 0022, decisão 5).
 *
 * Esta é a ÚNICA IA do fluxo. O caminho crítico — escanear, eleger o molde, copiar a configuração,
 * criar a campanha — é determinístico; se isto falhar, o usuário digita o texto na mão e o fluxo
 * segue. Por isso a montagem do prompt (pura) e a chamada ao modelo (impura) ficam separadas: a
 * primeira é testável sem rede.
 */
import { z } from "zod";

/** O que o negócio é — o suficiente para o texto não soar genérico. Nunca inventado pelo modelo. */
export type CopyBusinessContext = {
  /** companies.niche resolvido (food_service, retail, …) ou o texto livre do onboarding. */
  niche?: string | null;
  companyName?: string | null;
  city?: string | null;
};

export type GenerateCopyInput = {
  /** A oferta, nas palavras do usuário: "rodízio de sushi por R$ 79 de terça a quinta". */
  offer: string;
  business: CopyBusinessContext;
  /**
   * VENDAS pede um CTA de compra; LEADS/tráfego, um de contato; WHATSAPP pede os dois textos
   * do anúncio MAIS a primeira mensagem da conversa. Molda o texto, não o inventa.
   */
  objective: "sales" | "leads" | "whatsapp";
};

export type GeneratedCopy = {
  /** Título curto do anúncio (headline). */
  headline: string;
  /** Legenda / texto principal. */
  message: string;
  /**
   * Só no objetivo `whatsapp`: a mensagem que já chega DIGITADA no chat do cliente quando ele
   * clica no anúncio.
   *
   * Sem ela a Meta manda o padrão dela — "Hello! Can I get more info on this?" —, que além de
   * estar em inglês não diz de qual anúncio a pessoa veio. Gerada no MESMO chamado do título e
   * da legenda: custo zero de IA a mais, e sai coerente com a oferta.
   */
  whatsappAutofillMessage?: string;
};

/** O modelo devolve exatamente isto — validado na borda, então nada de parsing frágil. */
export const generatedCopySchema = z.object({
  headline: z
    .string()
    .describe("Título curto e direto do anúncio, no máximo ~40 caracteres."),
  message: z
    .string()
    .describe("Legenda do anúncio: 2 a 4 frases, com uma chamada para ação no fim."),
});

/** O schema do objetivo `whatsapp`: o anúncio MAIS a primeira mensagem da conversa. */
export const generatedWhatsappCopySchema = generatedCopySchema.extend({
  whatsappAutofillMessage: z
    .string()
    .describe(
      "A mensagem que já vem digitada no WhatsApp do cliente, na PRIMEIRA pessoa dele. " +
        "Curta (até ~90 caracteres), citando o que ele viu no anúncio. " +
        'Ex.: "Oi! Quero saber do rodízio de R$ 79."',
    ),
});

/** O schema que o objetivo pede — o do WhatsApp acrescenta a mensagem inicial. */
export function copySchemaFor(objective: GenerateCopyInput["objective"]) {
  return objective === "whatsapp"
    ? generatedWhatsappCopySchema
    : generatedCopySchema;
}

const MAX_OFFER_CHARS = 600;

/** Limpa a oferta antes de mandar ao modelo (e antes de qualquer teste sobre o prompt). */
export function sanitizeOffer(offer: string): string {
  return offer.replace(/\s+/g, " ").trim().slice(0, MAX_OFFER_CHARS);
}

/**
 * Monta o prompt. PURO — sem rede, sem modelo — para o teste afirmar que a oferta e o contexto do
 * negócio chegam ao prompt, que o CTA muda por objetivo, e que o modelo é instruído a NÃO inventar
 * fatos (a regra que impede o anúncio de prometer o que o negócio não ofereceu).
 */
export function buildCopyPrompt(input: GenerateCopyInput): string {
  const offer = sanitizeOffer(input.offer);
  const { niche, companyName, city } = input.business;

  const ctaRule =
    input.objective === "sales"
      ? "O objetivo é VENDER: termine com uma chamada curta e objetiva para comprar/pedir agora."
      : input.objective === "whatsapp"
        ? "O objetivo é vender PELO WHATSAPP: termine com uma chamada curta para chamar no WhatsApp e fechar o pedido por lá."
        : "O objetivo é gerar CONTATOS: termine com uma chamada curta para falar com o negócio (mensagem/WhatsApp).";

  // Só o WhatsApp pede a terceira saída. A regra é escrita aqui, junto das outras, para o teste
  // do prompt poder afirmar que ela chega ao modelo — e que ela NÃO aparece nos outros objetivos.
  const whatsappRule =
    input.objective === "whatsapp"
      ? [
          "- Escreva TAMBÉM a mensagem que já virá digitada no WhatsApp do cliente, escrita como se fosse ELE falando.",
          "- Ela tem até ~90 caracteres, cita o que ele viu no anúncio e termina numa pergunta ou num pedido claro.",
          '- Ex.: "Oi! Vi o anúncio do rodízio de R$ 79. Ainda tem para hoje?"',
        ]
      : [];

  const businessLines = [
    companyName ? `Nome do negócio: ${companyName}.` : null,
    niche ? `Segmento: ${niche}.` : null,
    city ? `Cidade: ${city}.` : null,
  ].filter(Boolean);

  return [
    "Atue como o melhor copywriter de anúncios do Brasil e escreva UM anúncio em PT-BR a partir da oferta abaixo.",
    "",
    businessLines.length ? businessLines.join("\n") : "Sem dados adicionais do negócio.",
    "",
    `Oferta (nas palavras do dono): ${offer}`,
    "",
    "REGRAS:",
    "- NÃO invente fatos: preço, prazo, ingredientes, brindes, garantias ou prêmios que não estejam na oferta acima.",
    "- Linguagem natural, sem jargão publicitário e sem clichê vazio. Zero a dois emojis, só se ajudarem.",
    "- Não use caixa alta contínua. Sem hashtags.",
    `- ${ctaRule}`,
    "- O título tem no máximo ~40 caracteres. A legenda tem de 2 a 4 frases.",
    ...whatsappRule,
    "- Devolva apenas o título e a legenda, sem rótulos como 'Título:' ou 'Legenda:'.",
  ].join("\n");
}
