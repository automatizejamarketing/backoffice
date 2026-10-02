import assert from "node:assert/strict";
import { mock } from "bun:test";
import { ensureMetaTestEnv, installMetaFetchStub } from "./meta-fetch-stub";
process.env.POSTGRES_URL = "postgres://test:test@127.0.0.1:1/test";
process.env.REDIS_URL = "";
ensureMetaTestEnv();
const userId="00000000-0000-4000-8000-000000000100";
mock.module("@/lib/auth/rbac",()=>({requireMarketingUserAccessResponse:async()=>({ok:true,actor:{id:"admin",email:"admin@example.test",role:"owner"}})}));
mock.module("@/lib/meta-business/get-user-access-token",()=>({getUserAccessTokenByUserId:async()=>({success:true,userId,accessToken:"test-denied-adset-token",connection:{tokenKind:"user",clientBusinessId:null,bisuAppScopedId:null,name:"Cliente"}})}));
const stub=installMetaFetchStub(request=>{
 assert.equal(request.method,"GET","No mutation may precede the ad-account authorization");
 if(request.path==="me")return{body:{id:"client"}};
 if(request.path==="me/adaccounts")return{body:{data:[{id:"act_111",account_id:"111"}]}};
 return{body:{data:[]}};
});
try {
 const {POST}=await import("../../app/api/meta-marketing/[accountId]/adsets/route");
 const response=await POST(new Request("http://localhost/api/meta-marketing/222/adsets",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({userId,campaignId:"campaign",campaignObjective:"OUTCOME_TRAFFIC",adsetName:"Adset",targeting:{}})}) as never,{params:Promise.resolve({accountId:"222"})});
 assert.equal(response.status,403);
 assert.equal((await response.json()).error,"account_not_assigned");
 assert.ok(!stub.calls.some(call=>call.path.includes("promote_pages")||call.path.includes("instagram")),"Identity discovery must not run for another client's account");
}finally{stub.restore();}
