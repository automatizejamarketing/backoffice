import { afterEach, describe, expect, test } from "bun:test";
import { requireMetaAccount } from "./require-meta-account";
import { ensureMetaTestEnv, installMetaFetchStub } from "@/tests/helpers/meta-fetch-stub";
import { resetMetaReadCacheForTests } from "@/lib/meta-business/read-cache";
import type { SafeMetaConnection } from "@/lib/meta-business/connection-record";
ensureMetaTestEnv();
const connection = {tokenKind:"user",name:"Cliente",bisuAppScopedId:null,clientBusinessId:null} as SafeMetaConnection;
describe("target user ad account grants",()=>{
 test("allows a positive live grant",async()=>{
  resetMetaReadCacheForTests();
  const stub=installMetaFetchStub(request=>({body:request.path==="me"?{id:"user"}:request.path==="me/adaccounts"?{data:[{id:"act_111",account_id:"111"}]}:{data:[]}}));
  try {expect(await requireMetaAccount("account-check-allowed",connection,"act_111")).toBeNull();}finally{stub.restore();}
 });
 test("denies another user's account before identity discovery",async()=>{
  resetMetaReadCacheForTests();
  const stub=installMetaFetchStub(request=>({body:request.path==="me"?{id:"user"}:request.path==="me/adaccounts"?{data:[{id:"act_111",account_id:"111"}]}:{data:[]}}));
  try {expect((await requireMetaAccount("account-check-denied",connection,"222"))?.status).toBe(403);expect(stub.calls.some(call=>call.path.includes("instagram")||call.path.includes("promote_pages"))).toBe(false);}finally{stub.restore();}
 });
});
