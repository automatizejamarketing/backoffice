/** Audience-specific Meta subcode -> actionable-suggestion overrides. */
export function audienceSubcodeSuggestion(
  code?: number,
  subcode?: number,
): string | undefined {
  const map: Record<string, string> = {
    "1870034": "A conta ainda não aceitou os Termos de Serviço de Públicos Personalizados. Aceite no Ads Manager antes de criar o público.",
    "471": "Público bloqueado por integridade. Ajuste os campos restritos antes de usar.",
    "1713231": "Corrija os campos restritos e a regra na mesma edição.",
    "1713228": "Públicos sinalizados não podem ser editados; corrija ou recrie o público.",
    "1713230": "Resolva as restrições de integridade antes de alterar os membros.",
    "2650": "A Meta não conseguiu atualizar o público. Confira os campos e tente de novo.",
    "2654": "A Meta não conseguiu criar o público. Revise a regra e os parâmetros.",
    "2656": "Exclua primeiro os lookalikes gerados a partir desta semente.",
  };
  if (subcode != null && map[`${code}_${subcode}`]) return map[`${code}_${subcode}`];
  if (subcode != null && map[String(subcode)]) return map[String(subcode)];
  if (code != null && map[String(code)]) return map[String(code)];
  return undefined;
}
