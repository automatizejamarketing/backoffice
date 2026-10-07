import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { campaignTemplateDefinition, campaignTemplateMatches, assertSchedule, campaignInput, campaignPhone, campaignMetaLookupLabel, canConfirmCampaignSend } from "./whatsapp-campaign-core";
import { OCTOBER_WHATSAPP_TEMPLATES } from "./whatsapp-october-templates";

describe("WhatsApp campaign validation", () => {
  const valid = { scheduledAt: new Date("2026-10-08T15:00:00Z"), now: new Date("2026-10-05T15:00:00Z"), count: 664, unitCostMicros: 300_000, budgetMicros: 199_200_000, templateStatus: "APPROVED", templateBody: "Olá", body: "Olá" };
  it("enforces budget at the boundary and requires an approved unchanged body", () => {
    assert.doesNotThrow(() => assertSchedule(valid));
    assert.throws(() => assertSchedule({ ...valid, budgetMicros: valid.budgetMicros - 1 }));
    assert.throws(() => assertSchedule({ ...valid, unitCostMicros: 0 }));
    assert.throws(() => assertSchedule({ ...valid, templateStatus: "PENDING" }));
    assert.throws(() => assertSchedule({ ...valid, body: "Alterado" }));
    assert.throws(() => assertSchedule({ ...valid, count: 0 }));
    assert.throws(() => assertSchedule({ ...valid, scheduledAt: valid.now }));
  });
  it("canonicalizes phones before deduplication and rejects malformed numbers", () => {
    assert.equal(campaignPhone("(22) 99725-9506"), campaignPhone("+55 22 99725-9506"));
    for (const phone of [null, "123", "00123456789", "+1 212 555 1234"]) assert.equal(campaignPhone(phone), null);
  });
  it("rejects unresolved placeholders and unsupported variables", () => {
    const input = { title: "Teste", templateName: "teste_v1", body: "Olá {{1}}", unitCostMicros: 0, budgetMicros: 0 };
    assert.equal(campaignInput.safeParse(input).success, true);
    for (const body of ["Olá [LINK_TRIAL]", "Olá {{2}}", "[NOME]", "a".repeat(1025)]) assert.equal(campaignInput.safeParse({ ...input, body }).success, false);
    for (const seed of OCTOBER_WHATSAPP_TEMPLATES) assert.equal(campaignInput.safeParse({ ...input, title: seed.title, templateName: seed.name, body: seed.body }).success, true);
  });
});


describe("campaign connection and release status", () => {
  it("distinguishes an unqueried template from one not found", () => {
    assert.equal(campaignMetaLookupLabel('disconnected'), 'Conexão pendente');
    assert.equal(campaignMetaLookupLabel('missing'), 'Template não encontrado');
    assert.equal(campaignMetaLookupLabel('unavailable'), 'Consulta indisponível');
  });
  it("allows confirmation only with approval and enabled dispatch", () => {
    assert.equal(canConfirmCampaignSend(true, 'APPROVED'),true);
    for (const status of [undefined,'PENDING','REJECTED']) assert.equal(canConfirmCampaignSend(true,status),false);
    assert.equal(canConfirmCampaignSend(false,'APPROVED'),false);
  });
});

describe('contact button template',()=>{
  it('preserves the old approved button while new templates use direct contact',()=>{
    const seed=OCTOBER_WHATSAPP_TEMPLATES[0];
    assert.equal(seed.button.url,'https://www.automatizemarketing.com/contato-direto/{{1}}');
    const old=campaignTemplateDefinition('outubro_2026_0510_atendimento_v2',seed.body);
    assert.deepEqual(old.components.find(c=>c.type==='BUTTONS'),{type:'BUTTONS',buttons:[{type:'URL',text:'Falar com a equipe',url:'https://www.automatizemarketing.com/contato'}]});
  });
  it('registers the contact URL as a static button without exposing it in the body',()=>{
    const seed=OCTOBER_WHATSAPP_TEMPLATES[0];
    const definition=campaignTemplateDefinition(seed.name,seed.body);
    assert.ok(!seed.body.includes('https://'));
    assert.deepEqual(definition.components.find(c=>c.type==='BUTTONS'),{type:'BUTTONS',buttons:[{type:'URL',text:'Falar com a equipe',url:seed.button.url,example:[seed.button.url.replace('{{1}}','00000000-0000-4000-8000-000000000001')]}]});
    assert.equal(campaignTemplateMatches(definition,seed.name,seed.body),true);
    assert.equal(campaignTemplateMatches({components:[{type:'BODY',text:seed.body}]},seed.name,seed.body),false);
    assert.equal(campaignTemplateMatches({components:[{type:'BODY',text:seed.body},{type:'BUTTONS',buttons:[{type:'URL',text:seed.button.text,url:'https://example.com'}]}]},seed.name,seed.body),false);
    assert.equal(campaignTemplateMatches(definition,seed.name,seed.body+' mudou'),false);
  });
  it('keeps existing text-only templates compatible',()=>{
    const seed=OCTOBER_WHATSAPP_TEMPLATES[1];
    const legacy='outubro_2026_0810_assinatura_v1';
    const definition=campaignTemplateDefinition(legacy,seed.body);
    assert.equal(definition.components.length,1);
    assert.equal(campaignTemplateMatches(definition,legacy,seed.body),true);
  });
});

import { campaignSendComponents } from './whatsapp-campaign-core';
it('sends the unique delivery ID in the dynamic button and rejects missing IDs',()=>{
 const seed=OCTOBER_WHATSAPP_TEMPLATES[0];
 const token='00000000-0000-4000-8000-000000000001';
 assert.deepEqual(campaignSendComponents(seed.name,seed.body,'Ana',token),[
  {type:'body',parameters:[{type:'text',text:'Ana'}]},
  {type:'button',sub_type:'url',index:'0',parameters:[{type:'text',text:token}]}
 ]);
 assert.throws(()=>campaignSendComponents(seed.name,seed.body,'Ana'));
 assert.throws(()=>campaignSendComponents(seed.name,seed.body,'Ana','not-a-token'));
 assert.equal(campaignSendComponents('outubro_2026_0510_atendimento_v3',seed.body,'Ana').length,1);
});
