/** Rotas e período da área de Tráfego. Puro (servidor e navegador). */

export const PERIOD_OPTIONS = [7, 14, 30] as const;

export function parseDays(value: string | string[] | null | undefined): number {
  const raw = Number(Array.isArray(value) ? value[0] : value);
  return (PERIOD_OPTIONS as readonly number[]).includes(raw) ? raw : 7;
}

export type TrafegoView = "fila" | "mesa" | "jornada";

export const TRAFEGO_VIEWS: Array<{ key: TrafegoView; label: string; href: string; hint: string }> = [
  { key: "fila", label: "Fila", href: "/trafego/fila", hint: "Um cliente por vez, do mais urgente ao menos" },
  { key: "mesa", label: "Mesa", href: "/trafego/mesa", hint: "A carteira inteira em números, com ações em lote" },
  { key: "jornada", label: "Jornada", href: "/trafego/jornada", hint: "Cada cliente na etapa em que está" },
];

export const DEFAULT_VIEW: TrafegoView = "jornada";
export const VIEW_COOKIE = "trafego_view";

export function isTrafegoView(value: string | null | undefined): value is TrafegoView {
  return value === "fila" || value === "mesa" || value === "jornada";
}

export function clientHref(userId: string, days = 7) {
  return `/trafego/clientes/${userId}${days !== 7 ? `?dias=${days}` : ""}`;
}
