import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyTotals, primaryKpi } from "./metrics";
import {
  buildOfferPrompt,
  buildOfferPromptInput,
  extractCreativeCopy,
  OFFER_MAX_MENU_ITEMS,
  parseOfferResponse,
  selectOfferAds,
  type OfferAdSource,
  type OfferMenuItem,
} from "./offer-suggestion";
import type { PerfTotals } from "./types";

function ad(adId: string, current: Partial<PerfTotals>, share: number, name = `Anúncio ${adId}`): OfferAdSource {
  const totals = { ...emptyTotals(), ...current };
  return { adId, name, campaignName: "Vendas", status: "ACTIVE", current: totals, kpi: primaryKpi(totals, "compras"), spendShare: share, isVideo: false };
}

describe("oferta/combo · texto do criativo", () => {
  it("lê título, texto, descrição e botão do object_story_spec", () => {
    const copy = extractCreativeCopy({
      object_story_spec: {
        link_data: { name: "Pizza em dobro", message: "Peça já pelo app", description: "Só hoje", call_to_action: { type: "ORDER_NOW" } },
      },
    });
    assert.deepEqual(copy, { titles: ["Pizza em dobro"], bodies: ["Peça já pelo app"], descriptions: ["Só hoje"], cta: "ORDER_NOW" });
  });

  it("junta as variações do asset_feed_spec sem repetir e lê vídeo", () => {
    const copy = extractCreativeCopy({
      body: "Texto A",
      object_story_spec: { video_data: { title: "Vídeo", message: "Texto A", call_to_action: { type: "LEARN_MORE" } } },
      asset_feed_spec: { titles: [{ text: "T1" }, { text: "T2" }, { text: "T3" }], bodies: [{ text: "Texto B" }], call_to_action_types: ["SHOP_NOW"] },
    });
    assert.deepEqual(copy.titles, ["Vídeo", "T1", "T2"]);
    assert.deepEqual(copy.bodies, ["Texto A", "Texto B"]);
    assert.equal(copy.cta, "LEARN_MORE");
  });

  it("spec ausente ou estranho não quebra", () => {
    assert.deepEqual(extractCreativeCopy(null), { titles: [], bodies: [], descriptions: [], cta: null });
    assert.deepEqual(extractCreativeCopy({ object_story_spec: "x" }).titles, []);
  });
});

describe("oferta/combo · entrada do prompt", () => {
  const bad = ad("111", { spend: 150 }, 0.4, "Pizza sem graça");
  const good = ad("222", { spend: 120, purchases: 8 }, 0.3, "Combo família");
  const better = ad("333", { spend: 100, purchases: 10 }, 0.3, "Rodízio terça");

  it("sem adIds, a regra de criativo ruim escolhe; os melhores (menor custo) entram como contraste", () => {
    const { bad: chosen, best } = selectOfferAds({ ads: [bad, good, better], goal: undefined, days: 7 });
    assert.deepEqual(chosen.map((item) => item.adId), ["111"]);
    assert.deepEqual(best.map((item) => item.adId), ["333", "222"]);
  });

  it("com adIds, usa os pedidos e tira eles do contraste", () => {
    const { bad: chosen, best } = selectOfferAds({ ads: [bad, good, better], adIds: ["222", "999"], goal: undefined, days: 7 });
    assert.deepEqual(chosen.map((item) => item.adId), ["222"]);
    assert.ok(!best.some((item) => item.adId === "222"));
  });

  it("monta a entrada com empresa, copy e cardápio (destaques primeiro, cortado)", () => {
    const menu: OfferMenuItem[] = Array.from({ length: 50 }, (_, index) => ({
      name: `Item ${index}`,
      category: "Pizzas",
      description: null,
      priceCentavos: index === 0 ? 0 : 4990,
      featured: index === 45,
    }));
    const input = buildOfferPromptInput({
      days: 7,
      company: { name: "Pizzaria da Ana", description: "Pizza de forno a lenha", niche: "food_service", subNiche: "pizzaria", industry: null, targetAudience: null, city: "Campinas" },
      bad: [bad],
      best: [better],
      copyByAd: new Map([["111", { titles: ["Pizza"], bodies: ["Peça"], descriptions: [], cta: "ORDER_NOW" }]]),
      menuItems: menu,
    });
    assert.equal(input.menu.items.length, OFFER_MAX_MENU_ITEMS);
    assert.equal(input.menu.items[0].name, "Item 45");
    assert.equal(input.menu.hasPrices, true);
    assert.deepEqual(input.badAds[0].copy.titles, ["Pizza"]);
    assert.deepEqual(input.bestAds[0].copy, { titles: [], bodies: [], descriptions: [], cta: null });
    const { prompt, system } = buildOfferPrompt(input);
    assert.match(prompt, /Pizzaria da Ana — Campinas/);
    assert.match(prompt, /"Pizza sem graça" \(imagem, campanha "Vendas"\): gasto R\$\s?150,00 \(40% da verba\), 0 compras/);
    assert.match(prompt, /títulos: "Pizza"/);
    assert.match(prompt, /Item 1 \[Pizzas\] — R\$\s?49,90/);
    assert.match(system, /NUNCA invente preço exato/);
  });

  it("sem empresa nem cardápio, avisa o modelo para não citar preço", () => {
    const input = buildOfferPromptInput({ days: 7, company: null, bad: [], best: [], copyByAd: new Map(), menuItems: [] });
    assert.equal(input.menu.hasPrices, false);
    assert.match(buildOfferPrompt(input).prompt, /Cardápio: não cadastrado — não cite preços exatos\./);
  });
});

describe("oferta/combo · resposta da IA", () => {
  const json = JSON.stringify({
    suggestions: [
      { name: "Combo Família", composition: "2 pizzas grandes + refri", priceHint: "R$ 89,90 o combo", whyItWorks: "Valor claro", creativeLine: "Combo família por R$ 89,90" },
      { name: "Terça em dobro", composition: "Na terça, a segunda pizza sai pela metade", priceHint: "~50% na segunda", whyItWorks: "Dia fraco", creativeLine: "Terça: segunda pizza pela metade" },
      { name: "Brinde", composition: "Sobremesa grátis acima de 2 pizzas", priceHint: "", whyItWorks: "Ticket maior", creativeLine: "Sobremesa por nossa conta" },
      { name: "Quarta", composition: "x", priceHint: "", whyItWorks: "y", creativeLine: "z" },
    ],
  });

  it("lê JSON com cercas e texto em volta, e fica com 3", () => {
    const list = parseOfferResponse(`Pensei nos dados.\n\`\`\`json\n${json}\n\`\`\``, true);
    assert.equal(list.length, 3);
    assert.equal(list[0].priceHint, "R$ 89,90 o combo");
  });

  it("sem cardápio com preço, apaga preço exato inventado", () => {
    const [first, second] = parseOfferResponse(json, false);
    assert.match(first.priceHint, /Defina o preço com o cliente/);
    assert.equal(first.creativeLine, "Combo família por preço especial");
    assert.equal(second.priceHint, "~50% na segunda");
  });

  it("corta frase do anúncio em 120 caracteres", () => {
    const long = JSON.stringify({ suggestions: [{ name: "A", composition: "B", priceHint: "", whyItWorks: "C", creativeLine: "palavra ".repeat(40) }] });
    assert.ok(parseOfferResponse(long, false)[0].creativeLine.length <= 120);
  });

  it("formato errado vira erro claro", () => {
    assert.throws(() => parseOfferResponse("não sei", false), /formato esperado/);
    assert.throws(() => parseOfferResponse('{"suggestions":[]}', false), /formato esperado/);
  });
});
