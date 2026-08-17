import assert from "node:assert/strict";
import { describe, it } from "node:test";
import pixComSplit from "./fixtures/pix-com-split.gateway-response-fields.json";
import pixRecorrenciaCharge from "./fixtures/pix-recorrencia-charge.json";
import pixSemSplit from "./fixtures/pix-sem-split.gateway-response-fields.json";
import {
  noteUnknownVindiPixEmv,
  parseVindiPixEmv,
  vindiPixEmvUnknownLogFields,
} from "./pix-emv";

const SANDBOX_EMV =
  "00020101021126950014BR.GOV.BCB.PIX2573spi.dev.cloud.itau.com.br/documentos/198e49c5-2330-4ad7-9d0b-967c7b5371225204000053039865802BR5923PMD Gotham NegA cios ME6009SAO PAULO62410503***50300017BR.GOV.BCB.BRCODE01051.0.063040866";

describe("parseVindiPixEmv", () => {
  it("reads the copia-e-cola EMV from the captured sandbox fixtures", () => {
    const fixtures = [pixSemSplit, pixComSplit, pixRecorrenciaCharge];

    for (const fixture of fixtures) {
      const parsed = parseVindiPixEmv(fixture);
      assert.equal(parsed.ok, true);
      if (parsed.ok) {
        assert.equal(parsed.emvPayload, SANDBOX_EMV);
        assert.equal(parsed.sourceKey, "qrcode_original_path");
      }
    }
  });

  it("reads EMV from a Recorrência bill whose charge carries gateway_response_fields", () => {
    const parsed = parseVindiPixEmv({
      bill: {
        id: 16019799,
        charges: [pixRecorrenciaCharge],
      },
    });

    assert.deepEqual(parsed, {
      ok: true,
      emvPayload: SANDBOX_EMV,
      sourceKey: "qrcode_original_path",
    });
  });

  it("reads EMV when gateway_response_fields arrives as a JSON string", () => {
    const parsed = parseVindiPixEmv({
      last_transaction: {
        gateway_response_fields: JSON.stringify({
          qrcode_original_path: SANDBOX_EMV,
          qrcode_path: pixSemSplit.qrcode_path,
        }),
      },
    });

    assert.equal(parsed.ok, true);
    if (parsed.ok) assert.equal(parsed.emvPayload, SANDBOX_EMV);
  });

  it("returns an unknown-shape result instead of throwing", () => {
    const shapes = [
      null,
      undefined,
      "not-json",
      { qrcode_path: pixSemSplit.qrcode_path },
      { gateway_response_fields: { print_url: "https://example.com/boleto" } },
    ];

    for (const shape of shapes) {
      const parsed = parseVindiPixEmv(shape);
      assert.equal(parsed.ok, false);
      if (!parsed.ok) {
        assert.ok(
          parsed.reason === "missing" || parsed.reason === "unknown_shape",
        );
        assert.ok(Array.isArray(parsed.fieldKeys));
      }
    }
  });

  it("exposes structured log fields for an unknown shape", () => {
    const parsed = parseVindiPixEmv({
      qrcode_path: pixSemSplit.qrcode_path,
      tid: "326766",
    });
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;

    assert.deepEqual(vindiPixEmvUnknownLogFields(parsed), {
      reason: parsed.reason,
      fieldKeys: parsed.fieldKeys,
    });
    assert.ok(parsed.fieldKeys.includes("qrcode_path"));
  });

  it("logs an unknown shape without throwing so a webhook can stay on 2xx", () => {
    const logs: Array<{ event: string; fields: Record<string, unknown> }> = [];
    noteUnknownVindiPixEmv(
      { qrcode_path: pixSemSplit.qrcode_path },
      (event, fields) => {
        logs.push({ event, fields });
      },
    );
    assert.equal(logs[0]?.event, "unknown_pix_emv_shape");
    assert.doesNotThrow(() => noteUnknownVindiPixEmv(null, () => undefined));
  });
});
