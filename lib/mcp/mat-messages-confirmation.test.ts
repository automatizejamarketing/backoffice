import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeOutreachBatch, type OutreachInput } from "@/lib/consultant-workspace/outreach-core";
import { batchConfirmationCode, verifyBatchConfirmation } from "./batch-confirmation";

/** preview_mat_messages → send_mat_messages: o código vale só para o lote exato que o usuário viu. */
describe("confirmação do lote de mensagens da Mat", () => {
  const now = Date.parse("2026-10-13T15:00:00Z");
  const user = "4f6c1a52-3a3e-4f1f-9a51-0d2b6c7e8f90";
  const batch: OutreachInput[] = [
    { userId: user, kind: "ad_balance", title: "o saldo acabou", message: "Oi! Adicione saldo: https://adsmanager.facebook.com/x" },
    { userId: user, kind: "scale_approval", title: "sua campanha validou", message: "Oi! Aprove no app.", entity: { level: "campaign", id: "1200001", adAccountId: "act_99999" } },
  ];
  const code = batchConfirmationCode(normalizeOutreachBatch(batch), "s", now);

  it("confirma o mesmo lote, mesmo com espaços sobrando e nome da entidade diferente", () => {
    const same = batch.map((message) => ({ ...message, title: `${message.title} `, ...(message.entity ? { entity: { ...message.entity, name: "outro nome" } } : {}) }));
    assert.equal(verifyBatchConfirmation(code, normalizeOutreachBatch(same), "s", now + 1000), "ok");
  });

  it("recusa texto, tipo, cliente, entidade ou ordem diferentes", () => {
    const changes: OutreachInput[][] = [
      [{ ...batch[0], message: `${batch[0].message} agora` }, batch[1]],
      [{ ...batch[0], kind: "pixel_setup" }, batch[1]],
      [{ ...batch[0], userId: "0b1c2d3e-4f50-4a6b-8c7d-8e9fa0b1c2d3" }, batch[1]],
      [batch[0], { ...batch[1], entity: { level: "campaign", id: "1200002", adAccountId: "act_99999" } }],
      [batch[1], batch[0]],
      [batch[0]],
    ];
    for (const changed of changes) assert.equal(verifyBatchConfirmation(code, normalizeOutreachBatch(changed), "s", now), "mismatch");
  });

  it("expira em 15 minutos", () => {
    assert.equal(verifyBatchConfirmation(code, normalizeOutreachBatch(batch), "s", now + 15 * 60 * 1000 + 1), "expired");
  });
});
