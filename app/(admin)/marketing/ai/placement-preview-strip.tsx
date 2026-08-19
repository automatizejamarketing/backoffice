"use client";

/**
 * Tira de previews por posicionamento na revisão da criação com IA do BACKOFFICE.
 *
 * Gêmea de `automatize-frontend/app/app/(main)/marketing/new/ai/placement-preview-strip.tsx`.
 * NÃO é espelhada automaticamente (o `sync:meta` cobre `lib/meta-business/`, não a
 * UI): as duas diferem na rota — aqui o admin opera em nome de um cliente e a
 * chamada carrega `userId`. Ao mudar uma, mude a outra.
 *
 * O que ela resolve: hoje o usuário sobe UMA arte e aprova a campanha sem nunca
 * ver como ela fica em Stories ou Reels. A arte quadrada vira um quadrado no meio
 * de uma tela vertical, e ele só descobre isso depois de publicar.
 *
 * O que ela NÃO promete: o preview do Meta ignora `adapt_to_placement` — dois
 * anúncios idênticos exceto pela feature renderizam igual (comprovado em anúncio
 * real). Então o texto da tela fala em "como seu anúncio aparece em cada lugar",
 * nunca em "veja o reenquadramento". Prometer o segundo seria mentira, e o
 * usuário compararia com a veiculação real e nos pegaria.
 *
 * Carregamento em DUAS ondas, não uma. O endpoint do Meta é um `ad_format` por
 * chamada, então pedir os seis de uma vez faz o usuário esperar pelo mais lento
 * antes de ver qualquer coisa. Aqui a primeira requisição pede só o posicionamento
 * visível e a segunda pede os outros cinco: a tela preenche em ~1 chamada de
 * latência e o resto chega por baixo. São 2 requisições por abertura, o que cabe
 * no rate limit de 15/min por usuário (seis requisições separadas não caberiam).
 *
 * E o disparo é DEBOUNCED. Título, legenda e link são estado por tecla na tela de
 * revisão; com o painel aberto de saída, ligar o efeito direto neles faria duas
 * requisições por caractere digitado e estouraria o rate limit em segundos. A
 * busca só parte quando a descrição do criativo fica parada por
 * {@link RELOAD_DEBOUNCE_MS} — o mesmo espírito do `onCommit` da revisão, que
 * re-planeja no blur e nunca por tecla.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ALL_PLACEMENTS, type PlacementKey } from "@/lib/meta-business/placements";
import type {
  PlacementPreviewsRequest,
  PlacementPreviewsResponse,
  PlacementPreviewsErrorResponse,
} from "@/app/api/meta-marketing/[accountId]/campaigns/ai/previews/route";

type Preview = PlacementPreviewsResponse["previews"][number];

/** Silêncio necessário antes de refazer as prévias após uma edição. */
const RELOAD_DEBOUNCE_MS = 700;

const PLACEMENT_LABEL: Record<PlacementKey, string> = {
  instagram_feed: "Instagram · Feed",
  instagram_stories: "Instagram · Stories",
  instagram_reels: "Instagram · Reels",
  facebook_feed: "Facebook · Feed",
  facebook_stories: "Facebook · Stories",
  facebook_reels: "Facebook · Reels",
};

/** Ordem de exibição: os verticais primeiro, que são os que mais surpreendem. */
const DISPLAY_ORDER: PlacementKey[] = [
  "instagram_stories",
  "instagram_reels",
  "instagram_feed",
  "facebook_stories",
  "facebook_reels",
  "facebook_feed",
];

/**
 * Largura do quadro. Fixa e estreita de propósito: o painel vive numa coluna de
 * ~360px ao lado do card de conteúdo, e um quadro que não cabe nela faria o card
 * inteiro crescer horizontalmente.
 */
const FRAME_WIDTH = 300;
const FRAME_HEIGHT: Record<Preview["aspectRatio"], number> = {
  "9:16": 533,
  "4:5": 375,
  "1:1": 300,
};

export type PlacementPreviewStripProps = {
  accountId: string;
  /** Cliente em cujo nome o admin opera — a rota resolve o token por ele. */
  userId: string;
  pageId: string;
  instagramUserId?: string;
  imageHash?: string;
  /** URL da imagem quando o hash ainda não existe — a rota resolve no servidor. */
  imageUrl?: string;
  videoId?: string;
  thumbnailUrl?: string;
  instagramMediaId?: string;
  headline?: string;
  message?: string;
  link?: string;
  ctaType?: string;
  /** Posicionamentos escolhidos na revisão. Ausente = os 6. */
  placements?: PlacementKey[];
  /** Estado do opt-in de expansão generativa, para o preview refletir o payload. */
  generativeExpansion?: boolean;
  className?: string;
};

