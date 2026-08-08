import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clampCropOffset,
  getCoverScale,
  getCropSourceRect,
} from "./image-crop";

describe("image crop", () => {
  it("scales a landscape image until it covers a square frame", () => {
    assert.equal(getCoverScale({ width: 1200, height: 800 }, 320), 0.4);
  });

  it("scales an image until it covers a 16:9 frame", () => {
    assert.equal(
      getCoverScale({ width: 1200, height: 800 }, { width: 320, height: 180 }),
      320 / 1200,
    );
  });

  it("clamps movement so the crop never exposes an empty area", () => {
    assert.deepEqual(
      clampCropOffset(
        { x: 999, y: -999 },
        { width: 1200, height: 800 },
        320,
        1,
      ),
      { x: 80, y: 0 },
    );
  });

  it("converts the visible square frame back to source image coordinates", () => {
    assert.deepEqual(
      getCropSourceRect(
        { width: 1200, height: 800 },
        320,
        1,
        { x: 0, y: 0 },
      ),
      { x: 200, y: 0, width: 800, height: 800 },
    );

    assert.deepEqual(
      getCropSourceRect(
        { width: 1200, height: 800 },
        320,
        1,
        { x: 80, y: 0 },
      ),
      { x: 0, y: 0, width: 800, height: 800 },
    );
  });

  it("converts the visible 16:9 frame back to source image coordinates", () => {
    assert.deepEqual(
      getCropSourceRect(
        { width: 1600, height: 900 },
        { width: 320, height: 180 },
        1,
        { x: 0, y: 0 },
      ),
      { x: 0, y: 0, width: 1600, height: 900 },
    );
  });
});
