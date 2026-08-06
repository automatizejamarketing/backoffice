import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { REFERRAL_PAYOUT_STATUS_VALUES } from "@/lib/db/schema";
import type { ReferralPayoutStatus } from "@/lib/db/schema";
import {
  canTransitionReferralPayout,
  formatTaxDocument,
  isOpenReferralPayoutStatus,
  REFERRAL_PAYOUT_TRANSITIONS,
} from "./payout";

// A mesma tabela do `automatize-frontend/lib/referral/payout.ts`. Os dois lados
// movem o mesmo pedido, e uma divergência entre eles seria dinheiro andando de
// um jeito num app e de outro no outro.

describe("máquina de estados do saque — as transições que existem", () => {
  test("solicitado pode ser aprovado, negado ou cancelado", () => {
    assert.equal(canTransitionReferralPayout("requested", "approved"), true);
    assert.equal(canTransitionReferralPayout("requested", "denied"), true);
    assert.equal(canTransitionReferralPayout("requested", "cancelled"), true);
  });

  test("aprovado pode ser pago, negado ou cancelado", () => {
    assert.equal(canTransitionReferralPayout("approved", "paid"), true);
    assert.equal(canTransitionReferralPayout("approved", "denied"), true);
    assert.equal(canTransitionReferralPayout("approved", "cancelled"), true);
  });

  test("os dois estados abertos são solicitado e aprovado", () => {
    assert.equal(isOpenReferralPayoutStatus("requested"), true);
    assert.equal(isOpenReferralPayoutStatus("approved"), true);
    assert.equal(isOpenReferralPayoutStatus("paid"), false);
    assert.equal(isOpenReferralPayoutStatus("denied"), false);
    assert.equal(isOpenReferralPayoutStatus("cancelled"), false);
  });
});

describe("máquina de estados do saque — cada transição inválida", () => {
  test("solicitado NÃO vai direto para pago", () => {
    assert.equal(canTransitionReferralPayout("requested", "paid"), false);
  });

  test("aprovado não volta para solicitado", () => {
    assert.equal(canTransitionReferralPayout("approved", "requested"), false);
  });

  test("pago não vai para lugar nenhum", () => {
    assert.equal(canTransitionReferralPayout("paid", "requested"), false);
    assert.equal(canTransitionReferralPayout("paid", "approved"), false);
    assert.equal(canTransitionReferralPayout("paid", "denied"), false);
    assert.equal(canTransitionReferralPayout("paid", "cancelled"), false);
  });

  test("negado não vai para lugar nenhum", () => {
    assert.equal(canTransitionReferralPayout("denied", "requested"), false);
    assert.equal(canTransitionReferralPayout("denied", "approved"), false);
    assert.equal(canTransitionReferralPayout("denied", "paid"), false);
    assert.equal(canTransitionReferralPayout("denied", "cancelled"), false);
  });

  test("cancelado não vai para lugar nenhum", () => {
    assert.equal(canTransitionReferralPayout("cancelled", "requested"), false);
    assert.equal(canTransitionReferralPayout("cancelled", "approved"), false);
    assert.equal(canTransitionReferralPayout("cancelled", "paid"), false);
    assert.equal(canTransitionReferralPayout("cancelled", "denied"), false);
  });

  test("repetir o estado atual não é transição", () => {
    for (const status of REFERRAL_PAYOUT_STATUS_VALUES) {
      assert.equal(
        canTransitionReferralPayout(status, status),
        false,
        `${status} → ${status} deveria ser recusado`,
      );
    }
  });

  test("a tabela cobre os cinco estados e não inventa nenhum", () => {
    assert.deepEqual(
      Object.keys(REFERRAL_PAYOUT_TRANSITIONS).sort(),
      [...REFERRAL_PAYOUT_STATUS_VALUES].sort(),
    );
    for (const destino of Object.values(REFERRAL_PAYOUT_TRANSITIONS).flat()) {
      assert.ok(
        REFERRAL_PAYOUT_STATUS_VALUES.includes(destino as ReferralPayoutStatus),
        `${destino} não é um estado do saque`,
      );
    }
  });
});

describe("documento fiscal na fila", () => {
  test("o documento aparece formatado para a conferência do Pix", () => {
    assert.equal(formatTaxDocument("12345678909", "cpf"), "123.456.789-09");
    assert.equal(
      formatTaxDocument("11222333000181", "cnpj"),
      "11.222.333/0001-81",
    );
  });
});
