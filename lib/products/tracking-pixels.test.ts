import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyDefaultTrackingPixels,
  parseConversionsApiTokenChanges,
  parseTrackingPixels,
  readStoredTrackingPixels,
  type TrackingPixel,
} from "./tracking-pixels";

const META_SNIPPET = `<!-- Meta Pixel Code -->
<script>
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){};}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '25666150899674355');
fbq('track', 'PageView');
</script>`;

function pixel(
  provider: TrackingPixel["provider"],
  pixelId: string,
  extra: Partial<TrackingPixel> = {},
): TrackingPixel {
  return {
    provider,
    pixelId,
    conversionLabel: null,
    purchaseOnPixGenerated: false,
    ...extra,
  };
}

describe("parseTrackingPixels", () => {
  it("normaliza cada provedor e remove repetidos", () => {
    assert.deepEqual(
      parseTrackingPixels([
        { provider: "meta", pixelId: " 25666150899674355 " },
        { provider: "meta", pixelId: "25666150899674355" },
        { provider: "tiktok", pixelId: "cabcd1234efgh5678ij0" },
        { provider: "google_analytics", pixelId: "g-abc123xyz9" },
        {
          provider: "google_ads",
          pixelId: "AW-123456789",
          conversionLabel: "AbC-D_efG",
          purchaseOnPixGenerated: true,
        },
      ]),
      [
        pixel("meta", "25666150899674355"),
        pixel("tiktok", "CABCD1234EFGH5678IJ0"),
        pixel("google_analytics", "G-ABC123XYZ9"),
        pixel("google_ads", "AW-123456789", {
          conversionLabel: "AbC-D_efG",
          purchaseOnPixGenerated: true,
        }),
      ],
    );
  });

  it("extrai o ID do snippet colado em vez de guardar o script", () => {
    assert.deepEqual(parseTrackingPixels([{ provider: "meta", pixelId: META_SNIPPET }]), [
      pixel("meta", "25666150899674355"),
    ]);
    assert.deepEqual(
      parseTrackingPixels([
        {
          provider: "tiktok",
          pixelId: "ttq.load('CABCD1234EFGH5678IJ0'); ttq.page();",
        },
      ]),
      [pixel("tiktok", "CABCD1234EFGH5678IJ0")],
    );
  });

  it("aceita o destino do Google Ads colado como AW-ID/rótulo", () => {
    assert.deepEqual(
      parseTrackingPixels([
        { provider: "google_ads", pixelId: "AW-123456789/AbC-D_efG" },
      ]),
      [pixel("google_ads", "AW-123456789", { conversionLabel: "AbC-D_efG" })],
    );
  });

  it("recusa ID fora do formato, script sem ID e Google Ads sem rótulo", () => {
    assert.throws(
      () => parseTrackingPixels([{ provider: "meta", pixelId: "<script>alert(1)</script>" }]),
      /não é um ID válido/,
    );
    assert.throws(
      () => parseTrackingPixels([{ provider: "meta", pixelId: "12345" }]),
      /não é um ID válido/,
    );
    assert.throws(
      () => parseTrackingPixels([{ provider: "google_ads", pixelId: "AW-123456789" }]),
      /rótulo da conversão/,
    );
    assert.throws(
      () => parseTrackingPixels([{ provider: "snapchat", pixelId: "1" }]),
      /plataforma/,
    );
    assert.throws(() => parseTrackingPixels({}), /Lista de pixels inválida/);
  });

  it("limita a quantidade de pixels", () => {
    const eleven = Array.from({ length: 11 }, (_, index) => ({
      provider: "meta",
      pixelId: `10000000000000${String(index).padStart(2, "0")}`,
    }));
    assert.throws(() => parseTrackingPixels(eleven), /no máximo 10/);
  });

  it("lista ausente vira vazia", () => {
    assert.deepEqual(parseTrackingPixels(undefined), []);
    assert.deepEqual(parseTrackingPixels(null), []);
  });
});

