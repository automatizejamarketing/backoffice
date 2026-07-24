import { describe, expect, test } from "bun:test";
import {
  buildAdSetConversionDetails,
  collectDestinationUrlsFromAds,
  extractPixelIdFromPromotedObject,
} from "./adset-conversion-details";
import type { GraphApiAd, GraphApiAdSet } from "@/lib/meta-business/types";

describe("extractPixelIdFromPromotedObject", () => {
  test("reads pixel_id string", () => {
    expect(
      extractPixelIdFromPromotedObject({ pixel_id: "123456789" }),
    ).toBe("123456789");
  });

  test("returns undefined when missing", () => {
    expect(extractPixelIdFromPromotedObject({})).toBeUndefined();
    expect(extractPixelIdFromPromotedObject(undefined)).toBeUndefined();
  });
});

describe("collectDestinationUrlsFromAds", () => {
  test("dedupes urls from creatives", () => {
    const ads: GraphApiAd[] = [
      {
        id: "1",
        creative: {
          id: "c1",
          object_story_spec: { link_data: { link: "https://menu.example/a" } },
        },
      },
      {
        id: "2",
        creative: {
          id: "c2",
          object_story_spec: { link_data: { link: "https://menu.example/a" } },
        },
      },
      {
        id: "3",
        creative: {
          id: "c3",
          call_to_action: {
            value: { link: "https://wa.me/5511999999999" },
          },
        },
      },
    ];

    expect(collectDestinationUrlsFromAds(ads)).toEqual([
      "https://menu.example/a",
      "https://wa.me/5511999999999",
    ]);
  });
});

describe("buildAdSetConversionDetails", () => {
  test("joins pixel name and destination fields", () => {
    const adSet = {
      id: "adset-1",
      destination_type: "WEBSITE",
      promoted_object: {
        pixel_id: "999",
        custom_event_type: "PURCHASE",
      },
      ads: {
        data: [
          {
            id: "ad-1",
            creative: {
              id: "c1",
              object_story_spec: {
                link_data: { link: "https://cardapio.example" },
              },
            },
          },
        ],
      },
    } as GraphApiAdSet;

    expect(
      buildAdSetConversionDetails({
        adSet,
        pixelNameById: new Map([["999", "Pixel Restaurante"]]),
      }),
    ).toEqual({
      destinationType: "WEBSITE",
      pixelId: "999",
      pixelName: "Pixel Restaurante",
      customEventType: "PURCHASE",
      destinationUrls: ["https://cardapio.example"],
    });
  });
});
