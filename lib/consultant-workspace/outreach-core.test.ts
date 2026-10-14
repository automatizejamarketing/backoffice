import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildOutreachRequestBody,
  isMatTemplateKey,
  mapOutreachError,
  normalizeOutreachBatch,
  outreachInputSchema,
  outreachResponseSchema,
  type OutreachInput,
} from "./outreach-core";

const USER = "4f6c1a52-3a3e-4f1f-9a51-0d2b6c7e8f90";
const base: OutreachInput = { userId: USER, kind: "creative_refresh", title: "precisamos de fotos novas", message: "Oi, Ana! Pode mandar 3 fotos?" };

describe("mensagem da Mat · entrada", () => {
  it("aceita o contrato e apara espaços", () => {
    const parsed = outreachInputSchema.parse({ ...base, title: "  título  " });
    assert.equal(parsed.title, "título");
  });

  it("recusa título com mais de 60, título em duas linhas e mensagem acima de 700", () => {
    assert.equal(outreachInputSchema.safeParse({ ...base, title: "x".repeat(61) }).success, false);
    assert.equal(outreachInputSchema.safeParse({ ...base, title: "linha 1\nlinha 2" }).success, false);
    assert.equal(outreachInputSchema.safeParse({ ...base, message: "x".repeat(701) }).success, false);
    assert.equal(outreachInputSchema.safeParse({ ...base, message: "   " }).success, false);
    assert.equal(outreachInputSchema.safeParse({ ...base, kind: "promo" }).success, false);
  });

  it("pedir aprovação para escalar exige a campanha", () => {
    assert.equal(outreachInputSchema.safeParse({ ...base, kind: "scale_approval" }).success, false);
    assert.equal(outreachInputSchema.safeParse({ ...base, kind: "scale_approval", entity: { level: "ad", id: "1200001" } }).success, false);
    assert.equal(
      outreachInputSchema.safeParse({ ...base, kind: "scale_approval", entity: { level: "campaign", id: "1200001", adAccountId: "act_99999" } }).success,
      true,
    );
    assert.equal(outreachInputSchema.safeParse({ ...base, entity: { level: "campaign", id: "1200001", adAccountId: "99" } }).success, false);
  });

  it("o e-mail do gestor entra no corpo pelo servidor, nunca pela entrada", () => {
    const input = outreachInputSchema.parse({ ...base, consultantEmail: "intruso@x.com" } as unknown);
    assert.deepEqual(buildOutreachRequestBody("preview", input, "gestor@automatize.com"), {
      mode: "preview",
      userId: USER,
      kind: "creative_refresh",
      title: "precisamos de fotos novas",
      message: "Oi, Ana! Pode mandar 3 fotos?",
      consultantEmail: "gestor@automatize.com",
    });
  });

  it("marca o canal Mat pelo templateKey", () => {
    assert.equal(isMatTemplateKey("mat:ad_balance"), true);
    assert.equal(isMatTemplateKey("resumo_semanal"), false);
    assert.equal(isMatTemplateKey(undefined), false);
  });
});

describe("mensagem da Mat · resposta do app", () => {
  it("lê a resposta 200 com os campos opcionais ausentes", () => {
    const parsed = outreachResponseSchema.parse({
      ok: true,
      mode: "preview",
      recipient: { available: true, source: "user_phone", masked: "+55 11 •••• 8888" },
      rendered: { title: "t", message: "m", buttonUrl: "https://app/x", template: "proactivity_alert_v1" },
    });
    assert.deepEqual(parsed.approval, { available: false, actionLabel: null });
  });

  it("traduz cada erro do contrato para o gestor", () => {
    assert.equal(mapOutreachError(400, { error: "title_too_long" }).code, "invalid_input");
    const unauthorized = mapOutreachError(401, {});
    assert.equal(unauthorized.code, "unauthorized");
    assert.equal(unauthorized.status, 502);
    assert.equal(mapOutreachError(404, { error: "user_not_found" }).code, "user_not_found");
    const noRecipient = mapOutreachError(409, { error: "no_recipient" });
    assert.equal(noRecipient.code, "no_recipient");
    assert.match(noRecipient.message, /Abrir no WhatsApp/);
    const recent = mapOutreachError(409, { error: "recently_sent", lastSentAt: "2026-10-13T13:05:00.000Z" });
    assert.equal(recent.code, "recently_sent");
    assert.equal(recent.lastSentAt, "2026-10-13T13:05:00.000Z");
    assert.match(recent.message, /13\/10.*10:05/);
    assert.equal(mapOutreachError(422, { error: "whatsapp_not_configured" }).code, "whatsapp_not_configured");
    const provider = mapOutreachError(502, { error: "provider_error", detail: "131026 undeliverable" });
    assert.equal(provider.code, "provider_error");
    assert.match(provider.message, /131026 undeliverable/);
    const unexpected = mapOutreachError(500, null, "send");
    assert.equal(unexpected.code, "unexpected");
    assert.match(unexpected.message, /Confira o histórico/);
  });
});

describe("mensagem da Mat · lote do MCP", () => {
  it("normaliza o que a confirmação amarra (cliente, tipo, texto e entidade)", () => {
    const withEntity: OutreachInput = { ...base, kind: "scale_approval", entity: { level: "campaign", id: "1200001", name: "Pizza" } };
    assert.deepEqual(normalizeOutreachBatch([base, withEntity]), [
      [USER, "creative_refresh", "precisamos de fotos novas", "Oi, Ana! Pode mandar 3 fotos?", null],
      [USER, "scale_approval", "precisamos de fotos novas", "Oi, Ana! Pode mandar 3 fotos?", ["campaign", "1200001", null]],
    ]);
  });
});
