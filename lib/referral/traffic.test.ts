// A classificação de tráfego é o painel inteiro: cada regra daqui vira um
// número que o operador lê como verdade. Os casos cobrem as três testemunhas
// (declarada, referrer, user-agent), a precedência entre elas e o detector de
// robôs de preview — o WhatsApp busca toda URL colada numa conversa, e esse
// fetch NÃO pode contar como clique humano.

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import {
  buildReferralTrafficReport,
  classifyReferralClick,
  parseReferralTrafficRange,
  trafficRangeToDays,
  type ReferralTrafficClick,
} from "./traffic";

const IPHONE_INSTAGRAM_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Mobile/21F90 Instagram 334.0.0.27.94 (iPhone14,2; iOS 17_5; pt_BR)";
const ANDROID_FACEBOOK_UA =
  "Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Version/4.0 Chrome/122.0.0.0 Mobile Safari/537.36 " +
  "[FB_IAB/FB4A;FBAV/453.0.0.0.36;]";
const WINDOWS_CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const ANDROID_SAMSUNG_UA =
  "Mozilla/5.0 (Linux; Android 13; SM-A515F) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36";
const WHATSAPP_PREVIEW_UA = "WhatsApp/2.23.20.79 A";
const FACEBOOK_PREVIEW_UA =
  "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";

describe("classifyReferralClick — fontes", () => {
  test("user-agent do Instagram in-app sem Referer é Instagram", () => {
    const c = classifyReferralClick({
      userAgent: IPHONE_INSTAGRAM_UA,
      referrerUrl: null,
      landingUrl: "/",
    });
    assert.equal(c.kind, "human");
    assert.equal(c.source, "instagram");
    assert.equal(c.browser, "Instagram (in-app)");
    assert.equal(c.device, "Mobile");
    assert.equal(c.os, "iOS");
  });

  test("referrer l.instagram.com com navegador comum é Instagram", () => {
    const c = classifyReferralClick({
      userAgent: WINDOWS_CHROME_UA,
      referrerUrl: "https://l.instagram.com/?u=https%3A%2F%2Fexemplo.com",
      landingUrl: "/",
    });
    assert.equal(c.source, "instagram");
    assert.equal(c.referrerHost, "l.instagram.com");
  });

  test("FB_IAB no user-agent é Facebook", () => {
    const c = classifyReferralClick({
      userAgent: ANDROID_FACEBOOK_UA,
      referrerUrl: null,
      landingUrl: "/",
    });
    assert.equal(c.source, "facebook");
    assert.equal(c.browser, "Facebook (in-app)");
    assert.equal(c.os, "Android");
  });

  test("referrer google.com.br é Google", () => {
    const c = classifyReferralClick({
      userAgent: WINDOWS_CHROME_UA,
      referrerUrl: "https://www.google.com.br/",
      landingUrl: "/",
    });
    assert.equal(c.source, "google");
    assert.equal(c.referrerHost, "google.com.br");
  });

  test("sem referrer e sem app embutido é Direto", () => {
    const c = classifyReferralClick({
      userAgent: WINDOWS_CHROME_UA,
      referrerUrl: "",
      landingUrl: "/",
    });
    assert.equal(c.source, "direct");
    assert.equal(c.device, "Desktop");
    assert.equal(c.browser, "Chrome");
    assert.equal(c.os, "Windows");
  });

  test("referrer desconhecido é Outros sites, mantendo o host", () => {
    const c = classifyReferralClick({
      userAgent: WINDOWS_CHROME_UA,
      referrerUrl: "https://blog.exemplo.com.br/post",
      landingUrl: "/",
    });
    assert.equal(c.source, "other");
    assert.equal(c.referrerHost, "blog.exemplo.com.br");
  });
});

describe("classifyReferralClick — origem declarada no link", () => {
  test("?src=whatsapp vence o referrer: o afiliado sabe onde divulgou", () => {
    const c = classifyReferralClick({
      userAgent: WINDOWS_CHROME_UA,
      referrerUrl: "https://www.instagram.com/",
      landingUrl: "/?src=whatsapp",
    });
    assert.equal(c.source, "whatsapp");
    assert.equal(c.sourceKey, "whatsapp");
  });

  test("apelidos: src=wpp e utm_source=yt caem na fonte certa", () => {
    assert.equal(
      classifyReferralClick({
        userAgent: WINDOWS_CHROME_UA,
        referrerUrl: null,
        landingUrl: "/?src=wpp",
      }).source,
      "whatsapp",
    );
    assert.equal(
      classifyReferralClick({
        userAgent: WINDOWS_CHROME_UA,
        referrerUrl: null,
        landingUrl: "/?utm_source=yt",
      }).source,
      "youtube",
    );
  });

  test("src desconhecido vira canal próprio com o nome declarado", () => {
    const c = classifyReferralClick({
      userAgent: WINDOWS_CHROME_UA,
      referrerUrl: null,
      landingUrl: "/?src=blog-ana",
    });
    assert.equal(c.sourceKey, "declared:blog-ana");
    assert.equal(c.sourceLabel, "blog-ana");
  });

  test("parâmetros de campanha são extraídos da query", () => {
    const c = classifyReferralClick({
      userAgent: WINDOWS_CHROME_UA,
      referrerUrl: null,
      landingUrl: "/?src=whatsapp&utm_campaign=lancamento&foo=bar",
    });
    assert.deepEqual(c.campaignParams, [
      { param: "src", value: "whatsapp" },
      { param: "utm_campaign", value: "lancamento" },
    ]);
    assert.equal(c.landingPath, "/");
  });
});

