/** Revenue is observed after delivery; these are messaging-cost estimates, not profit. */
export function campaignReturn(revenueCentavos:number, delivered:number, unitCostMicros:number) {
  const costMicros=delivered*unitCostMicros;
  const revenueMicros=revenueCentavos*10_000;
  return {costMicros,roas:costMicros>0?revenueMicros/costMicros:null,balanceMicros:revenueMicros-costMicros};
}
