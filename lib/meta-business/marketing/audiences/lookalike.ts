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
      code: "IMPORT_COMPROMISED" | "SOURCE_TYPE_UNSUPPORTED";
      message: string;
    };

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
    return { ok: false, message: "Escolha um pa\u00eds no c\u00f3digo ISO de duas letras." };
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
      message: "Esta lista tem uma importa\u00e7\u00e3o parcial ou incerta. Corrija-a antes de us\u00e1-la como origem.",
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
    message: "Esta origem n\u00e3o \u00e9 uma lista de clientes, p\u00fablico do Instagram ou p\u00fablico do site eleg\u00edvel.",
  };
}
