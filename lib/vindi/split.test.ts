import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateVindiSplit } from "./split";

describe("Vindi product split", () => {
  it("pays the expert R$75,61 on a R$100,00 sale at 80% participation", () => {
    const split = calculateVindiSplit({
      priceCentavos: 10_000,
      expertParticipationBps: 8_000,
    });

    assert.equal(split.distributionNetCentavos, 9_451);
    assert.equal(split.expertAmountCentavos, 7_561);
    assert.equal(split.platformTheoreticalAmountCentavos, 1_890);
    assert.equal(split.processingFeeBasisPoints, 549);
  });

  it("gives the expert nothing at 0% and the whole distribution net at 100%", () => {
    const none = calculateVindiSplit({
      priceCentavos: 10_000,
      expertParticipationBps: 0,
    });
    const all = calculateVindiSplit({
      priceCentavos: 10_000,
      expertParticipationBps: 10_000,
    });

    assert.equal(none.expertAmountCentavos, 0);
    assert.equal(none.platformTheoreticalAmountCentavos, 9_451);
    assert.equal(all.expertAmountCentavos, 9_451);
    assert.equal(all.platformTheoreticalAmountCentavos, 0);
  });

  it("rejects a participation outside 0..10000 basis points", () => {
    assert.throws(
      () =>
        calculateVindiSplit({
          priceCentavos: 10_000,
          expertParticipationBps: 10_001,
        }),
      /10000/,
    );
    assert.throws(
      () =>
        calculateVindiSplit({
          priceCentavos: 10_000,
          expertParticipationBps: -1,
        }),
      /10000/,
    );
  });
});