describe("classifyReferralClick — robôs de preview", () => {
  test("WhatsApp/2.x é robô de preview, não clique humano", () => {
    const c = classifyReferralClick({
      userAgent: WHATSAPP_PREVIEW_UA,
      referrerUrl: null,
      landingUrl: "/",
    });
    assert.equal(c.kind, "preview-bot");
    assert.equal(c.botService, "WhatsApp (preview de link)");
  });

  test("facebookexternalhit é robô de preview", () => {
    const c = classifyReferralClick({
      userAgent: FACEBOOK_PREVIEW_UA,
      referrerUrl: null,
      landingUrl: "/",
    });
    assert.equal(c.kind, "preview-bot");
    assert.equal(c.botService, "Facebook (preview de link)");
  });
});

describe("classifyReferralClick — dispositivo e navegador", () => {
  test("Samsung Internet no Android é identificado antes do Chrome", () => {
    const c = classifyReferralClick({
      userAgent: ANDROID_SAMSUNG_UA,
      referrerUrl: null,
      landingUrl: "/",
    });
    assert.equal(c.browser, "Samsung Internet");
    assert.equal(c.device, "Mobile");
  });

  test("Edge não é contado como Chrome", () => {
    const c = classifyReferralClick({
      userAgent: `${WINDOWS_CHROME_UA} Edg/124.0.0.0`,
      referrerUrl: null,
      landingUrl: "/",
    });
    assert.equal(c.browser, "Edge");
  });

  test("iPad é Tablet", () => {
    const c = classifyReferralClick({
      userAgent:
        "Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 " +
        "(KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
      referrerUrl: null,
      landingUrl: "/",
    });
    assert.equal(c.device, "Tablet");
    assert.equal(c.os, "iOS");
    assert.equal(c.browser, "Safari");
  });
});

describe("buildReferralTrafficReport", () => {
  const click = (
    overrides: Partial<ReferralTrafficClick> & { id: string },
  ): ReferralTrafficClick => ({
    visitorId: overrides.id,
    userAgent: WINDOWS_CHROME_UA,
    referrerUrl: null,
    landingUrl: "/",
    ...overrides,
  });

  test("robôs ficam fora dos totais humanos e ganham painel próprio", () => {
    const report = buildReferralTrafficReport(
      [
        click({ id: "a", userAgent: IPHONE_INSTAGRAM_UA }),
        click({ id: "b", userAgent: WHATSAPP_PREVIEW_UA }),
        click({ id: "c", userAgent: FACEBOOK_PREVIEW_UA }),
      ],
      new Set(),
    );
    assert.equal(report.totals.clicks, 1);
    assert.equal(report.totals.botClicks, 2);
    assert.equal(report.bots.length, 2);
    assert.equal(report.sources.length, 1);
    assert.equal(report.sources[0].key, "instagram");
  });

  test("visitantes são distintos por visitor_id; cliques contam repetição", () => {
    const report = buildReferralTrafficReport(
      [
        click({ id: "a", visitorId: "v1" }),
        click({ id: "b", visitorId: "v1" }),
        click({ id: "c", visitorId: "v2" }),
      ],
      new Set(),
    );
    assert.equal(report.totals.clicks, 3);
    assert.equal(report.totals.visitors, 2);
    const direct = report.sources.find((row) => row.key === "direct");
    assert.equal(direct?.clicks, 3);
    assert.equal(direct?.visitors, 2);
  });

  test("o cadastro é creditado ao balde do clique vencedor", () => {
    const report = buildReferralTrafficReport(
      [
        click({ id: "a", visitorId: "v1", landingUrl: "/?src=whatsapp" }),
        click({ id: "b", visitorId: "v2" }),
      ],
      new Set(["a"]),
    );
    assert.equal(report.totals.signups, 1);
    const whatsapp = report.sources.find((row) => row.key === "whatsapp");
    assert.equal(whatsapp?.signups, 1);
    const direct = report.sources.find((row) => row.key === "direct");
    assert.equal(direct?.signups, 0);
  });

  test("painéis ordenam por visitantes, depois cliques", () => {
    const report = buildReferralTrafficReport(
      [
        click({ id: "a", visitorId: "v1", referrerUrl: "https://www.google.com/" }),
        click({ id: "b", visitorId: "v2", referrerUrl: "https://www.google.com/" }),
        click({ id: "c", visitorId: "v3", referrerUrl: "https://www.instagram.com/" }),
      ],
      new Set(),
    );
    assert.equal(report.sources[0].key, "google");
    assert.equal(report.sources[1].key, "instagram");
  });
});

describe("parseReferralTrafficRange", () => {
  test("valores válidos passam; inválidos caem no padrão de 30 dias", () => {
    assert.equal(parseReferralTrafficRange("7"), "7");
    assert.equal(parseReferralTrafficRange("all"), "all");
    assert.equal(parseReferralTrafficRange("999"), "30");
    assert.equal(parseReferralTrafficRange(null), "30");
  });

  test("trafficRangeToDays converte, com null para desde o início", () => {
    assert.equal(trafficRangeToDays("90"), 90);
    assert.equal(trafficRangeToDays("all"), null);
  });
});
