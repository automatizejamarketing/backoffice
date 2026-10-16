import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseGraphError } from "./error";

/**
 * Mesma regra do app (automatize-frontend, lib/meta-business/meta-user-text-fallback.test.ts):
 * quando a nossa tradução é genérica — o "100" sem subcódigo traduzido ou um código
 * desconhecido — a tela mostra o texto que a Meta escreveu para o usuário. Traduções por
 * código que já orientam continuam as nossas.
 *
 * Origem: Divino Lanches, 01/10/2026 — a Meta recusou o conjunto com 100/1487094
 * ("Nenhuma data de término inserida") e a tela mostrou só o genérico. O "Criar conjunto"
 * do backoffice usa o mesmo motor espelhado e esta tabela de traduções.
 */

function graphError(error: Record<string, unknown>) {
  return parseGraphError({
    error: { message: "Invalid parameter", type: "OAuthException", ...error },
  });
}

describe("texto da Meta no lugar das traduções genéricas (backoffice)", () => {
  it("100 com subcódigo sem tradução: título e mensagem da Meta, código na solução", () => {
    const parsed = graphError({
      code: 100,
      error_subcode: 2446149,
      error_user_title: "O orçamento é muito baixo",
      error_user_msg:
        "Seu orçamento de campanha deve ser de pelo menos R$38,12 para cobrir todos os conjuntos de anúncios nesta campanha.",
    });

    assert.equal(parsed.statusCode, 400);
    assert.equal(parsed.reason.title, "O orçamento é muito baixo");
    assert.equal(
      parsed.reason.message,
      "Seu orçamento de campanha deve ser de pelo menos R$38,12 para cobrir todos os conjuntos de anúncios nesta campanha.",
    );
    assert.equal(
      parsed.reason.solution,
      "Se não souber como resolver, fale com o suporte e informe o código 100/2446149.",
    );
    assert.equal(parsed.reason.isTransient, false);
  });

  it("1487094 tem tradução própria e ela vence o texto da Meta", () => {
    const parsed = graphError({
      code: 100,
      error_subcode: 1487094,
      error_user_title: "Nenhuma data de término inserida",
      error_user_msg:
        "Os conjuntos de anúncios que usam o orçamento vitalício como o tipo de orçamento devem ter uma data de término. Insira uma data de término após mais de 24 horas da hora de início.",
    });

    assert.equal(parsed.statusCode, 400);
    assert.equal(parsed.reason.title, "Conjunto sem data de término");
    assert.equal(
      parsed.reason.message,
      "Com orçamento total, a Meta exige que cada conjunto tenha data de término mais de 24 horas depois do início, mesmo quando o orçamento fica na campanha.",
    );
    assert.equal(
      parsed.reason.solution,
      "Defina a data de término do conjunto pelo menos 24 horas após o início. Se o orçamento é da campanha, o conjunto usa as datas dela: confira se a campanha ainda tem mais de 24 horas pela frente.",
    );
    assert.equal(parsed.reason.isTransient, false);
  });

  it("código que o app não conhece: texto da Meta, mantendo status e nova tentativa do genérico", () => {
    const parsed = graphError({
      code: 987654,
      error_user_title: "Algo deu errado",
      error_user_msg: "Tente de novo daqui a pouco.",
    });

    assert.equal(parsed.statusCode, 500);
    assert.equal(parsed.reason.title, "Algo deu errado");
    assert.equal(parsed.reason.message, "Tente de novo daqui a pouco.");
    assert.equal(
      parsed.reason.solution,
      "Se não souber como resolver, fale com o suporte e informe o código 987654.",
    );
    assert.equal(parsed.reason.isTransient, true);
  });

  it("sem título da Meta: fica o nosso título e entra a mensagem dela", () => {
    const parsed = graphError({
      code: 100,
      error_subcode: 1885630,
      error_user_msg:
        "Não é permitida a alteração de orçamento vitalício para diário ou vice-versa em uma campanha.",
    });

    assert.equal(parsed.reason.title, "Parâmetro inválido");
    assert.equal(
      parsed.reason.message,
      "Não é permitida a alteração de orçamento vitalício para diário ou vice-versa em uma campanha.",
    );
  });

  it("sem texto da Meta, continua a tradução genérica", () => {
    const parsed = graphError({ code: 100, error_subcode: 1885630 });

    assert.equal(parsed.reason.title, "Parâmetro inválido");
    assert.equal(
      parsed.reason.message,
      "Um ou mais parâmetros da requisição são inválidos para a Marketing API.",
    );
  });

  it("texto da Meta em branco conta como ausente", () => {
    const parsed = graphError({
      code: 100,
      error_subcode: 1885630,
      error_user_title: " ",
      error_user_msg: "   ",
    });

    assert.equal(parsed.reason.title, "Parâmetro inválido");
    assert.equal(
      parsed.reason.message,
      "Um ou mais parâmetros da requisição são inválidos para a Marketing API.",
    );
  });

  it("tradução por código que já orienta (Meta instável) não cede ao texto da Meta", () => {
    const parsed = graphError({
      code: 2,
      error_subcode: 1504044,
      message: "Service temporarily unavailable",
      error_user_title: "Ocorreu um erro desconhecido",
      error_user_msg:
        "Ocorreu um erro inesperado. Atualize a página ou tente novamente. Se o problema persistir, fale com o suporte.",
    });

    assert.equal(parsed.statusCode, 503);
    assert.equal(parsed.reason.title, "Serviço temporariamente indisponível");
    assert.equal(parsed.reason.isTransient, true);
  });
});
