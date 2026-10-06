import { it } from 'node:test';
import assert from 'node:assert/strict';
import { audienceFiltersSchema, templateRejectionReason, readRate } from './whatsapp-campaign-audience';
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
