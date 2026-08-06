import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  evaluateReferralWriteOff,
  formatCentavos,
  parseReaisToCentavos,
  referralDebtCentavos,
  REFERRAL_WRITE_OFF_MIN_REASON_LENGTH,
} from "./write-off";

// A baixa é a ÚNICA escrita do programa que cria dinheiro do lado do afiliado.
// Todo caso que ela recusa está aqui, porque cada um deles é a diferença entre
// uma correção contábil e um crédito indevido.

const MOTIVO = "Chargeback recebido depois do repasse";

describe("dívida — o que a baixa enxerga", () => {
  test("saldo negativo vira dívida em módulo", () => {
    assert.equal(referralDebtCentavos(-19_000), 19_000);
  });

  test("saldo positivo e saldo zerado não têm dívida", () => {
    assert.equal(referralDebtCentavos(19_000), 0);
    assert.equal(referralDebtCentavos(0), 0);
  });
});

describe("baixa — quando ela NÃO pode ser lançada", () => {
  test("saldo positivo é recusado", () => {
    const result = evaluateReferralWriteOff({
      availableCentavos: 19_000,
      requestedCentavos: null,
      reason: MOTIVO,
    });
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.refusal, "balance_not_negative");
  });

  test("saldo zerado é recusado — zero não é dívida", () => {
    const result = evaluateReferralWriteOff({
      availableCentavos: 0,
      requestedCentavos: null,
      reason: MOTIVO,
    });
    assert.equal(result.ok === false && result.refusal, "balance_not_negative");
  });

  test("sem motivo é recusado", () => {
    const result = evaluateReferralWriteOff({
      availableCentavos: -19_000,
      requestedCentavos: null,
      reason: "",
    });
    assert.equal(result.ok === false && result.refusal, "missing_reason");
  });

  test("motivo só de espaços é o mesmo que motivo nenhum", () => {
    const result = evaluateReferralWriteOff({
      availableCentavos: -19_000,
      requestedCentavos: null,
      reason: "        ",
    });
    assert.equal(result.ok === false && result.refusal, "missing_reason");
  });

  test("motivo curto demais é recusado", () => {
    const curto = "x".repeat(REFERRAL_WRITE_OFF_MIN_REASON_LENGTH - 1);
    const result = evaluateReferralWriteOff({
      availableCentavos: -19_000,
      requestedCentavos: null,
      reason: curto,
    });
    assert.equal(result.ok === false && result.refusal, "missing_reason");
  });

  test("valor acima da dívida é recusado — a baixa nunca vira crédito", () => {
    const result = evaluateReferralWriteOff({
      availableCentavos: -19_000,
      requestedCentavos: 19_001,
      reason: MOTIVO,
    });
    assert.equal(result.ok === false && result.refusal, "above_debt");
    assert.ok(
      result.ok === false && result.message.includes("R$ 190,00"),
      "a recusa diz de quanto é a dívida",
    );
  });

  test("valor zero, negativo ou fracionário é recusado", () => {
    for (const requestedCentavos of [0, -100, 100.5]) {
      const result = evaluateReferralWriteOff({
        availableCentavos: -19_000,
        requestedCentavos,
        reason: MOTIVO,
      });
      assert.equal(
        result.ok === false && result.refusal,
        "invalid_amount",
        `valor ${requestedCentavos} deveria ser recusado`,
      );
    }
  });
});

describe("baixa — quando ela pode", () => {
  test("sem valor informado, a baixa é a dívida inteira e zera o saldo", () => {
    const result = evaluateReferralWriteOff({
      availableCentavos: -19_000,
      requestedCentavos: null,
      reason: MOTIVO,
    });
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.amountCentavos, 19_000);
    assert.equal(result.ok && result.clearsBalance, true);
  });

  test("valor menor que a dívida reduz sem zerar", () => {
    const result = evaluateReferralWriteOff({
      availableCentavos: -19_000,
      requestedCentavos: 5_000,
      reason: MOTIVO,
    });
    assert.equal(result.ok && result.amountCentavos, 5_000);
    assert.equal(result.ok && result.clearsBalance, false);
  });

  test("o motivo gravado vem sem espaço sobrando", () => {
    const result = evaluateReferralWriteOff({
      availableCentavos: -19_000,
      requestedCentavos: null,
      reason: `   ${MOTIVO}   `,
    });
    assert.equal(result.ok && result.reason, MOTIVO);
  });

  test("a baixa é sempre positiva — é ela que sobe o saldo", () => {
    const result = evaluateReferralWriteOff({
      availableCentavos: -14_000,
      requestedCentavos: null,
      reason: MOTIVO,
    });
    assert.ok(result.ok && result.amountCentavos > 0);
  });
});

describe("dinheiro na tela", () => {
  test("centavos viram reais com milhar e vírgula", () => {
    assert.equal(formatCentavos(19_000), "R$ 190,00");
    assert.equal(formatCentavos(123_456), "R$ 1.234,56");
    assert.equal(formatCentavos(100_000_000), "R$ 1.000.000,00");
    assert.equal(formatCentavos(5), "R$ 0,05");
  });

  test("negativo mantém o sinal", () => {
    assert.equal(formatCentavos(-19_000), "-R$ 190,00");
  });

  test("nenhum espaço não separável escapa para a comparação", () => {
    const formatted = formatCentavos(123_456);
    assert.ok(!formatted.includes("\u00a0"), "sem U+00A0");
    assert.ok(!formatted.includes("\u202f"), "sem U+202F");
  });
});

describe("valor digitado pelo operador", () => {
  test("formato brasileiro completo", () => {
    assert.equal(parseReaisToCentavos("1.234,56"), 123_456);
    assert.equal(parseReaisToCentavos("R$ 1.234,56"), 123_456);
  });

  test("formato simples, com vírgula ou ponto", () => {
    assert.equal(parseReaisToCentavos("190,00"), 19_000);
    assert.equal(parseReaisToCentavos("190.00"), 19_000);
    assert.equal(parseReaisToCentavos("12,34"), 1_234);
  });

  test("inteiro é lido como reais, não como centavos", () => {
    assert.equal(parseReaisToCentavos("190"), 19_000);
    assert.equal(parseReaisToCentavos("1.234"), 123_400);
  });

  test("lixo devolve null em vez de adivinhar", () => {
    for (const raw of ["", "abc", "1,234,56", "-190", "1.2345", "190,999"]) {
      assert.equal(
        parseReaisToCentavos(raw),
        null,
        `"${raw}" deveria ser recusado`,
      );
    }
  });

  test("zero não é valor de baixa", () => {
    assert.equal(parseReaisToCentavos("0"), null);
    assert.equal(parseReaisToCentavos("0,00"), null);
  });
});
