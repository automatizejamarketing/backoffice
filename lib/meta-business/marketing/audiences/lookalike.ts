import type { CustomAudienceView } from "./types";
import { compromisesAudienceImport } from "./integrity";

export const LOOKALIKE_DEFAULT_COUNTRY = "BR";
export const LOOKALIKE_DEFAULT_PERCENTAGE = 1;
export const LOOKALIKE_PERCENTAGE_MIN = 1;
export const LOOKALIKE_PERCENTAGE_MAX = 20;

export type LookalikeFormation = {
  country: string;
  percentage: number;
  ratio: number;
};

export type LookalikeSourceAssessment =
  | { ok: true }
  | {
      ok: false;
      code:
        | "IMPORT_COMPROMISED"
        | "SOURCE_CAPABILITY_UNAVAILABLE"
        | "SOURCE_TYPE_UNSUPPORTED";
      message: string;
    };

/** Ratios arrive as IEEE-754 decimals, so valid values such as 0.07 and 0.14
 * cannot be checked with `Number.isInteger(ratio * 100)` directly. */
export function isWholeLookalikeRatio(ratio: number): boolean {
  const percentage = ratio * 100;
  return Number.isFinite(ratio) && Math.abs(percentage - Math.round(percentage)) <= Number.EPSILON * Math.max(1, Math.abs(percentage)) * 4;
}

/**
 * The initial flow is deliberately one country and one whole percentage.  Meta
 * v25 accepts ratios, but accepting a decimal here and rounding it would create
 * a different audience than the one the person reviewed.
 */
export function buildLookalikeFormation(input: {
  country: string;
  percentage: number;
}): { ok: true; formation: LookalikeFormation } | { ok: false; message: string } {
  const country = input.country.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) {
    return { ok: false, message: "Escolha um país no código ISO de duas letras." };
  }
  if (
    !Number.isInteger(input.percentage) ||
    input.percentage < LOOKALIKE_PERCENTAGE_MIN ||
    input.percentage > LOOKALIKE_PERCENTAGE_MAX
  ) {
    return {
      ok: false,
      message: `Escolha um tamanho inteiro entre ${LOOKALIKE_PERCENTAGE_MIN}% e ${LOOKALIKE_PERCENTAGE_MAX}%.`,
    };
  }
  return {
    ok: true,
    formation: { country, percentage: input.percentage, ratio: input.percentage / 100 },
  };
}

/** Only a known partial/uncertain local import blocks a customer-list seed. */
export function assessLookalikeSource(
  audience: Pick<CustomAudienceView, "id" | "subtype" | "customerFileSource"> & {
    capabilities?: Pick<CustomAudienceView["capabilities"], "lookalikeSource">;
    importState?: "partial" | "unknown" | string;
    importResult?: {
      known: boolean;
      state?: string;
      pendingUnresolved?: boolean;
      confirmedBatches?: number;
      confirmedRecords?: number;
      rejectedRecords?: number;
    };
  },
): LookalikeSourceAssessment {
  const importState = audience.importState ??
    (audience.importResult?.known ? audience.importResult.state : undefined);
  if (compromisesAudienceImport(importState, audience.importResult)) {
    return {
      ok: false,
      code: "IMPORT_COMPROMISED",
      message: "Esta lista tem uma importação parcial ou incerta. Corrija-a antes de usá-la como origem.",
    };
  }
  if (audience.capabilities?.lookalikeSource === "unavailable") {
    return {
      ok: false,
      code: "SOURCE_CAPABILITY_UNAVAILABLE",
      message: "A Meta não autorizou esta origem para criação de público semelhante nesta conexão.",
    };
  }
  if (audience.subtype === "LOOKALIKE") {
    return {
      ok: false,
      code: "SOURCE_TYPE_UNSUPPORTED",
      message: "Um lookalike existente não pode ser usado como origem nesta criação.",
    };
  }
  if (
    audience.customerFileSource ||
    audience.subtype === "ENGAGEMENT" ||
    audience.subtype === "WEBSITE"
  ) {
    return { ok: true };
  }
  return {
    ok: false,
    code: "SOURCE_TYPE_UNSUPPORTED",
    message: "Esta origem não é uma lista de clientes, público do Instagram ou público do site elegível.",
  };
}
