/**
 * Sondagem 4 — anuncio REAL pausado para ver se a adaptacao aparece.
 *
 * generatepreviews com creative inline NAO reflete adapt_to_placement (as duas
 * variantes renderizam identico). Esta sondagem cria a estrutura minima
 * — campanha + conjunto + 2 anuncios, TUDO PAUSED — para testar se
 * `GET /{ad_id}/previews` reflete.
 *
 * ESCREVE na conta LEG Media (conta da propria agencia, nao a de cliente).
 * Tudo PAUSED => zero veiculacao, zero gasto. Nomes prefixados com [SONDAGEM].
 *
 *   criar:   APP_ENV=staging bun .../probe-live-ad.ts
 *   limpar:  APP_ENV=staging bun .../probe-live-ad.ts --cleanup
 */

import { createDecipheriv } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "dotenv";
import postgres from "postgres";

const STAGING_PROJECT_REF = "wsbsnzgzqiehqnklzchm";
const GRAPH = "https://graph.facebook.com/v25.0";
const ACT = "act_509408644106984"; // LEG Media — conta da agencia
const STATE = resolve(process.cwd(), ".scratch/live-ad-probe.json");
const TAG = "[SONDAGEM][adapt_to_placement]";

const envPath = process.env.PROBE_ENV_FILE ?? resolve(process.cwd(), ".env.staging");
const env = parse(readFileSync(envPath));
if (process.env.APP_ENV !== "staging") throw new Error("Restrito a APP_ENV=staging");
const postgresUrl = env.POSTGRES_URL!;
const dbUrl = new URL(postgresUrl);
if (!`${dbUrl.hostname}:${dbUrl.username}`.includes(STAGING_PROJECT_REF))
  throw new Error("POSTGRES_URL nao aponta para staging");

