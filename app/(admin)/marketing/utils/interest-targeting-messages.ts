export const interestTargetingMessages: Record<string, string> = {
  title: "Público de interesse",
  description:
    "Refine quem verá seus anúncios com interesses detalhados, como no Gerenciador de Anúncios da Meta.",
  summary: "{included} incluídos, {excluded} excluídos",
  includeLabel: "Incluir pessoas que correspondam a",
  excludeLabel: "Excluir pessoas que correspondam a",
  excludeHint: "Pessoas com estes interesses não verão seus anúncios.",
  groupPrimary: "Grupo principal",
  groupNarrowing: "Restrição {index}",
  groupHint: "Pelo menos um destes interesses",
  removeGroup: "Remover grupo",
  addInterest: "Adicionar interesse",
  addExclusion: "Adicionar exclusão",
  searchPlaceholder: "Buscar interesses...",
  searchHint: "Digite para buscar interesses disponíveis",
  searchEmptyState: "Digite para buscar um interesse",
  searchError: "Falha ao buscar interesses",
  searching: "Buscando...",
  noResults: "Nenhum interesse encontrado",
  removeInterest: "Remover interesse",
  narrowAudience: "Restringir público",
  suggestions: "Sugestões",
  loadingSuggestions: "Carregando sugestões...",
  noSuggestions: "Nenhuma sugestão disponível",
  browseCategories: "Explorar categorias",
  loadingBrowse: "Carregando categorias...",
  noBrowseResults: "Nenhuma categoria encontrada",
  audienceSize: "Alcance: {size}",
  advancedOptions: "Opções avançadas",
  advancedSummary: "{included} interesses incluídos, {excluded} excluídos",
};

export function useInterestTargetingT() {
  return function t(
    key: string,
    params?: Record<string, string | number>,
  ): string {
    const template = interestTargetingMessages[key] ?? key;
    if (!params) return template;

    return template.replace(/\{(\w+)\}/g, (_, name) => {
      const value = params[name];
      return value !== undefined ? String(value) : "";
    });
  };
}
