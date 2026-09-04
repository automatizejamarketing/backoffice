export type CoproducerSelectionInput = {
  hasCoproduction: boolean;
  coproducerType?: "automatize" | "expert" | null;
};

export const EXPERT_COPRODUCER_BLOCKED_MESSAGE =
  "Coprodutor Expert não é permitido. Use Coprodução do Automatize ou nenhum coprodutor.";

export function validateCoproducerSelection(
  selection: CoproducerSelectionInput,
):
  | { ok: true }
  | { ok: false; message: string } {
  if (
    selection.hasCoproduction &&
    selection.coproducerType === "expert"
  ) {
    return { ok: false, message: EXPERT_COPRODUCER_BLOCKED_MESSAGE };
  }
  return { ok: true };
}
