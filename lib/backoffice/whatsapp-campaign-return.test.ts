import {expect,test} from "bun:test";
import {campaignReturn} from "./whatsapp-campaign-return";
test("uses consistent currency units for revenue and estimated delivery cost",()=>{
  expect(campaignReturn(50000,100,250000)).toEqual({costMicros:25000000,roas:20,balanceMicros:475000000});
  expect(campaignReturn(0,100,250000).roas).toBe(0);
});
test("does not invent ROAS when cost is zero or unavailable",()=>{
  expect(campaignReturn(50000,0,250000).roas).toBeNull();
  expect(campaignReturn(50000,100,0).roas).toBeNull();
});
