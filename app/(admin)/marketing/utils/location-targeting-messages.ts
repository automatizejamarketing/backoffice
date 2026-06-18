export const locationTargetingMessages: Record<string, string> = {
  title: "Geo Localização",
  description:
    "Busque um endereço, estabelecimento ou ponto no mapa. Cada local usa um raio em torno de coordenadas exatas para permitir áreas menores.",
  selectedLabel: "selecionado(s)",
  searchPlaceholder: "Buscar endereço ou estabelecimento...",
  searchHint: "Busque por rua, nome do negócio, bairro ou ponto de referência",
  searchDisabledHint: "Selecione uma conta de anúncios primeiro",
  selectAccountFirst: "Selecione uma conta para buscar localizações",
  searching: "Buscando...",
  searchEmptyState: "Digite um endereço, estabelecimento ou local",
  searchError: "Falha ao buscar localizações",
  noResults: "Nenhum endereço ou estabelecimento encontrado",
  metaLocationsGroup: "Localizações Meta",
  googlePlacesGroup: "Endereços e estabelecimentos",
  placeDetailsError:
    "Não foi possível obter coordenadas para esse endereço. Tente outro resultado.",
  removeLocation: "Remover localização",
  atLeastOneLocation: "Selecione ao menos uma localização para segmentação",
  radiusLabel: "Raio",
  cityRadiusHint:
    "Defina a distância ao redor do ponto onde o anúncio será exibido com base em até onde você atende",
  customLocationRadiusHint: "Distância ao redor do ponto selecionado",
  placeRadiusHint: "Distância ao redor deste local",
  decreaseRadius: "Diminuir raio",
  increaseRadius: "Aumentar raio",
  km: "km",
  country: "País",
  region: "Estado / Região",
  countryGroup: "Grupo de Países",
  countryGroupHint: "Grupo de países",
  city: "Cidade",
  subcity: "Sub-cidade",
  neighborhood: "Bairro",
  zip: "CEP",
  geoMarket: "Mercado Geográfico",
  electoralDistrict: "Distrito Eleitoral",
  place: "Local",
  address: "Endereço",
  business: "Empresa",
  customLocationHint: "Localização personalizada",
  placeHint: "Ponto de interesse",
  mapPreviewTitle: "Visualização do Mapa",
  mapPreviewHint:
    "Este mapa mostra a área aproximada que será segmentada pelos seus anúncios.",
  mapZipPinDisclaimer:
    "Coordenadas aproximadas obtidas via OpenStreetMap (não do Meta).",
  mapGeocodingZip: "Buscando localização do CEP...",
  mapUnavailableHint:
    "A visualização do mapa não está disponível para este tipo de localização.",
  mapGeocodeError: "Não foi possível localizar no mapa: {message}",
  mapDragPinHint: "Arraste o pin para ajustar a localização exata",
  dragPinHint:
    "Clique e arraste o pino no mapa para o mais próximo do seu estabelecimento",
  expandMap: "Expandir mapa",
  collapseMap: "Recolher mapa",
  selectedSummary: "{first} e mais {count}",
};

/**
 * Lightweight translator that mimics the next-intl `t()` API for the
 * `marketing.newCampaign.locationTargeting` namespace.
 *
 * Supports simple interpolation: `{key}` and `{key, number}` placeholders.
 */
export function useLocationTargetingT() {
  return function t(
    key: string,
    params?: Record<string, string | number>,
  ): string {
    const template = locationTargetingMessages[key] ?? key;
    if (!params) return template;

    return template.replace(/\{(\w+)(?:,\s*\w+)?\}/g, (_, name) => {
      const value = params[name];
      return value !== undefined ? String(value) : "";
    });
  };
}
