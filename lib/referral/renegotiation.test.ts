import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  describeMigrationChoice,
  migratesExistingCustomers,
  parseReferralMigrationChoice,
  REFERRAL_MIGRATION_CHOICE_VALUES,
} from "./renegotiation";

// O ponto inteiro do ticket 13 é que a escolha de migrar os indicados NÃO tem
// default. Estes testes existem para que ninguém, um dia, "conserte" a ausência
// de escolha transformando-a no caminho mais conveniente.

describe("escolha de migração — nunca implícita", () => {
  test("ausência é recusada, não vira 'manter'", () => {
    for (const ausente of [undefined, null, ""]) {
      const parsed = parseReferralMigrationChoice(ausente);
      assert.equal(parsed.ok, false);
      assert.equal(
        parsed.ok === false && parsed.error.includes("Escolha o que acontece"),
        true,
      );
    }
  });

  test("valor desconhecido é recusado com a mesma mensagem da ausência", () => {
    const ausente = parseReferralMigrationChoice(undefined);
    const invalido = parseReferralMigrationChoice("talvez");
    assert.equal(invalido.ok, false);
    assert.equal(
      invalido.ok === false && ausente.ok === false
        ? invalido.error === ausente.error
        : false,
      true,
    );
  });

  test("booleano não passa por escolha — 'false' seria um default disfarçado", () => {
    assert.equal(parseReferralMigrationChoice(false).ok, false);
    assert.equal(parseReferralMigrationChoice(true).ok, false);
  });

  test("as duas escolhas do domínio passam", () => {
    for (const choice of REFERRAL_MIGRATION_CHOICE_VALUES) {
      const parsed = parseReferralMigrationChoice(choice);
      assert.equal(parsed.ok, true);
      assert.equal(parsed.ok === true && parsed.choice, choice);
    }
  });
});

describe("o que cada escolha significa", () => {
  test("migrar move os indicados existentes; manter não", () => {
    assert.equal(migratesExistingCustomers("migrate"), true);
    assert.equal(migratesExistingCustomers("keep"), false);
  });

  test("a frase diz quantos indicados a escolha alcança", () => {
    assert.match(describeMigrationChoice("migrate", 12), /12 indicados/);
    assert.match(describeMigrationChoice("keep", 12), /12 indicados/);
    assert.match(describeMigrationChoice("migrate", 1), /1 indicado /);
  });

  test("um indicado só concorda no singular", () => {
    assert.match(describeMigrationChoice("migrate", 1), /1 indicado passa a ser regido/);
    assert.match(describeMigrationChoice("keep", 1), /1 indicado continua no acordo/);
    assert.match(describeMigrationChoice("migrate", 2), /2 indicados passam a ser regidos/);
    assert.match(describeMigrationChoice("keep", 2), /2 indicados continuam no acordo/);
  });

  test("migrar fala da próxima fatura, não do histórico", () => {
    const frase = describeMigrationChoice("migrate", 3);
    assert.match(frase, /próxima fatura/);
  });

  test("manter diz que só os novos nascem no acordo novo", () => {
    assert.match(describeMigrationChoice("keep", 3), /continuam no acordo antigo/);
  });

  test("sem indicados, a frase não promete movimento nenhum", () => {
    assert.match(describeMigrationChoice("migrate", 0), /Nenhum indicado/);
    assert.match(describeMigrationChoice("keep", 0), /Nenhum indicado/);
  });
});
