import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CAMPAIGN_CONTACT_BUTTON, CAMPAIGN_TRACKED_LINK_URL, trackedLinkButton, campaignSendComponents, campaignTemplateDefinition, campaignTemplateMatches, campaignTracksClicks, assertSchedule, campaignInput, campaignPhone, campaignMetaLookupLabel, canConfirmCampaignSend } from "./whatsapp-campaign-core";
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

describe('template shape',()=>{
  const contact=OCTOBER_WHATSAPP_TEMPLATES[0];
  const spec={name:contact.name,body:contact.body,button:contact.button,headerMedia:contact.headerMedia};
  it('registers the tracked contact button with an example ID and matches only the same shape',()=>{
    const definition=campaignTemplateDefinition(spec);
    assert.ok(!contact.body.includes('https://'));
    assert.deepEqual(definition.components.find(c=>c.type==='BUTTONS'),{type:'BUTTONS',buttons:[{type:'URL',text:'Falar com a equipe',url:CAMPAIGN_CONTACT_BUTTON.url,example:[CAMPAIGN_CONTACT_BUTTON.url.replace('{{1}}','00000000-0000-4000-8000-000000000001')]}]});
    assert.equal(campaignTemplateMatches(definition,spec),true);
    assert.equal(campaignTemplateMatches({components:[{type:'BODY',text:spec.body}]},spec),false);
    assert.equal(campaignTemplateMatches(definition,{...spec,button:trackedLinkButton(spec.button!.text,'https://example.com')}),false);
    assert.equal(campaignTemplateMatches(definition,{...spec,body:spec.body+' mudou'}),false);
  });
  it('keeps legacy text-only and static-button campaigns compatible',()=>{
    const textOnly={...spec,name:'outubro_2026_0810_assinatura_v1',button:null};
    assert.equal(campaignTemplateDefinition(textOnly).components.length,1);
    assert.equal(campaignTemplateMatches(campaignTemplateDefinition(textOnly),textOnly),true);
    const legacy={...spec,button:{text:'Falar com a equipe',url:'https://www.automatizemarketing.com/contato'}};
    assert.equal(campaignTracksClicks(legacy.button),false);
    assert.equal(campaignSendComponents(legacy,'Ana').length,1);
  });
  it('requires an uploaded example for media headers and the same header format to match',()=>{
    const video={...spec,button:null,headerMedia:{type:'video' as const,url:'https://media.example.com/media/whatsapp-campaigns/a.mp4'}};
    assert.throws(()=>campaignTemplateDefinition(video));
    const definition=campaignTemplateDefinition(video,'4:handle');
    assert.deepEqual(definition.components[0],{type:'HEADER',format:'VIDEO',example:{header_handle:['4:handle']}});
    assert.equal(campaignTemplateMatches(definition,video),true);
    assert.equal(campaignTemplateMatches(definition,{...video,headerMedia:{...video.headerMedia,type:'image'}}),false);
    assert.equal(campaignTemplateMatches(definition,{...video,headerMedia:null}),false);
    assert.equal(campaignTemplateMatches(campaignTemplateDefinition({...video,headerMedia:null}),video),false);
  });
});

