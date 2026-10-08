/** Run with bun --conditions=react-server test and WHATSAPP_TEST_DATABASE_URL.
 * The database must be a disposable localhost database named automatize_whatsapp_test.
 * No real Meta calls: the HTTP boundary is replaced; SQL and transactions are real.
 */
import { before, after, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { OCTOBER_WHATSAPP_TEMPLATES } from "../lib/backoffice/whatsapp-october-templates";
import { campaignTemplateDefinition } from "../lib/backoffice/whatsapp-campaign-core";

const databaseUrl = process.env.WHATSAPP_TEST_DATABASE_URL;
describe("WhatsApp campaigns against disposable Postgres", { skip: !databaseUrl }, () => {
  let pg: typeof import("../lib/db").postgresClient;
  let campaigns: typeof import("../lib/backoffice/whatsapp-campaigns");
  let dispatch: typeof import("../lib/backoffice/whatsapp-campaign-dispatch").dispatchWhatsappCampaigns;
  const originalFetch = globalThis.fetch;
  const originalEnvironment = { ...process.env };
  let testSend: typeof import("../lib/backoffice/whatsapp-campaign-test");
  let sends = 0;
  let failAmbiguously = false;
  const body = "Olá {{1}}, conheça nossa plataforma.";
  before(async () => {
    const url = new URL(databaseUrl!);
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.pathname, "/automatize_whatsapp_test");
    process.env.POSTGRES_URL = databaseUrl;
    process.env.META_WHATSAPP_ACCESS_TOKEN = "test-only";
    process.env.META_WHATSAPP_WABA_ID = "123";
    process.env.META_WHATSAPP_PHONE_NUMBER_ID = "456";
    process.env.WHATSAPP_CAMPAIGNS_ENABLED = "true";
    ({ postgresClient: pg } = await import("../lib/db"));
    testSend = await import("../lib/backoffice/whatsapp-campaign-test");
    campaigns = await import("../lib/backoffice/whatsapp-campaigns");
    ({ dispatchWhatsappCampaigns: dispatch } = await import("../lib/backoffice/whatsapp-campaign-dispatch"));
    await pg.unsafe(`
      CREATE TABLE users(id uuid primary key default gen_random_uuid(),name text,email text,phone text,expiration_date timestamp,created_at timestamp default now());
      CREATE TABLE subscriptions(user_id uuid);
      CREATE TABLE credit_transactions(user_id uuid,type text,created_at timestamp default now());
      CREATE TABLE payments(user_id uuid,status text,amount integer,purpose text,paid_at timestamp,currency text default 'brl',refunded_amount integer);
      CREATE TABLE backoffice_users(email text);
      CREATE TABLE crm_leads(user_id uuid,commercial_status text);
      CREATE TABLE conversations(id uuid primary key default gen_random_uuid(),user_id uuid,channel text,phone_e164 text);
      CREATE TABLE conversation_events(conversation_id uuid,type text);
      CREATE TABLE whatsapp_template_deliveries(id uuid primary key default gen_random_uuid(),user_id uuid references users(id),source text,source_delivery_id text,template_name text,language_code text,provider_message_id text unique,current_status text default 'queued',current_status_at timestamp,accepted_at timestamp,delivered_at timestamp,read_at timestamp,failed_at timestamp,deleted_at timestamp,clicked_at timestamp,failure_code text,failure_detail text,historical_status_untracked boolean default false,created_at timestamp default now(),updated_at timestamp default now(),unique(source,source_delivery_id));
      CREATE TABLE whatsapp_template_status_events(id uuid primary key default gen_random_uuid(),delivery_id uuid references whatsapp_template_deliveries(id),event_key text unique,provider_message_id text,provider_status text,provider_status_at timestamp,failure_code text,failure_detail text,created_at timestamp default now());
    `);
    await pg.unsafe(readFileSync(new URL("../lib/db/migrations/0110_whatsapp_campaigns.sql", import.meta.url), "utf8"));
    await pg.unsafe(readFileSync(new URL("../lib/db/migrations/0127_whatsapp_campaign_audience.sql", import.meta.url), "utf8"));
    await pg.unsafe(readFileSync(new URL("../lib/db/migrations/0129_whatsapp_campaign_button_media.sql", import.meta.url), "utf8"));
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const requestUrl = new URL(String(input));
      if (requestUrl.hostname === "whatsappbusiness.com") return requestUrl.pathname.includes('/wp-json/')
        ? Response.json({quote:"0.3000"}) : new Response('{"restNonce":"test-public-nonce"}');
      assert.equal(requestUrl.hostname, "graph.facebook.com");
      if (requestUrl.pathname.endsWith("/message_templates") && requestUrl.searchParams.get("name")===OCTOBER_WHATSAPP_TEMPLATES[0].name) {
        const seed=OCTOBER_WHATSAPP_TEMPLATES[0];
        return Response.json({data:[{id:'tracked-template',...campaignTemplateDefinition({name:seed.name,body:seed.body,button:seed.button,headerMedia:seed.headerMedia}),status:'APPROVED'}]});
      }
      if (requestUrl.pathname.endsWith("/message_templates")) return Response.json({ data: [{ id: "template1", name: "campaign_v1", language: "pt_BR", category: "MARKETING", status: "APPROVED", components: [{ type: "BODY", text: body }] }] });
      assert.ok(requestUrl.pathname.endsWith("/messages"));
      assert.equal(init?.method, "POST");
      const payload=JSON.parse(String(init?.body));
      if(payload.template.name===OCTOBER_WHATSAPP_TEMPLATES[0].name) {
        const button=payload.template.components.find((c:{type:string})=>c.type==='button');
        assert.equal(button.sub_type,'url');
        const [delivery]=await pg`select id from whatsapp_template_deliveries where id=${button.parameters[0].text}`;
        assert.ok(delivery,'button must identify a persisted delivery');
      }
      sends++;
      if (failAmbiguously) throw new TypeError("Simulated lost response");
      const providerId = `wamid.test.${sends}`;
      // A webhook may arrive before the POST response is persisted.
      await pg`insert into whatsapp_template_status_events(event_key,provider_message_id,provider_status,provider_status_at) values (${providerId},${providerId},'delivered',now())`;
      return Response.json({ messages: [{ id: providerId }] });
    }) as typeof fetch;
  });
  beforeEach(async () => {
    await pg`truncate whatsapp_campaign_recipients,whatsapp_campaigns,whatsapp_template_status_events,whatsapp_template_deliveries,conversation_events,conversations,crm_leads,backoffice_users,subscriptions,credit_transactions,payments,users cascade`;
    sends = 0; failAmbiguously = false;
    process.env.WHATSAPP_CAMPAIGNS_ENABLED = "true";
    delete process.env.WHATSAPP_CAMPAIGN_TEST_USER_IDS;
  });
  after(async () => {
    globalThis.fetch = originalFetch;
    for (const key of ["POSTGRES_URL", "META_WHATSAPP_ACCESS_TOKEN", "META_WHATSAPP_WABA_ID", "META_WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_CAMPAIGNS_ENABLED"]) {
      if (originalEnvironment[key] === undefined) delete process.env[key]; else process.env[key] = originalEnvironment[key];
    }
    if (pg) {
      await pg`drop table if exists whatsapp_campaign_recipients,whatsapp_campaigns,whatsapp_template_status_events,whatsapp_template_deliveries,conversation_events,conversations,crm_leads,backoffice_users,subscriptions,credit_transactions,payments,users cascade`;
      await pg.end();
    }
  });
  async function seed() {
    const [user] = await pg`insert into users(name,email,phone) values ('João Teste','test@example.invalid','22997259506') returning id`;
    const id = crypto.randomUUID();
    await campaigns.saveCampaign(id, { title: "Test campaign", templateName: "campaign_v1", body, unitCostMicros: 300_000, budgetMicros: 600_000 }, "test@example.invalid");
    return { id, userId: String(user.id) };
  }
  async function schedule(id: string, userId: string) {
    await campaigns.scheduleCampaign(id, new Date(Date.now() + 60_000), [userId], "test@example.invalid");
    await pg`update whatsapp_campaigns set scheduled_at=now()-interval '1 minute' where id=${id}`;
  }
  it("stores button and media from our storage only, and deletes only drafts without recipients",async()=>{
    const {id,userId}=await seed();
    process.env.MEDIA_PUBLIC_BASE_URL="https://media.example.test";
    const base={title:"Media",templateName:"campaign_v1",body,unitCostMicros:300_000,budgetMicros:600_000};
    await assert.rejects(campaigns.saveCampaign(id,{...base,headerMedia:{type:"video",url:"https://evil.example/x.mp4"}},"admin"));
    const media={type:"video",url:"https://media.example.test/media/whatsapp-campaigns/a.mp4"};
    const button={text:"Entrar no grupo",url:"https://chat.whatsapp.com/abc"};
    const saved=await campaigns.saveCampaign(id,{...base,headerMedia:media,button},"admin");
    assert.deepEqual([saved.header_media,saved.button],[media,button]);
    await campaigns.deleteCampaign(id);
    await assert.rejects(campaigns.getCampaign(id));
    const other=crypto.randomUUID();
    await campaigns.saveCampaign(other,base,"admin");
    await campaigns.scheduleCampaign(other,null,[userId],"admin");
    await assert.rejects(campaigns.deleteCampaign(other));
  });
  it("sends repeatable isolated tests without consuming the campaign or its audience", async()=>{
    const {id,userId}=await seed();
    process.env.WHATSAPP_CAMPAIGN_TEST_USER_IDS=userId;
    await pg`insert into credit_transactions(user_id,type) values (${userId},'trial_grant')`;
    assert.equal((await campaigns.campaignAudience(userId)).length,0);
    const initial=await campaigns.getCampaign(id);
    const request={userId,requestId:crypto.randomUUID()};
    await Promise.all([testSend.sendCampaignTest(id,request,'admin'),testSend.sendCampaignTest(id,request,'admin')]);
    assert.equal(sends,1);
    assert.equal((await testSend.sendCampaignTest(id,request,'admin')).status,'accepted');
    assert.equal((await testSend.sendCampaignTest(id,{userId,requestId:crypto.randomUUID()},'admin')).status,'accepted');
    assert.equal(sends,2);
    assert.deepEqual(await campaigns.getCampaign(id),initial);
    assert.equal((await campaigns.campaignRecipients(id)).length,0);
    assert.equal((await campaigns.campaignMetrics(id,7)).sent,0);
    const deliveries=await pg`select source,current_status from whatsapp_template_deliveries`;
    assert.ok(deliveries.every(row=>row.source==='backoffice_campaign_test'&&row.current_status==='delivered'));
  });
  it("tracks official recipients separately from test sends, counting each clicked delivery once",async()=>{
    const {id,userId}=await seed();
    const template=OCTOBER_WHATSAPP_TEMPLATES[0];
    await pg`update whatsapp_campaigns set template_name=${template.name},body=${template.body},button=${JSON.stringify(template.button)}::jsonb where id=${id}`;
    process.env.WHATSAPP_CAMPAIGN_TEST_USER_IDS=userId;
    await testSend.sendCampaignTest(id,{userId,requestId:crypto.randomUUID()},'admin');
    await pg`update whatsapp_template_deliveries set clicked_at=now() where source='backoffice_campaign_test'`;
    assert.equal((await campaigns.campaignMetrics(id)).tracked_clicks,0);
    await campaigns.scheduleCampaign(id,null,[userId],'admin');
    await dispatch();
    const [official]=await pg`select delivery_id from whatsapp_campaign_recipients where campaign_id=${id}`;
    await pg`update whatsapp_template_deliveries set clicked_at=now() where id=${official.delivery_id}`;
    await pg`update whatsapp_template_deliveries set clicked_at=coalesce(clicked_at,now()) where id=${official.delivery_id}`;
    const metrics=await campaigns.campaignMetrics(id);
    assert.equal(metrics.tracked_clicks,1);
    assert.equal(metrics.sent,1);
    assert.equal(sends,2);
  });
  it("rejects unconfigured test recipients, disabled sending and unapproved text without sending", async()=>{
    const {id,userId}=await seed();
    const request={userId,requestId:crypto.randomUUID()};
    await assert.rejects(testSend.sendCampaignTest(id,request,'admin'),/habilitado para testes/);
    process.env.WHATSAPP_CAMPAIGN_TEST_USER_IDS=userId;
    process.env.WHATSAPP_CAMPAIGNS_ENABLED='false';
    await assert.rejects(testSend.sendCampaignTest(id,request,'admin'),/não está habilitado/);
    process.env.WHATSAPP_CAMPAIGNS_ENABLED='true';
    await pg`update whatsapp_campaigns set body='Alterado' where id=${id}`;
    await assert.rejects(testSend.sendCampaignTest(id,request,'admin'),/template aprovado/);
    assert.equal(sends,0);
  });
  it("does not retry an ambiguous test send and leaves the official campaign untouched", async()=>{
    const {id,userId}=await seed();
    process.env.WHATSAPP_CAMPAIGN_TEST_USER_IDS=userId;
    failAmbiguously=true;
    const request={userId,requestId:crypto.randomUUID()};
    assert.equal((await testSend.sendCampaignTest(id,request,'admin')).status,'unknown');
    assert.equal((await testSend.sendCampaignTest(id,request,'admin')).status,'unknown');
    assert.equal(sends,1);
    assert.equal((await campaigns.getCampaign(id)).state,'draft');
  });
  it("segments paid churn separately from expired trial and rechecks before dispatch", async()=>{
    const {id,userId}=await seed();
    await pg`update users set expiration_date=now()-interval '2 days' where id=${userId}`;
    const filters={statuses:['churn'],excludeContacted:false};
    const saved=await campaigns.saveCampaignAudience(id,filters,'test@example.invalid');
    assert.equal((await campaigns.campaignAudience(undefined,saved.audience_filters)).length,0);
    await pg`insert into payments(user_id,status,amount,purpose,paid_at) values (${userId},'succeeded',100,'subscription',now()-interval '30 days')`;
    assert.equal((await campaigns.campaignAudience(undefined,saved.audience_filters)).length,1);
    await schedule(id,userId);
    await pg`update users set expiration_date=now()+interval '30 days' where id=${userId}`;
    await dispatch();assert.equal(sends,0);
    assert.equal((await pg`select state from whatsapp_campaign_recipients where campaign_id=${id}`)[0].state,'skipped');
  });
  it("combines inclusive creation dates with explicit contact-history exclusion",async()=>{
    const {userId}=await seed();
    await pg`update users set created_at='2026-10-06 14:00:00' where id=${userId}`;
    const saved=await campaigns.saveCampaignAudience((await campaigns.listCampaigns())[0].id,{createdFrom:'2026-10-06',createdTo:'2026-10-06'},'test@example.invalid');
    assert.equal((await campaigns.campaignAudience(undefined,saved.audience_filters)).length,1);
    assert.equal((await campaigns.campaignAudience(undefined,{...saved.audience_filters,createdFrom:'2026-10-07',createdTo:'2026-10-07'})).length,0);
    await pg`insert into crm_leads values(${userId},'em_atendimento')`;
    assert.equal((await campaigns.campaignAudience(undefined,saved.audience_filters)).length,0);
    assert.equal((await campaigns.campaignAudience(undefined,{...saved.audience_filters,excludeContacted:false})).length,1);
  });
  it("counts unique trials and positive subscription payments only after delivery within the chosen window",async()=>{
    const {id,userId}=await seed();await schedule(id,userId);await dispatch();
    await pg`update whatsapp_template_deliveries set delivered_at=now()-interval '10 days',read_at=now()-interval '9 days'`;
    await pg`insert into credit_transactions values (${userId},'trial_grant',now()-interval '8 days'),(${userId},'trial_grant',now()-interval '8 days')`;
    await pg`insert into payments(user_id,status,amount,purpose,paid_at) values (${userId},'succeeded',100,'subscription',now()),(${userId},'succeeded',100,'subscription',now()),(${userId},'succeeded',100,'credit_purchase',now()-interval '9 days')`;
    const week=await campaigns.campaignMetrics(id,7);assert.equal(week.trials,1);assert.equal(week.paying,0);assert.equal(week.read,1);
    const fortnight=await campaigns.campaignMetrics(id,14);assert.equal(fortnight.paying,1);assert.equal(fortnight.trials,1);
  });
  it("sums eligible BRL revenue once, subtracts refunds and respects the delivery window",async()=>{
    const {id,userId}=await seed();await schedule(id,userId);await dispatch();
    await pg`update whatsapp_template_deliveries set delivered_at=now()-interval '10 days'`;
    await pg`insert into payments(user_id,status,amount,purpose,paid_at,currency,refunded_amount) values
      (${userId},'succeeded',49700,'subscription',now()-interval '9 days','brl',0),
      (${userId},'succeeded',29700,'legacy_renewal',now()-interval '8 days','brl',9700),
      (${userId},'refunded',49700,'subscription',now()-interval '8 days','brl',null),
      (${userId},'succeeded',99900,'credit_purchase',now()-interval '8 days','brl',0),
      (${userId},'succeeded',99900,'subscription',now()-interval '8 days','usd',0),
      (${userId},'pending',99900,'subscription',now()-interval '8 days','brl',0),
      (${userId},'succeeded',99900,'subscription',now()-interval '11 days','brl',0),
      (${userId},'succeeded',10000,'subscription',now(),'brl',0)`;
    assert.equal((await campaigns.campaignMetrics(id,7)).revenue_centavos,69700);
    const draft=await seed();
    const listed=await campaigns.listCampaigns();
    assert.equal(listed.find(c=>c.id===id)?.revenue_centavos,69700);
    assert.equal(listed.find(c=>c.id===draft.id)?.revenue_centavos,0);
    assert.equal((await campaigns.campaignMetrics(id,14)).revenue_centavos,79700);
    await pg`update whatsapp_template_deliveries set delivered_at=null,read_at=null`;
    assert.equal((await campaigns.campaignMetrics(id,14)).revenue_centavos,0);
  });
  it("deduplicates phones and excludes trials, subscriptions, CRM contacts, internal users and inbound conversations", async () => {
    const { userId } = await seed();
    await pg`insert into users(email,phone) values ('duplicate@example.invalid','+55 22 99725-9506')`;
    assert.equal((await campaigns.campaignAudience()).length, 1);
    await pg`insert into credit_transactions(user_id,type) values (${userId},'trial_grant')`;
    // Exclusions follow the phone even when another account has no history.
    assert.equal((await campaigns.campaignAudience()).length, 0);
    await pg`delete from credit_transactions`;
    await pg`insert into subscriptions values (${userId})`;
    assert.equal((await campaigns.campaignAudience()).length, 0);
    await pg`delete from subscriptions`;
    await pg`insert into crm_leads values (${userId},'em_atendimento')`;
    assert.equal((await campaigns.campaignAudience()).length, 0);
    await pg`delete from crm_leads`;
    await pg`insert into backoffice_users values ('test@example.invalid')`;
    assert.equal((await campaigns.campaignAudience()).length, 0);
    await pg`delete from backoffice_users`;
    const [conversation] = await pg`insert into conversations(channel,phone_e164) values ('whatsapp','+5522997259506') returning id`;
    await pg`insert into conversation_events values (${conversation.id},'message.received')`;
    assert.equal((await campaigns.campaignAudience()).length, 0);
  });
  it("excludes a phone with inbound history stored without the ninth digit", async()=>{
    const {userId}=await seed();
    const [conversation]=await pg`insert into conversations(channel,phone_e164) values ('whatsapp','+552297259506') returning id`;
    await pg`insert into conversation_events values (${conversation.id},'message.received')`;
    assert.equal((await campaigns.campaignAudience(userId)).length,0);
  });
  it("allows only the explicit QA account while preserving status filters and excluding its duplicates",async()=>{
    const {id,userId}=await seed();
    await pg`insert into backoffice_users values ('test@example.invalid')`;
    const [peer]=await pg`insert into users(email,phone,expiration_date) values ('qa-other@example.invalid','+5522997259506',now()-interval '1 day') returning id`;
    assert.equal((await campaigns.campaignAudience(userId)).length,0);
    process.env.WHATSAPP_CAMPAIGN_TEST_USER_IDS=userId;
    assert.equal((await campaigns.campaignAudience(userId)).length,1);
    assert.equal((await campaigns.campaignAudience(peer.id)).length,0);
    await schedule(id,userId);
    await dispatch();assert.equal(sends,1);
    await pg`insert into credit_transactions(user_id,type) values (${userId},'trial_grant')`;
    assert.equal((await campaigns.campaignAudience(userId)).length,0);
    delete process.env.WHATSAPP_CAMPAIGN_TEST_USER_IDS;
  });
  it("does not let five interrupted campaigns starve a later campaign", async () => {
    const { id, userId } = await seed();
    await schedule(id, userId);
    const blocked = [id];
    for (let i = 0; i < 5; i++) {
      const next = crypto.randomUUID();
      await campaigns.saveCampaign(next, { title: "Next", templateName: "campaign_v1", body, unitCostMicros: 300_000, budgetMicros: 600_000 }, "test@example.invalid");
      await schedule(next, userId);
      if (i < 4) blocked.push(next);
    }
    await pg`update whatsapp_campaign_recipients set state='sending',updated_at=now()-interval '11 minutes' where campaign_id in ${pg(blocked)}`;
    await dispatch();
    assert.equal(sends, 1);
    for (const campaignId of blocked) assert.equal((await campaigns.getCampaign(campaignId)).state, 'paused');
    await dispatch();
    assert.equal(sends, 1);
  });
  it("rechecks a duplicate account subscription before dispatch", async () => {
    const { id, userId } = await seed();
    await schedule(id, userId);
    const [duplicate] = await pg`insert into users(email,phone) values ('subscribed@example.invalid','+55 22 99725-9506') returning id`;
    await pg`insert into subscriptions values (${duplicate.id})`;
    await dispatch();
    assert.equal(sends, 0);
    assert.equal((await campaigns.campaignRecipients(id))[0].state, 'skipped');
  });
  it("serializes simultaneous scheduling and cron runs without duplicate sends, reconciling early webhooks", async () => {
    const { id, userId } = await seed();
    const results = await Promise.allSettled([schedule(id, userId), schedule(id, userId)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    await Promise.all([dispatch(), dispatch()]);
    assert.equal(sends, 1);
    const [delivery] = await pg`select current_status,delivered_at from whatsapp_template_deliveries`;
    assert.equal(delivery.current_status, "delivered");
    assert.ok(delivery.delivered_at);
    assert.equal((await campaigns.getCampaign(id)).state, "completed");
  });
  it("recovers a persisted Meta message ID without sending again",async()=>{
    const {id,userId}=await seed();await schedule(id,userId);await dispatch();
    await pg`update whatsapp_campaign_recipients set state='unknown' where campaign_id=${id}`;
    await pg`update whatsapp_campaigns set state='paused' where id=${id}`;
    await dispatch();
    assert.equal(sends,1);
    assert.equal((await campaigns.campaignRecipients(id))[0].state,'sent');
    assert.equal((await campaigns.getCampaign(id)).state,'paused');
  });
  it("never retries an ambiguous send and pauses the campaign", async () => {
    const { id, userId } = await seed(); await schedule(id, userId);
    failAmbiguously = true;
    await dispatch(); await dispatch();
    assert.equal(sends, 1);
    assert.equal((await campaigns.campaignRecipients(id))[0].state, "unknown");
    assert.equal((await campaigns.getCampaign(id)).state, "paused");
  });
  it("rechecks eligibility at dispatch and honors the environment kill switch", async () => {
    const { id, userId } = await seed(); await schedule(id, userId);
    process.env.WHATSAPP_CAMPAIGNS_ENABLED = "false";
    await dispatch(); assert.equal(sends, 0);
    process.env.WHATSAPP_CAMPAIGNS_ENABLED = "true";
    await pg`insert into subscriptions values (${userId})`;
    await dispatch(); assert.equal(sends, 0);
    assert.equal((await campaigns.campaignRecipients(id))[0].state, "skipped");
  });
  it("honors pause and recipient removal", async () => {
    const { id, userId } = await seed(); await schedule(id, userId);
    await campaigns.setCampaignPaused(id, true, "test@example.invalid");
    await dispatch(); assert.equal(sends, 0);
    const [recipient] = await campaigns.campaignRecipients(id);
    await campaigns.excludeCampaignRecipient(id, String(recipient.id), "test@example.invalid");
    await campaigns.setCampaignPaused(id, false, "test@example.invalid");
    await dispatch(); assert.equal(sends, 0);
    assert.equal((await campaigns.getCampaign(id)).state, "completed");
  });
  it("keeps approved drafts idle until an explicit manual release and never repeats a manual release", async () => {
    const { id, userId } = await seed();
    await dispatch(); assert.equal(sends, 0);
    assert.equal((await campaigns.getCampaign(id)).state, "draft");
    await campaigns.scheduleCampaign(id, null, [userId], "test@example.invalid");
    assert.equal((await campaigns.getCampaign(id)).dispatch_mode, "manual");
    await assert.rejects(campaigns.scheduleCampaign(id, null, [userId], "test@example.invalid"));
    await dispatch(); await dispatch();
    assert.equal(sends, 1);
  });
  it("rejects a stale saved tariff before scheduling", async () => {
    const { id, userId } = await seed();
    await pg`update whatsapp_campaigns set unit_cost_micros=1 where id=${id}`;
    await assert.rejects(campaigns.scheduleCampaign(id, null, [userId], "test@example.invalid"), /tarifa da Meta mudou/);
    assert.equal((await campaigns.getCampaign(id)).state, 'draft');
    assert.equal((await campaigns.campaignRecipients(id)).length, 0);
  });
  it("holds an automatic campaign until its chosen time", async () => {
    const { id, userId } = await seed();
    await campaigns.scheduleCampaign(id, new Date(Date.now() + 3_600_000), [userId], "test@example.invalid");
    assert.equal((await campaigns.getCampaign(id)).dispatch_mode, "scheduled");
    await dispatch(); assert.equal(sends, 0);
    await pg`update whatsapp_campaigns set scheduled_at=now()-interval '1 minute' where id=${id}`;
    await dispatch(); assert.equal(sends, 1);
  });
});
