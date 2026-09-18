import { describe, expect, test } from "bun:test";

import { scheduleSummary } from "./review-summaries";

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
