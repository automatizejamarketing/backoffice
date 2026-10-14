import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import {
  decideTask,
  dropdownOptionId,
  feedback,
  isOwnEcho,
  statusChanges,
  statusIntent,
  verifySignature,
  type ClickupMapping,
  type ClickupTask,
} from "./core";

const NOW = new Date("2026-10-14T12:00:00Z");
const LATER = NOW.getTime() + 3 * 3600_000;
const OPTIONS = [
  { id: "opt-alquimia", name: "Alquimia RJ", orderindex: 0 },
  { id: "opt-clinica", name: "Clínica Sorriso", orderindex: 1 },
];

const mapping: ClickupMapping = {
  listId: "list-1",
  listName: "Publicação",
  clientFieldId: "f-client",
  mediaFieldId: "f-media",
  captionFieldId: "f-caption",
  publishAtFieldId: "f-when",
  formats: { "0": "post", "1001": "reels" },
  statuses: { approval: "para agendar", scheduled: "agendado", published: "publicado", error: "erro na publicação" },
  clientOptions: { "opt-alquimia": "user-alquimia" },
};

function task(overrides: { client?: unknown; media?: unknown; caption?: unknown; when?: unknown; type?: number | null } = {}): ClickupTask {
  return {
    id: "t1",
    name: "Post de terça",
    status: { status: "para agendar" },
    custom_item_id: overrides.type ?? null,
    custom_fields: [
      { id: "f-client", type: "drop_down", value: "client" in overrides ? overrides.client : 0, type_config: { options: OPTIONS } },
      { id: "f-media", type: "attachment", value: "media" in overrides ? overrides.media : [{ url: "https://t.clickup-attachments.com/a/arte.png", mimetype: "image/png" }] },
      { id: "f-caption", type: "text", value: "caption" in overrides ? overrides.caption : "Legenda do post" },
      { id: "f-when", type: "date", value: "when" in overrides ? overrides.when : String(LATER) },
    ],
  };
}

const ready = () => ({ ready: true as const, instagramUsername: "alquimiarj" });

describe("ClickUp: assinatura do webhook", () => {
  it("aceita o HMAC do corpo cru e recusa qualquer diferença", () => {
    const body = '{"event":"taskStatusUpdated","task_id":"t1"}';
    const sig = createHmac("sha256", "segredo").update(body).digest("hex");
    assert.equal(verifySignature(body, sig, "segredo"), true);
    assert.equal(verifySignature(body, sig.toUpperCase(), "segredo"), true);
    assert.equal(verifySignature(`${body} `, sig, "segredo"), false);
    assert.equal(verifySignature(body, sig, "outro"), false);
    assert.equal(verifySignature(body, null, "segredo"), false);
    assert.equal(verifySignature(body, "abc", "segredo"), false);
  });
});

describe("ClickUp: Campo Cliente", () => {
  it("traduz orderindex (GET da tarefa) e id da opção (webhook) para o id da opção", () => {
    const field = { id: "f", type: "drop_down", type_config: { options: OPTIONS } };
    assert.equal(dropdownOptionId({ ...field, value: 1 }), "opt-clinica");
    assert.equal(dropdownOptionId({ ...field, value: "1" }), "opt-clinica");
    assert.equal(dropdownOptionId({ ...field, value: "opt-alquimia" }), "opt-alquimia");
    assert.equal(dropdownOptionId({ ...field, value: null }), null);
    assert.equal(dropdownOptionId({ ...field, value: 9 }), null);
  });
});

