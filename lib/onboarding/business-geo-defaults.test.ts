import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  areBusinessUnitLocationsIncludedInSelection,
  buildSavedCustomLocations,
  needsAiLocationStep,
  parseBusinessAddress,
  resolveEffectiveAiLocations,
} from "./business-geo-defaults";

const LARICA_ADDRESS = {
  city: "Campos dos Goytacazes",
  state: "RJ",
  street: "Av. Pelinca",
  country: "BR",
  latitude: -21.7584528,
  longitude: -41.3357904,
  formatted:
    "Av. Pelinca, 258 - Parque Tamandaré, Campos dos Goytacazes - RJ, 28010-280",
  postalCode: "28010-280",
  neighborhood: "Parque Tamandaré",
  streetNumber: "258",
};

describe("buildSavedCustomLocations — pré-seleção do Inhar", () => {
  test("unidade salva no onboarding vira custom_location com o ponto do negócio", () => {
    const selected = buildSavedCustomLocations(
      {
        id: "company-1",
        name: "Larica Sanduicheria",
        googlePlaceId: "ChIJ1UKNZVHVvQARdiIv1LnlDxQ",
        businessAddress: LARICA_ADDRESS,
      },
      [
        {
          id: "location-1",
          name: "Larica Sanduicheria",
          googlePlaceId: "ChIJ1UKNZVHVvQARdiIv1LnlDxQ",
          businessAddress: LARICA_ADDRESS,
        },
      ],
    );

    assert.equal(selected.length, 1);
    assert.equal(selected[0]?.type, "custom_location");
    assert.equal(selected[0]?.key, "google:ChIJ1UKNZVHVvQARdiIv1LnlDxQ");
    assert.equal(selected[0]?.latitude, -21.7584528);
    assert.equal(selected[0]?.longitude, -41.3357904);
    assert.equal(selected[0]?.primary_city, "Campos dos Goytacazes");
    assert.match(selected[0]?.address_string ?? "", /Av\. Pelinca/);
  });

  test("sem linhas em company_locations, usa o endereço legado da empresa", () => {
    const selected = buildSavedCustomLocations(
      {
        id: "company-1",
        name: "Larica Sanduicheria",
        googlePlaceId: "ChIJ1UKNZVHVvQARdiIv1LnlDxQ",
        businessAddress: LARICA_ADDRESS,
      },
      [],
    );

    assert.equal(selected.length, 1);
    assert.equal(selected[0]?.type, "custom_location");
    assert.equal(selected[0]?.name, "Larica Sanduicheria");
  });

  test("perfil sem coordenadas não inventa Brasil inteiro como pré-seleção", () => {
    const selected = buildSavedCustomLocations(
      { id: "company-1", name: "Sem endereço" },
      [],
    );

    assert.deepEqual(selected, []);
  });

  test("endereço sem formatted não vira geo", () => {
    assert.equal(
      parseBusinessAddress({ latitude: -21.7, longitude: -41.3 }),
      null,
    );
  });

  test("igual ao app do cliente: endereço salvo pula o passo e entra na campanha", () => {
    const saved = buildSavedCustomLocations(
      {
        id: "company-1",
        name: "Larica Sanduicheria",
        googlePlaceId: "ChIJ1UKNZVHVvQARdiIv1LnlDxQ",
        businessAddress: LARICA_ADDRESS,
      },
      [
        {
          id: "location-1",
          name: "Larica Sanduicheria",
          googlePlaceId: "ChIJ1UKNZVHVvQARdiIv1LnlDxQ",
          businessAddress: LARICA_ADDRESS,
        },
      ],
    );
    const effective = resolveEffectiveAiLocations([], saved);

    assert.equal(effective.length, 1);
    assert.equal(needsAiLocationStep(false, effective), false);
    assert.equal(needsAiLocationStep(true, []), false);
    assert.equal(needsAiLocationStep(false, []), true);
  });

  test("escolha manual vence o endereço salvo", () => {
    const saved = buildSavedCustomLocations(
      {
        id: "company-1",
        name: "Larica Sanduicheria",
        businessAddress: LARICA_ADDRESS,
      },
      [],
    );
    const manual = [
      {
        key: "google:other",
        name: "Outro ponto",
        type: "custom_location" as const,
        latitude: -22.9,
        longitude: -43.2,
      },
    ];

    assert.deepEqual(resolveEffectiveAiLocations(manual, saved), manual);
    assert.equal(
      areBusinessUnitLocationsIncludedInSelection(
        { id: "company-1", name: "Larica Sanduicheria", businessAddress: LARICA_ADDRESS },
        [],
        saved,
      ),
      true,
    );
  });
});