describe("readStoredTrackingPixels", () => {
  it("descarta entrada inválida do banco sem derrubar o checkout", () => {
    assert.deepEqual(
      readStoredTrackingPixels([
        { provider: "meta", pixelId: "25666150899674355" },
        { provider: "meta", pixelId: "abc" },
        "lixo",
      ]),
      [pixel("meta", "25666150899674355")],
    );
    assert.deepEqual(readStoredTrackingPixels(null), []);
  });
});

describe("applyDefaultTrackingPixels", () => {
  const defaults = [
    pixel("meta", "25666150899674355"),
    pixel("tiktok", "CABCD1234EFGH5678IJ0"),
  ];

  it("produto sem pixel recebe todos os padrões", () => {
    assert.deepEqual(applyDefaultTrackingPixels([], defaults), defaults);
  });

  it("não troca o pixel já escolhido no produto; completa só provedores ausentes", () => {
    const own = pixel("meta", "1111111111111111");
    assert.deepEqual(applyDefaultTrackingPixels([own], defaults), [
      own,
      pixel("tiktok", "CABCD1234EFGH5678IJ0"),
    ]);
  });

  it("produto que ainda usa o padrão anterior acompanha a troca e a remoção", () => {
    const previous = [pixel("meta", "1111111111111111"), pixel("tiktok", "CABCD1234EFGH5678IJ0")];
    const next = [pixel("meta", "2222222222222222")];
    assert.deepEqual(applyDefaultTrackingPixels(previous, next, previous), next);
  });

  it("padrão que não cabe inteiro no limite não entra pela metade", () => {
    const nineGa = Array.from({ length: 9 }, (_, index) =>
      pixel("google_analytics", `G-TEST${index}AA`),
    );
    const twoMeta = [pixel("meta", "1111111111111111"), pixel("meta", "2222222222222222")];
    assert.deepEqual(applyDefaultTrackingPixels(nineGa, twoMeta), nineGa);
    assert.deepEqual(applyDefaultTrackingPixels(nineGa, [twoMeta[0]]), [...nineGa, twoMeta[0]]);
  });

  it("produto que ajustou o pixel herdado deixa de acompanhar o padrão", () => {
    const previous = [pixel("meta", "1111111111111111")];
    const customized = [pixel("meta", "1111111111111111", { purchaseOnPixGenerated: true })];
    assert.deepEqual(
      applyDefaultTrackingPixels(customized, [pixel("meta", "2222222222222222")], previous),
      customized,
    );
  });
});

describe("parseConversionsApiTokenChanges", () => {
  const token = `EAA${"x".repeat(40)}`;

  it("grava, remove e ignora linha sem token ou de outra plataforma", () => {
    assert.deepEqual(
      parseConversionsApiTokenChanges([
        { provider: "meta", pixelId: "25666150899674355", capiAccessToken: ` ${token} ` },
        { provider: "meta", pixelId: "1111111111111111", capiAccessToken: null },
        { provider: "meta", pixelId: "2222222222222222", capiAccessToken: "" },
        { provider: "meta", pixelId: "3333333333333333" },
        { provider: "tiktok", pixelId: "CABCD1234EFGH5678IJ0", capiAccessToken: token },
      ]),
      [
        { pixelId: "25666150899674355", accessToken: token },
        { pixelId: "1111111111111111", accessToken: null },
      ],
    );
  });

  it("recusa token com espaço ou curto demais", () => {
    assert.throws(
      () =>
        parseConversionsApiTokenChanges([
          { provider: "meta", pixelId: "25666150899674355", capiAccessToken: "abc def" },
        ]),
      /token da API de Conversões/,
    );
  });

  it("parseTrackingPixels nunca devolve o token", () => {
    assert.deepEqual(
      parseTrackingPixels([
        { provider: "meta", pixelId: "25666150899674355", capiAccessToken: token },
      ]),
      [pixel("meta", "25666150899674355")],
    );
  });
});