describe("ClickUp: tarefa aprovada", () => {
  it("agenda post com cliente ligado, arte, legenda e horário futuro", () => {
    const decision = decideTask(task(), mapping, ready, NOW);
    assert.equal(decision.kind, "schedule");
    if (decision.kind !== "schedule") return;
    assert.equal(decision.userId, "user-alquimia");
    assert.equal(decision.format, "post");
    assert.equal(decision.publishAt.getTime(), LATER);
    assert.deepEqual(decision.media, [{ url: "https://t.clickup-attachments.com/a/arte.png", kind: "image" }]);
  });

  it("ignora tipo de tarefa fora da publicação (ex.: Criativo)", () => {
    assert.equal(decideTask(task({ type: 2002 }), mapping, ready, NOW).kind, "ignore");
  });

  it("recusa listando tudo o que falta de uma vez", () => {
    const decision = decideTask(task({ client: null, media: [], when: null }), mapping, ready, NOW);
    assert.equal(decision.kind, "refuse");
    if (decision.kind !== "refuse") return;
    assert.deepEqual(decision.reasons, ["Escolha o cliente no campo Cliente.", "Preencha o horário de publicação.", "Anexe a arte (JPG ou PNG)."]);
  });

  it("recusa opção não ligada, conta sem Instagram e horário no passado", () => {
    assert.match(String((decideTask(task({ client: 1 }), mapping, ready, NOW) as { reasons: string[] }).reasons), /não está ligado/);
    const noIg = decideTask(task(), mapping, () => ({ ready: false, reason: "O Instagram do cliente precisa ser reconectado." }), NOW);
    assert.deepEqual((noIg as { reasons: string[] }).reasons, ["O Instagram do cliente precisa ser reconectado."]);
    const past = decideTask(task({ when: String(NOW.getTime() + 60_000) }), mapping, ready, NOW);
    assert.match(String((past as { reasons: string[] }).reasons), /5 minutos no futuro/);
  });

  it("Reels exige um vídeo; post não aceita vídeo; carrossel até 10", () => {
    const video = [{ url: "https://x/v.mp4", mimetype: "video/mp4" }];
    assert.equal(decideTask(task({ type: 1001, media: video }), mapping, ready, NOW).kind, "schedule");
    assert.equal(decideTask(task({ type: 1001 }), mapping, ready, NOW).kind, "refuse");
    assert.equal(decideTask(task({ media: video }), mapping, ready, NOW).kind, "refuse");
    const eleven = Array.from({ length: 11 }, (_, i) => ({ url: `https://x/${i}.jpg`, mimetype: "image/jpeg" }));
    assert.match(String((decideTask(task({ media: eleven }), mapping, ready, NOW) as { reasons: string[] }).reasons), /até 10/);
    const pdf = [{ url: "https://x/briefing.pdf", mimetype: "application/pdf", title: "briefing.pdf" }];
    assert.match(String((decideTask(task({ media: pdf }), mapping, ready, NOW) as { reasons: string[] }).reasons), /briefing.pdf/);
  });

  it("sem campo de arquivo mapeado, usa os anexos da tarefa", () => {
    const t = { ...task({ media: null }), attachments: [{ url: "https://x/a.JPG", extension: "JPG" }] };
    assert.equal(decideTask(t, { ...mapping, mediaFieldId: null }, ready, NOW).kind, "schedule");
  });
});

describe("ClickUp: mudanças de status", () => {
  const payload = {
    event: "taskStatusUpdated",
    task_id: "t1",
    history_items: [
      { id: "h1", field: "status", date: String(NOW.getTime()), before: { status: "em produção" }, after: { status: "Para agendar" } },
      { id: "h2", field: "name", date: String(NOW.getTime()) },
    ],
  };

  it("lê só os itens de status e reconhece aprovação sem diferenciar maiúsculas", () => {
    const changes = statusChanges(payload);
    assert.equal(changes.length, 1);
    assert.equal(statusIntent(changes[0]!, mapping.statuses), "schedule");
  });

  it("tirar do Agendado cancela; ir para Publicado ou Erro não", () => {
    const change = (to: string) => ({ taskId: "t1", historyId: "h", from: "agendado", to, at: NOW, userId: null });
    assert.equal(statusIntent(change("em produção"), mapping.statuses), "cancel");
    assert.equal(statusIntent(change("publicado"), mapping.statuses), null);
    assert.equal(statusIntent(change("erro na publicação"), mapping.statuses), null);
  });

  it("ignora o eco da nossa própria escrita", () => {
    const change = { taskId: "t1", historyId: "h", from: "para agendar", to: "agendado", at: NOW, userId: null };
    assert.equal(isOwnEcho(change, [{ taskId: "t1", status: "Agendado", at: new Date(NOW.getTime() - 30_000) }]), true);
    assert.equal(isOwnEcho(change, [{ taskId: "t1", status: "agendado", at: new Date(NOW.getTime() - 600_000) }]), false);
  });
});

describe("ClickUp: Retorno na Tarefa", () => {
  it("diz horário de Brasília e a conta", () => {
    assert.equal(
      feedback.scheduled(new Date("2026-10-15T21:30:00Z"), "alquimiarj", "post"),
      "Automatize: post agendado para 15/10 às 18:30 (Brasília) no @alquimiarj.",
    );
  });
});
