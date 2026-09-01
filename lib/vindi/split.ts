export const VINDI_PROCESSING_FEE_BPS = 549;
export const EXPERT_PARTICIPATION_BPS_MIN = 0;
export const EXPERT_PARTICIPATION_BPS_MAX = 10_000;

export type VindiSplitInput = {
  priceCentavos: number;
  expertParticipationBps: number;
};

export type VindiSplit = {
  processingFeeBasisPoints: typeof VINDI_PROCESSING_FEE_BPS;
  distributionNetCentavos: number;
  expertAmountCentavos: number;
  platformTheoreticalAmountCentavos: number;
};

/** Half-up in integer cents. The closed example (R$100 / 80% → R$75,61)
 * is 7560.8 centavos; floor would miss the accepted amount. */
function allocateBasisPoints(amountCentavos: number, basisPoints: number): number {
  return Math.round((amountCentavos * basisPoints) / 10_000);
}

export function calculateVindiSplit(input: VindiSplitInput): VindiSplit {
  const { priceCentavos, expertParticipationBps } = input;
  if (!Number.isInteger(priceCentavos) || priceCentavos < 0) {
    throw new Error("price must be a non-negative integer in centavos");
  }
  if (
    !Number.isInteger(expertParticipationBps) ||
    expertParticipationBps < EXPERT_PARTICIPATION_BPS_MIN ||
    expertParticipationBps > EXPERT_PARTICIPATION_BPS_MAX
  ) {
    throw new Error("expert participation must be between 0 and 10000 basis points");
  }

  const distributionNetCentavos = allocateBasisPoints(
    priceCentavos,
    10_000 - VINDI_PROCESSING_FEE_BPS,
  );
  const expertAmountCentavos = allocateBasisPoints(
    distributionNetCentavos,
    expertParticipationBps,
  );

  return {
    processingFeeBasisPoints: VINDI_PROCESSING_FEE_BPS,
    distributionNetCentavos,
    expertAmountCentavos,
    platformTheoreticalAmountCentavos:
      distributionNetCentavos - expertAmountCentavos,
  };
}
