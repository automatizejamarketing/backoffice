import { describe, expect, test } from "bun:test";

import {
  DEFAULT_BRAZIL_LOCATION,
  DEFAULT_CITY_RADIUS_KM,
  MAX_RADIUS_KM,
  MIN_RADIUS_KM,
  type SelectedGeoLocation,
} from "@/lib/meta-business/geo-targeting-types";

import {
  addSelectedLocation,
  expandedIndexAfterRemoval,
  moveLocationPin,
  removeSelectedLocation,
  setLocationRadius,
  stepLocationRadius,
} from "./location-selection";

const BOUNDS = { min: MIN_RADIUS_KM, max: MAX_RADIUS_KM };

const campinas: SelectedGeoLocation = {
  key: "243451",
  name: "Campinas",
  type: "city",
  region: "São Paulo",
  country_name: "Brazil",
};

const paulista: SelectedGeoLocation = {
  key: "google_paulista",
  name: "Av. Paulista, 1000",
  type: "custom_location",
  address_string: "Av. Paulista, 1000 - Bela Vista, São Paulo - SP",
  latitude: -23.5614,
  longitude: -46.6559,
  radius: 5,
  distance_unit: "kilometer",
};

const loja: SelectedGeoLocation = {
  key: "place_loja",
  name: "Loja Centro",
  type: "place",
  latitude: -23.55,
  longitude: -46.63,
  radius: 3,
  distance_unit: "kilometer",
};

describe("regra do Brasil (igual ao app)", () => {
  test("adicionar um local específico tira o Brasil", () => {
    expect(addSelectedLocation([DEFAULT_BRAZIL_LOCATION], campinas)).toEqual([campinas]);
  });

  test("remover o último local devolve só o Brasil", () => {
    expect(removeSelectedLocation([paulista], paulista.key)).toEqual({
      locations: [DEFAULT_BRAZIL_LOCATION],
      removedIndex: 0,
    });
  });

  test("Brasil sozinho continua e não sai ao ser removido", () => {
    expect(addSelectedLocation([], DEFAULT_BRAZIL_LOCATION)).toEqual([DEFAULT_BRAZIL_LOCATION]);
    expect(removeSelectedLocation([DEFAULT_BRAZIL_LOCATION], DEFAULT_BRAZIL_LOCATION.key)).toEqual({
      locations: [DEFAULT_BRAZIL_LOCATION],
      removedIndex: 0,
    });
  });

  test("escolher o Brasil com uma cidade na lista mantém só a cidade", () => {
    expect(addSelectedLocation([campinas], DEFAULT_BRAZIL_LOCATION)).toEqual([campinas]);
  });
});

describe("adicionar e remover", () => {
  test("adicionar anexa no fim", () => {
    expect(addSelectedLocation([campinas], paulista)).toEqual([campinas, paulista]);
  });

  test("remover do meio preserva a ordem", () => {
    expect(removeSelectedLocation([campinas, paulista, loja], paulista.key)).toEqual({
      locations: [campinas, loja],
      removedIndex: 1,
    });
  });

  test("chave inexistente não muda a lista", () => {
    expect(removeSelectedLocation([campinas, paulista], "nao-existe")).toEqual({
      locations: [campinas, paulista],
      removedIndex: -1,
    });
  });
});

describe("expandedIndexAfterRemoval", () => {
  test("nada expandido continua nada expandido", () => {
    expect(expandedIndexAfterRemoval(null, 1)).toBeNull();
  });

  test("o card removido fecha", () => {
    expect(expandedIndexAfterRemoval(1, 1)).toBeNull();
  });

  test("cards depois do removido sobem uma posição", () => {
    expect(expandedIndexAfterRemoval(2, 1)).toBe(1);
  });

  test("cards antes do removido ficam onde estão", () => {
    expect(expandedIndexAfterRemoval(0, 1)).toBe(0);
  });

  test("remoção de chave inexistente não mexe no expandido", () => {
    expect(expandedIndexAfterRemoval(2, -1)).toBe(2);
  });
});