function dec(v: string): string {
  if (!v.startsWith("enc:")) return v;
  const [, ver, iv, tag, ct] = v.split(":");
  for (const p of (env.META_TOKEN_ENCRYPTION_KEYS ?? "").split(",")) {
    const t = p.trim();
    const c = t.indexOf(":");
    if (c <= 0 || t.slice(0, c) !== ver) continue;
    const d = createDecipheriv("aes-256-gcm", Buffer.from(t.slice(c + 1), "base64"), Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return d.update(Buffer.from(ct, "base64")).toString("utf8") + d.final("utf8");
  }
  throw new Error("keyring nao decifra");
}

let TOKEN = "";
async function post(path: string, fields: Record<string, string>) {
  const res = await fetch(`${GRAPH}${path}`, {
    method: "POST",
    body: new URLSearchParams({ ...fields, access_token: TOKEN }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`POST ${path}: ${body?.error?.message} (subcode ${body?.error?.error_subcode})`);
  return body;
}
async function get(path: string, params: Record<string, string> = {}) {
  const u = new URL(`${GRAPH}${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set("access_token", TOKEN);
  const res = await fetch(u);
  return { ok: res.ok, body: await res.json() };
}
async function del(id: string) {
  const res = await fetch(`${GRAPH}/${id}`, {
    method: "POST",
    body: new URLSearchParams({ access_token: TOKEN, _method: "DELETE" }),
  });
  return { ok: res.ok, body: await res.json() };
}

async function loadToken() {
  const sql = postgres(postgresUrl, { prepare: false, max: 1, connect_timeout: 15 });
  const [row] = await sql<Array<{ access_token: string; assigned_assets: any }>>`
    SELECT access_token, assigned_assets FROM meta_business_accounts
    WHERE connection_status <> 'needs_reconnect' ORDER BY created_at DESC LIMIT 1
  `;
  await sql.end();
  TOKEN = dec(row.access_token);
  return row.assigned_assets.pages[0];
}

async function cleanup() {
  await loadToken();
  if (!existsSync(STATE)) return console.log("nada a limpar (sem state file)");
  const s = JSON.parse(readFileSync(STATE, "utf8"));
  for (const id of [...(s.ads ?? []), ...(s.creatives ?? []), s.adsetId, s.campaignId].filter(Boolean)) {
    const r = await del(id);
    console.log(`  delete ${id}: ${r.ok ? "OK" : JSON.stringify(r.body?.error?.message)}`);
  }
  writeFileSync(STATE, JSON.stringify({ cleanedAt: "done" }, null, 2));
}

async function main() {
  if (process.argv.includes("--cleanup")) return cleanup();

  const page = await loadToken();
  console.log("conta:", ACT, "(LEG Media — agencia)   page:", page.id);

  // imagem quadrada 1440x1440
  const imgs = await get(`/${ACT}/adimages`, { fields: "hash,width,height", limit: "100" });
  const square = (imgs.body.data ?? [])
    .filter((i: any) => Math.abs(i.width / i.height - 1) < 0.06 && i.width >= 1000)
    .sort((a: any, b: any) => b.width - a.width)[0];
  console.log(`imagem: ${square.hash} ${square.width}x${square.height}`);

  // -- campanha PAUSED ------------------------------------------------------
  const campaign = await post(`/${ACT}/campaigns`, {
    name: `${TAG} campanha`,
    objective: "OUTCOME_TRAFFIC",
    status: "PAUSED",
    special_ad_categories: JSON.stringify([]),
    // v25 exige explicitar quando nao se usa orcamento de campanha (subcode 4834011)
    is_adset_budget_sharing_enabled: "false",
  });
  console.log("campanha criada:", campaign.id, "(PAUSED)");

  // -- conjunto PAUSED ------------------------------------------------------
  const adset = await post(`/${ACT}/adsets`, {
    name: `${TAG} conjunto`,
    campaign_id: campaign.id,
    status: "PAUSED",
    daily_budget: "2000", // R$20 — irrelevante, nunca veicula
    billing_event: "IMPRESSIONS",
    optimization_goal: "LINK_CLICKS",
    // a conta nao tem estrategia default; sem isso cai no subcode 2490487
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    destination_type: "WEBSITE",
    targeting: JSON.stringify({
      geo_locations: { countries: ["BR"] },
      publisher_platforms: ["facebook", "instagram"],
      instagram_positions: ["stream", "story", "reels"],
      facebook_positions: ["feed", "story", "facebook_reels"],
    }),
  });
  console.log("conjunto criado:", adset.id, "(PAUSED)");

  const creatives: string[] = [];
  const ads: Array<{ id: string; label: string }> = [];

  for (const optIn of [true, false]) {
    const label = optIn ? "OPT_IN" : "OPT_OUT";
    const creative = await post(`/${ACT}/adcreatives`, {
      name: `${TAG} criativo ${label}`,
      object_story_spec: JSON.stringify({
        page_id: page.id,
        instagram_user_id: page.instagramBusinessAccountId,
        link_data: {
          link: "https://automatize.digital",
          message: "Teste de adaptacao de posicionamento",
          name: "Automatize",
          image_hash: square.hash,
          call_to_action: { type: "LEARN_MORE", value: { link: "https://automatize.digital" } },
        },
      }),
      degrees_of_freedom_spec: JSON.stringify({
        creative_features_spec: {
          adapt_to_placement: {
            enroll_status: optIn ? "OPT_IN" : "OPT_OUT",
            ...(optIn ? { customizations: { image_crop_style: "AUTO" } } : {}),
          },
          pac_relaxation: { enroll_status: optIn ? "OPT_IN" : "OPT_OUT" },
        },
      }),
    });
    creatives.push(creative.id);

    const ad = await post(`/${ACT}/ads`, {
      name: `${TAG} anuncio ${label}`,
      adset_id: adset.id,
      status: "PAUSED",
      creative: JSON.stringify({ creative_id: creative.id }),
    });
    ads.push({ id: ad.id, label });
    console.log(`anuncio ${label}: ad=${ad.id} creative=${creative.id} (PAUSED)`);
  }

  writeFileSync(
    STATE,
    JSON.stringify({ campaignId: campaign.id, adsetId: adset.id, creatives, ads }, null, 2),
  );

  // -- o Meta guardou o que mandamos? --------------------------------------
  console.log("\n[echo] o que o Meta gravou em cada criativo:");
  for (let i = 0; i < creatives.length; i++) {
    const r = await get(`/${creatives[i]}`, { fields: "id,degrees_of_freedom_spec" });
    console.log(`  ${ads[i].label}: ${JSON.stringify(r.body.degrees_of_freedom_spec)}`);
  }

  // -- previews do anuncio real --------------------------------------------
  console.log("\n[previews] GET /{ad_id}/previews");
  const formats = ["INSTAGRAM_STORY", "INSTAGRAM_REELS", "FACEBOOK_STORY_MOBILE", "INSTAGRAM_STANDARD"];
  const result: any[] = [];
  for (const fmt of formats) {
    const row: any = { format: fmt };
    for (const a of ads) {
      const r = await get(`/${a.id}/previews`, { ad_format: fmt });
      const html = r.body?.data?.[0]?.body ?? "";
      const m = html.match(/src="([^"]+)"/);
      row[a.label] = m ? m[1].replace(/&amp;/g, "&") : `ERRO: ${r.body?.error?.message ?? "(sem src)"}`;
    }
    row.same = row.OPT_IN === row.OPT_OUT;
    result.push(row);
    console.log(`  ${fmt.padEnd(24)} ${row.same ? "URLS IDENTICAS" : "URLS DIFERENTES"}`);
  }
  writeFileSync(resolve(process.cwd(), ".scratch/live-ad-previews.json"), JSON.stringify(result, null, 2));
  console.log("\nURLs em .scratch/live-ad-previews.json");
  console.log("IDs em", STATE, "— limpar com --cleanup");
}

main().catch((e) => {
  console.error("FALHA:", e.message);
  process.exit(1);
});
