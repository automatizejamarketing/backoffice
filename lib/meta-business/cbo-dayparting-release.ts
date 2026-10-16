/**
 * Liberação por conta da etapa 2: CBO vitalícia nasce com a programação na campanha e a
 * troca de horário vira edição da grade (lib/meta-business/schedule-shape.ts).
 *
 * `META_CBO_DAYPARTING_ACCOUNT_IDS`: CSV de contas (`act_123` ou `123`), `*` libera todas;
 * vazia ou ausente = desligada. Só servidor: lê `process.env` a cada chamada — nunca importe
 * a partir de componente cliente. Idêntico byte a byte nos dois repositórios.
 */
export const CBO_DAYPARTING_RELEASE_ENV = "META_CBO_DAYPARTING_ACCOUNT_IDS";

function bareAccountId(id: string): string {
  const trimmed = id.trim();
  return trimmed.startsWith("act_") ? trimmed.slice(4) : trimmed;
}

export function isCboDaypartingReleased(
  adAccountId: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const raw = env[CBO_DAYPARTING_RELEASE_ENV]?.trim();
  if (!raw) return false;
  const entries = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.includes("*")) return true;
  if (!adAccountId?.trim()) return false;
  const account = bareAccountId(adAccountId);
  return entries.some((entry) => bareAccountId(entry) === account);
}
