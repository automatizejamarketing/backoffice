/** Rotas e período da área de Tráfego. Puro (servidor e navegador). */

export const PERIOD_OPTIONS = [7, 14, 30] as const;

export function parseDays(value: string | string[] | null | undefined): number {
  const raw = Number(Array.isArray(value) ? value[0] : value);
  return (PERIOD_OPTIONS as readonly number[]).includes(raw) ? raw : 7;
}

/** `jornada` é o CRM (a chave ficou; a URL é /trafego/crm). A Fila saiu do menu. */
export type TrafegoView = "mesa" | "jornada";

export const TRAFEGO_VIEWS: Array<{ key: TrafegoView; label: string; href: string; hint: string }> = [
  { key: "mesa", label: "Mesa", href: "/trafego/mesa", hint: "A carteira inteira em números, com ações em lote" },
  { key: "jornada", label: "CRM", href: "/trafego/crm", hint: "Uma coluna por responsável; arraste o card para passar" },
];

export const DEFAULT_VIEW: TrafegoView = "jornada";
export const VIEW_COOKIE = "trafego_view";

export function isTrafegoView(value: string | null | undefined): value is TrafegoView {
  return value === "mesa" || value === "jornada";
}

/** Segmentos de URL antigos → visão atual (links salvos e o cookie de visão padrão). */
const LEGACY_SEGMENT: Record<string, TrafegoView> = { crm: "jornada", jornada: "jornada", fila: "mesa", mesa: "mesa" };

export function viewFromSegment(segment: string | null | undefined): TrafegoView | null {
  return (segment && LEGACY_SEGMENT[segment]) || null;
}

/** "/trafego/mesa" → "mesa", "/trafego/crm" → "jornada"; qualquer outra rota → null. */
export function viewFromPathname(pathname: string | null | undefined): TrafegoView | null {
  const segment = pathname?.match(/^\/trafego\/([^/?#]+)\/?$/)?.[1];
  return viewFromSegment(segment);
}

export function clientHref(userId: string, days = 7) {
  return `/trafego/clientes/${userId}${days !== 7 ? `?dias=${days}` : ""}`;
}
