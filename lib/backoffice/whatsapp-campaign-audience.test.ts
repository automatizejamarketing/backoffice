import { it } from 'node:test';
import assert from 'node:assert/strict';
import { audienceFiltersSchema, templateRejectionReason, readRate, audienceDateCondition, audienceDateBounds } from './whatsapp-campaign-audience';
it('only presents a meaningful rejection for a rejected template',()=>{
  for(const status of ['APPROVED','PENDING',undefined])assert.equal(templateRejectionReason(status,'Some reason'),null);
  for(const reason of ['NONE',' none ','NULL','N/A','',undefined])assert.equal(templateRejectionReason('REJECTED',reason),null);
  assert.equal(templateRejectionReason('REJECTED','INVALID_FORMAT'),'INVALID_FORMAT');
});
it('validates audience intervals and prevents an empty or unsupported cohort',()=>{
  for(const value of [{statuses:[]},{statuses:['made_up']},{createdFrom:'2026-10-05',createdTo:'2026-10-01'},{expiresFrom:'invalid'}])assert.equal(audienceFiltersSchema.safeParse(value).success,false);
  assert.deepEqual(audienceFiltersSchema.parse({statuses:['churn']}).statuses,['churn']);
});
it('does not invent read rates when no deliveries are confirmed',()=>{
  assert.equal(readRate(0,0),null);assert.equal(readRate(1,4),25);
});
it('round-trips saved inclusive date bounds through the date filter operators',()=>{
  assert.equal(audienceDateCondition('',''),undefined);
  assert.deepEqual(audienceDateBounds(undefined),{from:'',to:''});
  assert.deepEqual(audienceDateCondition('2026-10-01','2026-10-05'),{op:'between',from:'2026-10-01',to:'2026-10-05'});
  assert.deepEqual(audienceDateCondition('2026-10-01','2026-10-01'),{op:'on',date:'2026-10-01'});
  assert.deepEqual(audienceDateCondition('2026-10-01',''),{op:'after',date:'2026-09-30'});
  assert.deepEqual(audienceDateCondition('','2026-10-31'),{op:'before',date:'2026-11-01'});
  for(const [from,to] of [['2026-10-01','2026-10-05'],['2026-10-01','2026-10-01'],['2026-03-01',''],['','2026-12-31']])assert.deepEqual(audienceDateBounds(audienceDateCondition(from,to)),{from,to});
  assert.deepEqual(audienceDateBounds({op:'before',date:'2026-10-10'}),{from:'',to:'2026-10-09'});
});