export function PlacementPreviewStrip({
  accountId,
  userId,
  pageId,
  instagramUserId,
  imageHash,
  imageUrl,
  videoId,
  thumbnailUrl,
  instagramMediaId,
  headline,
  message,
  link,
  ctaType,
  placements,
  generativeExpansion = false,
  className,
}: PlacementPreviewStripProps) {
  /**
   * Aberto de saída. O ponto da seção é o usuário PERCEBER que a arte vai para
   * Stories e Reels; atrás de um clique, quem não sabe que o problema existe
   * nunca abre. São 2 requisições, não 6 — o custo cabe.
   */
  const [open, setOpen] = useState(true);
  const [previews, setPreviews] = useState<Partial<Record<PlacementKey, Preview>>>({});
  const [pending, setPending] = useState<PlacementKey[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<PlacementKey>("instagram_stories");
  /** Descarta respostas de uma busca anterior quando o criativo muda no meio. */
  const requestRef = useRef(0);
  /** O tab ativo no momento do disparo — a primeira onda pede só ele. */
  const activeRef = useRef(active);
  activeRef.current = active;

  const visible = useMemo(() => {
    const allowed = new Set<PlacementKey>(placements?.length ? placements : ALL_PLACEMENTS);
    return DISPLAY_ORDER.filter((p) => allowed.has(p));
  }, [placements]);

  const hasMedia = Boolean(imageHash || imageUrl || videoId || instagramMediaId);

  const load = useCallback(async () => {
    if (!hasMedia || !accountId || !pageId || visible.length === 0) return;
    const ticket = ++requestRef.current;
    const first = visible.includes(activeRef.current) ? activeRef.current : visible[0];
    const rest = visible.filter((p) => p !== first);

    setError(null);
    setPreviews({});
    setPending(visible);

    const base: Omit<PlacementPreviewsRequest, "placements"> = {
      pageId,
      ...(instagramUserId ? { instagramUserId } : {}),
      ...(imageHash ? { imageHash } : {}),
      ...(imageUrl ? { imageUrl } : {}),
      ...(videoId ? { videoId } : {}),
      ...(thumbnailUrl ? { thumbnailUrl } : {}),
      ...(instagramMediaId ? { instagramMediaId } : {}),
      ...(headline ? { headline } : {}),
      ...(message ? { message } : {}),
      ...(link ? { link } : {}),
      ...(ctaType ? { ctaType } : {}),
      generativeExpansion,
    };

    const wave = async (batch: PlacementKey[]) => {
      if (batch.length === 0) return;
      try {
        const res = await fetch(
          `/api/meta-marketing/${accountId}/campaigns/ai/previews?userId=${userId}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...base, placements: batch }),
          },
        );
        const data = (await res.json()) as
          | PlacementPreviewsResponse
          | PlacementPreviewsErrorResponse;
        if (ticket !== requestRef.current) return; // resposta obsoleta
        if (!data.success) {
          // Um erro de autorização/rate limit vale para as duas ondas: mostra uma
          // vez em vez de repetir a mesma mensagem por posicionamento.
          setError(data.message);
          return;
        }
        setPreviews((current) => {
          const next = { ...current };
          for (const preview of data.previews) next[preview.placement] = preview;
          return next;
        });
      } finally {
        if (ticket === requestRef.current) {
          setPending((current) => current.filter((p) => !batch.includes(p)));
        }
      }
    };

    // A primeira onda é aguardada para que a segunda não dispute latência com ela.
    await wave([first]);
    await wave(rest);
  }, [
    accountId,
    userId,
    pageId,
    instagramUserId,
    imageHash,
    imageUrl,
    videoId,
    thumbnailUrl,
    instagramMediaId,
    headline,
    message,
    link,
    ctaType,
    visible,
    generativeExpansion,
    hasMedia,
  ]);

  // `load` muda de identidade a cada tecla (headline/message/link são deps dela).
  // Guardá-la num ref permite ao efeito abaixo observar só a assinatura debounced,
  // sem disparar a cada re-render.
  const loadRef = useRef(load);
  loadRef.current = load;

  /** Tudo que muda o criativo enviado ao Meta — e só isso. */
  const signature = useMemo(
    () =>
      JSON.stringify([
        accountId,
        userId,
        pageId,
        instagramUserId,
        imageHash,
        imageUrl,
        videoId,
        thumbnailUrl,
        instagramMediaId,
        headline,
        message,
        link,
        ctaType,
        generativeExpansion,
        visible,
      ]),
    [
      accountId,
      userId,
      pageId,
      instagramUserId,
      imageHash,
      imageUrl,
      videoId,
      thumbnailUrl,
      instagramMediaId,
      headline,
      message,
      link,
      ctaType,
      generativeExpansion,
      visible,
    ],
  );

  const [settled, setSettled] = useState(signature);
  useEffect(() => {
    if (signature === settled) return;
    const timer = setTimeout(() => setSettled(signature), RELOAD_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [signature, settled]);

  useEffect(() => {
    if (open) void loadRef.current();
  }, [open, settled]);

  if (!hasMedia) return null;

  const activePreview = previews[active] ?? null;
  const activePending = pending.includes(active);
  const loadedCount = visible.filter((p) => previews[p]?.iframeUrl).length;

  return (
    <section className={cn("rounded-xl border bg-card", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="min-w-0">
          <span className="block text-sm font-medium">
            Como seu anúncio aparece em cada lugar
          </span>
          <span className="block text-xs text-muted-foreground">
            Feed, Stories e Reels — no Instagram e no Facebook
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          {open && pending.length > 0 && (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          )}
          {open ? "Ocultar" : "Ver"}
        </span>
      </button>

      {open && (
        <div className="border-t px-4 py-4">
          <div
            role="tablist"
            aria-label="Posicionamentos"
            className="mb-4 flex flex-wrap gap-2"
          >
            {visible.map((placement) => {
              const preview = previews[placement];
              const isPending = pending.includes(placement);
              const failed = !isPending && preview != null && !preview.iframeUrl;
              return (
                <button
                  key={placement}
                  type="button"
                  role="tab"
                  aria-selected={active === placement}
                  aria-busy={isPending}
                  onClick={() => setActive(placement)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors",
                    active === placement
                      ? "border-foreground bg-foreground text-background"
                      : "hover:bg-muted",
                    failed && "opacity-50",
                  )}
                >
                  {isPending && (
                    <Loader2 className="size-3 animate-spin" aria-hidden />
                  )}
                  {PLACEMENT_LABEL[placement]}
                </button>
              );
            })}
          </div>

          <div className="flex justify-center">
            <PreviewFrame
              pending={activePending}
              error={error}
              preview={activePreview}
              thumbnailUrl={thumbnailUrl}
              onRetry={() => void load()}
            />
          </div>

          <p className="mt-3 text-center text-xs text-muted-foreground">
            {pending.length > 0
              ? `Gerando prévias… ${loadedCount} de ${visible.length}`
              : "Prévia do Meta. O enquadramento final pode variar conforme o dispositivo de quem vê o anúncio."}
          </p>
        </div>
      )}
    </section>
  );
}

function PreviewFrame({
  pending,
  error,
  preview,
  thumbnailUrl,
  onRetry,
}: {
  pending: boolean;
  error: string | null;
  preview: Preview | null;
  thumbnailUrl?: string;
  onRetry: () => void;
}) {
  // Altura vem da proporção do posicionamento; enquanto não sabemos qual é,
  // 9:16 (o mais alto) segura o espaço para a troca de aba não fazer a página pular.
  const height = FRAME_HEIGHT[preview?.aspectRatio ?? "9:16"];
  const box = { width: FRAME_WIDTH, height };

  if (pending) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex animate-pulse flex-col items-center justify-center gap-3 rounded-xl border bg-muted/60"
        style={box}
      >
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />
        <span className="text-xs text-muted-foreground">Gerando prévia…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-6 text-center"
        style={box}
      >
        <p className="text-sm text-muted-foreground">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted"
        >
          Tentar de novo
        </button>
      </div>
    );
  }

  if (!preview?.iframeUrl) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-6 text-center"
        style={box}
      >
        <p className="text-sm text-muted-foreground">
          {preview?.error ??
            "O Meta não retornou prévia para este posicionamento."}
        </p>
        {thumbnailUrl && (
          <Image
            src={thumbnailUrl}
            alt=""
            width={120}
            height={120}
            className="rounded-md object-cover opacity-70"
            unoptimized
          />
        )}
      </div>
    );
  }

  return (
    <iframe
      key={preview.placement}
      src={preview.iframeUrl}
      title={`Prévia — ${PLACEMENT_LABEL[preview.placement]}`}
      width={FRAME_WIDTH}
      height={height}
      scrolling="no"
      className="rounded-xl border bg-white"
      sandbox="allow-scripts allow-same-origin allow-popups"
    />
  );
}
