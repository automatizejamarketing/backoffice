import { describe, expect, test } from "bun:test";

import { geoSummaryLine, scheduleSummary } from "./review-summaries";

describe("scheduleSummary", () => {
  test("dia todo não lista faixas", () => {
    expect(scheduleSummary({ deliveryMode: "all_day", scheduleBlocks: [] })).toBe("Dia todo");
  });

  test("horários específicos sem faixa avisa que falta escolher", () => {
    expect(scheduleSummary({ deliveryMode: "specific_hours", scheduleBlocks: [] })).toBe(
      "Nenhum horário escolhido",
    );
  });

  test("uma faixa em todos os dias", () => {
    expect(
      scheduleSummary({
        deliveryMode: "specific_hours",
        scheduleBlocks: [{ days: [1, 2, 3, 4, 5, 6, 0], startMinute: 540, endMinute: 1080 }],
      }),
    ).toBe("Todos os dias 09:00–18:00");
  });

  test("dias úteis e fim de semana têm nome próprio; o resto lista os dias na ordem da Meta", () => {
    expect(
      scheduleSummary({
        deliveryMode: "specific_hours",
        scheduleBlocks: [
          { days: [1, 2, 3, 4, 5], startMinute: 540, endMinute: 1080 },
          { days: [6, 0], startMinute: 600, endMinute: 840 },
          { days: [0, 3], startMinute: 0, endMinute: 90 },
        ],
      }),
    ).toBe("Seg a sex 09:00–18:00 · Fim de semana 10:00–14:00 · Qua, Dom 00:00–01:30");
  });

  test("blocos com o mesmo horário viram um só, com os dias em sequência abreviados", () => {
    expect(
      scheduleSummary({
        deliveryMode: "specific_hours",
        scheduleBlocks: [
          { days: [0], startMinute: 0, endMinute: 60 },
          { days: [6], startMinute: 0, endMinute: 60 },
          { days: [1], startMinute: 1080, endMinute: 1440 },
          { days: [2], startMinute: 1080, endMinute: 1440 },
          { days: [3], startMinute: 1080, endMinute: 1440 },
          { days: [4], startMinute: 1080, endMinute: 1440 },
          { days: [5], startMinute: 1080, endMinute: 1440 },
          { days: [6], startMinute: 1080, endMinute: 1440 },
        ],
      }),
    ).toBe("Fim de semana 00:00–01:00 · Seg a sáb 18:00–24:00");
  });
});

describe("geoSummaryLine", () => {
  const zero = { customLocations: 0, cities: 0, regions: 0, countries: 0 };

  test("locais nomeados, com e sem raio", () => {
    expect(
      geoSummaryLine({
        ...zero,
        customLocations: 1,
        cities: 1,
        locations: [{ label: "Av. Paulista, 1000", radiusKm: 5 }, { label: "Campinas" }],
      }),
    ).toBe("Av. Paulista, 1000 · 5 km · Campinas");
  });

  test("sem nomes, cai nas contagens", () => {
    expect(geoSummaryLine({ customLocations: 2, cities: 1, regions: 0, countries: 1 })).toBe(
      "2 endereço(s) + 1 cidade(s) + 1 país(es)",
    );
    expect(geoSummaryLine({ ...zero, regions: 3 })).toBe("3 região(ões)");
  });

  test("lista de nomes vazia também cai nas contagens", () => {
    expect(geoSummaryLine({ ...zero, cities: 2, locations: [] })).toBe("2 cidade(s)");
  });

  test("nada segmentado ou plano ausente", () => {
    expect(geoSummaryLine(zero)).toBe("não especificada");
    expect(geoSummaryLine(undefined)).toBe("não especificada");
  });
});
