import { describe, expect, test } from "bun:test";
import { parseSelectionProposal } from "./meta-asset-mutation-plan";
const identities = [{identityId:"page:ig1",pageId:"page",instagramBusinessAccountId:"ig1",adAccountIds:["111"]},{identityId:"page:ig2",pageId:"page",instagramBusinessAccountId:"ig2",adAccountIds:["222"]}];
const body = (identity: object) => ({adAccounts:[{id:"111",isPrimary:true}],identities:[{pageId:"page",isPrimary:true,...identity}]});
describe("admin pair selection",()=>{
 test("explicit pair keeps the real Page and key",()=>expect(parseSelectionProposal(body({identityId:"page:ig1",instagramBusinessAccountId:"ig1"}),identities)?.identities.chosenIds).toEqual(["page:ig1"]));
 test("mismatched pair fields fail",()=>expect(parseSelectionProposal(body({identityId:"page:ig1",instagramBusinessAccountId:"ig2"}),identities)).toBeNull());
 test("a pair from another selected account fails",()=>expect(parseSelectionProposal(body({identityId:"page:ig2",instagramBusinessAccountId:"ig2"}),identities)).toBeNull());
 test("Page only uses the sole pair granted in the chosen account",()=>expect(parseSelectionProposal(body({}),identities)?.identities.chosenIds).toEqual(["page:ig1"]));
 test("Page only remains ambiguous with multiple same-account Instagrams",()=>expect(parseSelectionProposal(body({}),identities.map(identity=>({...identity,adAccountIds:["111"]})))).toBeNull());
});

test("malformed optional identity fields are rejected",()=>{
 expect(parseSelectionProposal(body({identityId:42}))).toBeNull();
 expect(parseSelectionProposal(body({instagramBusinessAccountId:{}}))).toBeNull();
});
