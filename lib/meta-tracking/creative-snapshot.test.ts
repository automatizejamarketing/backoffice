import { describe, expect, test } from "bun:test";

import {
  MAX_CREATIVES_PER_ACCOUNT_RUN,
  planCreativeFetch,
  promotionUrlsOf,
  toCreativeSnapshotRow,
} from "@/lib/meta-tracking/creative-snapshot";
import {
  adCreativeV25,
  FIXTURE_ACCOUNT_ID,
  FIXTURE_CREATIVE_ID,
} from "@/lib/meta-tracking/fixtures/graph-api-v25";

describe("planCreativeFetch", () => {
  test("os desconhecidos viram lotes do tamanho do node batch", () => {
    const unknownIds = Array.from({ length: 120 }, (_, i) => `creative-${i}`);

    const plan = planCreativeFetch({ unknownIds });

    expect(plan.chunks.map((chunk) => chunk.length)).toEqual([50, 50, 20]);
    expect(plan.chunks.flat()).toEqual(unknownIds);
    expect(plan.deferred).toBe(0);
  });

  test("o mesmo criativo em vários anúncios é pedido uma vez só", () => {
    // Duplicar anúncio é a operação mais comum do Gerenciador: o criativo se
    // repete, e pedi-lo duas vezes no mesmo lote é chamada jogada fora.
    const plan = planCreativeFetch({
      unknownIds: ["c1", "c2", "c1", "c3", "c2"],
    });

    expect(plan.chunks).toEqual([["c1", "c2", "c3"]]);
  });

  test("o passivo acima do teto fica pendente para a próxima execução", () => {
    const unknownIds = Array.from(
      { length: MAX_CREATIVES_PER_ACCOUNT_RUN + 37 },
      (_, i) => `creative-${i}`,
    );

    const plan = planCreativeFetch({ unknownIds });

    expect(plan.chunks.flat()).toHaveLength(MAX_CREATIVES_PER_ACCOUNT_RUN);
    expect(plan.deferred).toBe(37);
  });

  test("conta sem criativo desconhecido não gera lote nenhum", () => {
    expect(planCreativeFetch({ unknownIds: [] })).toEqual({
      chunks: [],
      deferred: 0,
    });
  });
});

describe("toCreativeSnapshotRow", () => {
  test("a resposta da Meta vira a linha do snapshot com o conteúdo íntegro", () => {
    const node = adCreativeV25();

    const row = toCreativeSnapshotRow({
      accountId: FIXTURE_ACCOUNT_ID,
      node,
    });

    expect(row).toEqual({
      id: FIXTURE_CREATIVE_ID,
      accountId: FIXTURE_ACCOUNT_ID,
      spec: node,
    });
  });

  test("resposta sem id não vira linha", () => {
    // Node batch com id inexistente devolve `false` ou objeto vazio; gravar
    // isso criaria um snapshot que nunca casa com anúncio nenhum.
    expect(
      toCreativeSnapshotRow({
        accountId: FIXTURE_ACCOUNT_ID,
        node: adCreativeV25({ id: undefined }),
      }),
    ).toBeNull();
  });
});

describe("promotionUrlsOf", () => {
  test("anúncio de vídeo: a URL só existe dentro do call to action", () => {
    const row = toCreativeSnapshotRow({
      accountId: FIXTURE_ACCOUNT_ID,
      node: adCreativeV25(),
    })!;

    expect(promotionUrlsOf(row.spec)).toEqual([
      "https://loja.exemplo.com.br/inverno",
    ]);
  });

  test("anúncio de link: a URL está no link_data, e o CTA repete a mesma", () => {
    const spec = adCreativeV25({
      object_story_spec: {
        page_id: "1122334455667788",
        link_data: {
          link: "https://loja.exemplo.com.br/oferta",
          message: "Só até domingo.",
          call_to_action: {
            type: "SHOP_NOW",
            value: { link: "https://loja.exemplo.com.br/oferta" },
          },
        },
      },
    });

    // Uma vez só: repetição no CTA é a mesma promoção, não duas.
    expect(promotionUrlsOf(spec)).toEqual(["https://loja.exemplo.com.br/oferta"]);
  });

  test("carrossel: cada cartão leva a uma URL própria", () => {
    const spec = adCreativeV25({
      object_story_spec: {
        page_id: "1122334455667788",
        link_data: {
          link: "https://loja.exemplo.com.br/colecao",
          child_attachments: [
            { link: "https://loja.exemplo.com.br/colecao/casaco" },
            { link: "https://loja.exemplo.com.br/colecao/bota" },
          ],
        },
      },
    });

    expect(promotionUrlsOf(spec)).toEqual([
      "https://loja.exemplo.com.br/colecao",
      "https://loja.exemplo.com.br/colecao/casaco",
      "https://loja.exemplo.com.br/colecao/bota",
    ]);
  });

  test("Advantage+: as variações do asset_feed_spec trazem a lista de destinos", () => {
    const spec = adCreativeV25({
      object_story_spec: undefined,
      asset_feed_spec: {
        link_urls: [
          { website_url: "https://loja.exemplo.com.br/inverno" },
          { website_url: "https://loja.exemplo.com.br/inverno?variacao=b" },
        ],
        call_to_actions: [
          {
            type: "SHOP_NOW",
            value: { link: "https://loja.exemplo.com.br/inverno" },
          },
        ],
        bodies: [{ text: "Últimas unidades." }],
      },
    });

    expect(promotionUrlsOf(spec)).toEqual([
      "https://loja.exemplo.com.br/inverno",
      "https://loja.exemplo.com.br/inverno?variacao=b",
    ]);
  });

  test("criativo de post impulsionado não tem URL de promoção", () => {
    // Impulsionar uma publicação existente não declara destino: o snapshot
    // guarda o post, e a resposta honesta é "não há URL", não um palpite.
    const spec = adCreativeV25({
      object_story_spec: undefined,
      video_id: undefined,
      effective_object_story_id: "1122334455667788_9988776655443322",
    });

    expect(promotionUrlsOf(spec)).toEqual([]);
  });
});