describe("raio", () => {
  test("campo numérico grava o raio em km", () => {
    expect(setLocationRadius([paulista], paulista.key, "12", BOUNDS)).toEqual([
      { ...paulista, radius: 12, distance_unit: "kilometer" },
    ]);
  });

  test("estabelecimento (place) também aceita raio", () => {
    expect(setLocationRadius([loja], loja.key, "7", BOUNDS)[0]?.radius).toBe(7);
  });

  test("acima do máximo fica no máximo", () => {
    expect(setLocationRadius([paulista], paulista.key, "120", BOUNDS)[0]?.radius).toBe(MAX_RADIUS_KM);
  });

  test("abaixo do mínimo configurado sobe para o mínimo", () => {
    expect(setLocationRadius([paulista], paulista.key, "2", { min: 5, max: 50 })[0]?.radius).toBe(5);
  });

  test("vazio, zero, negativo e texto são ignorados", () => {
    for (const rawValue of ["", "0", "-3", "abc"]) {
      expect(setLocationRadius([paulista], paulista.key, rawValue, BOUNDS)).toEqual([paulista]);
    }
  });

  test("cidade e país não recebem raio", () => {
    expect(setLocationRadius([campinas], campinas.key, "10", BOUNDS)).toEqual([campinas]);
    expect(stepLocationRadius([DEFAULT_BRAZIL_LOCATION], "BR", 1, BOUNDS)).toEqual([
      DEFAULT_BRAZIL_LOCATION,
    ]);
  });

  test("± soma e subtrai 1 km", () => {
    expect(stepLocationRadius([paulista], paulista.key, 1, BOUNDS)[0]?.radius).toBe(6);
    expect(stepLocationRadius([paulista], paulista.key, -1, BOUNDS)[0]?.radius).toBe(4);
  });

  test("± respeita os limites", () => {
    const noMaximo = { ...paulista, radius: MAX_RADIUS_KM };
    const noMinimo = { ...paulista, radius: MIN_RADIUS_KM };
    expect(stepLocationRadius([noMaximo], paulista.key, 1, BOUNDS)[0]?.radius).toBe(MAX_RADIUS_KM);
    expect(stepLocationRadius([noMinimo], paulista.key, -1, BOUNDS)[0]?.radius).toBe(MIN_RADIUS_KM);
  });

  test("± sem raio parte do padrão", () => {
    const semRaio = { ...paulista, radius: undefined };
    expect(stepLocationRadius([semRaio], paulista.key, 1, BOUNDS)[0]?.radius).toBe(
      DEFAULT_CITY_RADIUS_KM + 1,
    );
  });

  test("só o local da chave muda", () => {
    expect(setLocationRadius([paulista, loja], loja.key, "9", BOUNDS)[0]).toEqual(paulista);
  });
});

describe("mover o pino", () => {
  test("uma cidade vira endereço personalizado com raio padrão", () => {
    expect(moveLocationPin([campinas], 0, -22.9, -47.06, BOUNDS)).toEqual([
      {
        ...campinas,
        key: "custom_-22.900000_-47.060000",
        type: "custom_location",
        latitude: -22.9,
        longitude: -47.06,
        address_string: "Campinas",
        radius: DEFAULT_CITY_RADIUS_KM,
        distance_unit: "kilometer",
      },
    ]);
  });

  test("um endereço mantém o raio e o texto do endereço", () => {
    const [moved] = moveLocationPin([paulista], 0, -23.6, -46.7, BOUNDS);
    expect(moved).toMatchObject({
      key: "custom_-23.600000_-46.700000",
      radius: 5,
      address_string: paulista.address_string,
    });
  });

  test("o raio padrão respeita o máximo configurado", () => {
    expect(moveLocationPin([campinas], 0, -22.9, -47.06, { min: 1, max: 10 })[0]?.radius).toBe(10);
  });

  test("os outros locais não mudam", () => {
    expect(moveLocationPin([campinas, paulista], 1, -23.6, -46.7, BOUNDS)[0]).toEqual(campinas);
  });

  test("depois de mover o pino, o raio edita pela chave nova", () => {
    const moved = moveLocationPin([campinas], 0, -22.9, -47.06, BOUNDS);
    const newKey = moved[0]?.key ?? "";
    expect(setLocationRadius(moved, newKey, "9", BOUNDS)[0]?.radius).toBe(9);
  });
});