describe('send components',()=>{
  const seed=OCTOBER_WHATSAPP_TEMPLATES[0];
  const spec={name:seed.name,body:seed.body,button:seed.button,headerMedia:seed.headerMedia};
  const token='00000000-0000-4000-8000-000000000001';
  it('sends the unique delivery ID in the tracked button and rejects missing IDs',()=>{
    assert.deepEqual(campaignSendComponents(spec,'Ana',token),[
      {type:'body',parameters:[{type:'text',text:'Ana'}]},
      {type:'button',sub_type:'url',index:'0',parameters:[{type:'text',text:token}]},
    ]);
    assert.throws(()=>campaignSendComponents(spec,'Ana'));
    assert.throws(()=>campaignSendComponents(spec,'Ana','not-a-token'));
  });
  it('sends the header media by link and the delivery ID for a tracked link button',()=>{
    const media={...spec,body:'Oi',button:trackedLinkButton('Entrar no grupo','https://chat.whatsapp.com/abc'),headerMedia:{type:'image' as const,url:'https://media.example.com/media/x.jpg'}};
    assert.deepEqual(campaignSendComponents(media,'Ana',token),[
      {type:'header',parameters:[{type:'image',image:{link:'https://media.example.com/media/x.jpg'}}]},
      {type:'button',sub_type:'url',index:'0',parameters:[{type:'text',text:token}]},
    ]);
    assert.throws(()=>campaignSendComponents(media,'Ana'));
  });
  it('registers the tracked link without exposing its destination to Meta',()=>{
    const button=trackedLinkButton('Entrar no grupo','https://chat.whatsapp.com/abc');
    const definition=campaignTemplateDefinition({...spec,button});
    const buttons=definition.components.find(c=>c.type==='BUTTONS');
    assert.deepEqual(buttons,{type:'BUTTONS',buttons:[{type:'URL',text:'Entrar no grupo',url:CAMPAIGN_TRACKED_LINK_URL,example:[CAMPAIGN_TRACKED_LINK_URL.replace('{{1}}','00000000-0000-4000-8000-000000000001')]}]});
    assert.ok(!JSON.stringify(definition).includes('chat.whatsapp.com'));
    assert.equal(campaignTemplateMatches(definition,{...spec,button:trackedLinkButton('Entrar no grupo','https://chat.whatsapp.com/outro')}),true);
  });
});

describe('campaign button input',()=>{
  const input={title:'Teste',templateName:'teste_v1',body:'Olá',unitCostMicros:0,budgetMicros:0};
  it('accepts only tracked buttons: the contact button or a tracked link with an https destination',()=>{
    assert.equal(campaignInput.safeParse({...input,button:trackedLinkButton('Entrar no grupo','https://chat.whatsapp.com/abc')}).success,true);
    assert.equal(campaignInput.safeParse({...input,button:CAMPAIGN_CONTACT_BUTTON}).success,true);
    for(const button of [{text:'Entrar',url:'https://chat.whatsapp.com/abc'},{text:'x',url:CAMPAIGN_TRACKED_LINK_URL},trackedLinkButton('x','http://a.com'),trackedLinkButton('x','https://a.com/{{1}}'),trackedLinkButton('a'.repeat(26),'https://a.com'),trackedLinkButton('','https://a.com'),{...CAMPAIGN_CONTACT_BUTTON,destination:'https://a.com'}])
      assert.equal(campaignInput.safeParse({...input,button}).success,false,JSON.stringify(button));
  });
  it('rejects links in the message text, with or without protocol',()=>{
    for(const body of ['Entre: https://chat.whatsapp.com/abc','Veja www.site.com','http://x.com','Entre em chat.whatsapp.com/CtuGgvKtOAs3sEMdHBm6sS','Acesse automatizemarketing.com','Visite loja.com.br/promo','Escreva para contato@automatize.com','Veja youtu.be/abc123','Acesse empresa.ai','Link: bit.ly/x','Site: automatize.marketing'])
      assert.equal(campaignInput.safeParse({...input,body}).success,false,body);
  });
  it('accepts ordinary text without false positives',()=>{
    for(const body of ['Olá {{1}}, tudo bem? O plano custa R$ 1.000,00.','Sr. João, abra o app. Depois toque no botão.','Fale no WhatsApp com a equipe da Automatize. 💜','Ex.: anúncio, público e orçamento.','Até às 15h. Garanta já!','Versão 2.0 com 7 dias grátis.','Comece hoje… Simples assim.',...OCTOBER_WHATSAPP_TEMPLATES.map(t=>t.body)])
      assert.equal(campaignInput.safeParse({...input,body}).success,true,body);
  });
});
