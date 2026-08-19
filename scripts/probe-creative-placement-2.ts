/**
 * Sondagem 2 — fecha o que a rodada 1 deixou em aberto:
 *   a) a lista COMPLETA de chaves validas de creative_features_spec na v25
 *      (o erro da chave-controle enumera todas; na rodada 1 saiu truncado)
 *   b) o shape correto de aspect_ratio_config.ar_*.adapt ("must be a JSON object")
 *   c) o shape de placement_groups
 *   d) os 5 valores de image_crop_style {AUTO, CROP, EXPAND, NONE, ZOOM}
 *   e) a combinacao que iriamos realmente enviar em producao
 *
 * Read-only: tudo via execution_options=['validate_only']. Nada e criado.
 *
 * Uso (a partir do checkout principal do backoffice):
 *   APP_ENV=staging bun .claude/worktrees/creative-placement-probe/scripts/probe-creative-placement-2.ts
 */

import { createDecipheriv } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "dotenv";
import postgres from "postgres";

const STAGING_PROJECT_REF = "wsbsnzgzqiehqnklzchm";
const GRAPH = "https://graph.facebook.com/v25.0";

const envPath =
  process.env.PROBE_ENV_FILE ?? resolve(process.cwd(), ".env.staging");
const env = parse(readFileSync(envPath));

if (process.env.APP_ENV !== "staging")
  throw new Error("Restrito a APP_ENV=staging");
const postgresUrl = env.POSTGRES_URL;
if (!postgresUrl) throw new Error("POSTGRES_URL ausente");
const dbUrl = new URL(postgresUrl);
if (!`${dbUrl.hostname}:${dbUrl.username}`.includes(STAGING_PROJECT_REF))
  throw new Error("POSTGRES_URL nao aponta para staging");

function decryptAccessToken(value: string): string {
  if (!value.startsWith("enc:")) return value;
  const [, version, ivB64, tagB64, cipherB64] = value.split(":");
  const raw = env.META_TOKEN_ENCRYPTION_KEYS?.trim() ?? "";
  for (const part of raw.split(",")) {
    const t = part.trim();
    const c = t.indexOf(":");
    if (c <= 0 || t.slice(0, c) !== version) continue;
    const d = createDecipheriv(
      "aes-256-gcm",
      Buffer.from(t.slice(c + 1), "base64"),
      Buffer.from(ivB64, "base64"),
    );
    d.setAuthTag(Buffer.from(tagB64, "base64"));
    return (
      d.update(Buffer.from(cipherB64, "base64")).toString("utf8") +
      d.final("utf8")
    );
  }
  throw new Error("keyring nao decifra");
}

type R = { ok: boolean; body: any };
async function post(path: string, fields: Record<string, string>): Promise<R> {
  const res = await fetch(`${GRAPH}${path}`, {
    method: "POST",
    body: new URLSearchParams(fields),
  });
  return { ok: res.ok, body: await res.json() };
}
const msg = (r: R) => r.body?.error?.message ?? "";

async function main() {
  const sql = postgres(postgresUrl, { prepare: false, max: 1, connect_timeout: 15 });
  const [row] = await sql<Array<{ access_token: string; assigned_assets: any }>>`
    SELECT access_token, assigned_assets FROM meta_business_accounts
    WHERE connection_status <> 'needs_reconnect' ORDER BY created_at DESC LIMIT 1
  `;
  await sql.end();

  const token = decryptAccessToken(row.access_token);
  const actId = row.assigned_assets.adAccounts[0].id;
  const page = row.assigned_assets.pages[0];

  // maior imagem da biblioteca
  const imgsRes = await fetch(
    `${GRAPH}/${actId}/adimages?fields=hash,width,height&limit=50&access_token=${token}`,
  );
  const pool: any[] = (await imgsRes.json()).data ?? [];
  const best = pool
    .slice()
    .sort((a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0))[0];

  const withFeatures = (feat: Record<string, unknown>) => ({
    name: "probe-2",
    object_story_spec: JSON.stringify({
      page_id: page.id,
      link_data: {
        link: "https://automatize.digital",
        message: "sondagem",
        image_hash: best.hash,
        call_to_action: {
          type: "LEARN_MORE",
          value: { link: "https://automatize.digital" },
        },
      },
    }),
    degrees_of_freedom_spec: JSON.stringify({ creative_features_spec: feat }),
    execution_options: JSON.stringify(["validate_only"]),
    access_token: token,
  });

  console.log("=".repeat(78));
  console.log("SONDAGEM 2 — shapes exatos   conta:", actId, " page:", page.id);
  console.log("=".repeat(78));

  // -- (a) lista completa de chaves validas ---------------------------------
  console.log("\n[a] TODAS as chaves validas de creative_features_spec na v25");
  const ctrl = await post(
    `/${actId}/adcreatives`,
    withFeatures({ __chave_invalida__: { enroll_status: "OPT_IN" } }),
  );
  const m = msg(ctrl).match(/must be one of \{([^}]*)\}/);
  if (m) {
    const keys = m[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .sort();
    console.log(`    total: ${keys.length}`);
    const cols = 3;
    for (let i = 0; i < keys.length; i += cols)
      console.log("    " + keys.slice(i, i + cols).map((k) => k.padEnd(38)).join(""));
  } else {
    console.log("    nao foi possivel extrair; erro cru:\n    " + msg(ctrl));
  }

  // -- (b) shape de aspect_ratio_config.ar_*.adapt --------------------------
  console.log("\n[b] shape de aspect_ratio_config.ar_4_5.adapt");
  const adaptShapes: Array<[string, unknown]> = [
    ['"OPT_IN" (string)', "OPT_IN"],
    ['{ enroll_status: "OPT_IN" }', { enroll_status: "OPT_IN" }],
    ["{ enroll_status: OPT_OUT }", { enroll_status: "OPT_OUT" }],
  ];
  for (const [label, val] of adaptShapes) {
    const r = await post(
      `/${actId}/adcreatives`,
      withFeatures({
        adapt_to_placement: {
          enroll_status: "OPT_IN",
          customizations: { aspect_ratio_config: { ar_4_5: { adapt: val } } },
        },
      }),
    );
    console.log(`    ${r.ok ? "ACEITA " : "rejeita"}  ${label}${r.ok ? "" : "  -> " + msg(r).slice(0, 130)}`);
  }

  // -- (c) shape de placement_groups ----------------------------------------
  console.log("\n[c] shape de placement_groups");
  const pgShapes: Array<[string, unknown]> = [
    ['vertical: "OPT_IN" (string)', { vertical: "OPT_IN" }],
    ['vertical: { enroll_status: "OPT_IN" }', { vertical: { enroll_status: "OPT_IN" } }],
    [
      "os 3 grupos como objeto",
      {
        vertical: { enroll_status: "OPT_IN" },
        square: { enroll_status: "OPT_IN" },
        horizontal: { enroll_status: "OPT_OUT" },
      },
    ],
  ];
  for (const [label, val] of pgShapes) {
    const r = await post(
      `/${actId}/adcreatives`,
      withFeatures({
        adapt_to_placement: {
          enroll_status: "OPT_IN",
          customizations: { placement_groups: val },
        },
      }),
    );
    console.log(`    ${r.ok ? "ACEITA " : "rejeita"}  ${label}${r.ok ? "" : "  -> " + msg(r).slice(0, 130)}`);
  }

  // -- (d) valores de image_crop_style --------------------------------------
  console.log("\n[d] image_crop_style — os 5 valores do enum");
  for (const style of ["AUTO", "CROP", "EXPAND", "NONE", "ZOOM"]) {
    const r = await post(
      `/${actId}/adcreatives`,
      withFeatures({
        adapt_to_placement: {
          enroll_status: "OPT_IN",
          customizations: { image_crop_style: style },
        },
      }),
    );
    console.log(`    ${r.ok ? "ACEITA " : "rejeita"}  ${style}${r.ok ? "" : "  -> " + msg(r).slice(0, 120)}`);
  }

  // -- (e) o payload que iriamos mandar em producao -------------------------
  console.log("\n[e] combinacao candidata para producao (imagem)");
  const prod = {
    adapt_to_placement: { enroll_status: "OPT_IN" },
    image_touchups: { enroll_status: "OPT_IN" },
    image_uncrop: { enroll_status: "OPT_IN" },
    pac_relaxation: { enroll_status: "OPT_IN" },
    text_optimizations: { enroll_status: "OPT_OUT" },
  };
  const rProd = await post(`/${actId}/adcreatives`, withFeatures(prod));
  console.log(
    `    ${rProd.ok ? "ACEITA — payload valido" : "rejeita -> " + msg(rProd)}`,
  );
  console.log("    payload:\n" + JSON.stringify({ creative_features_spec: prod }, null, 2).split("\n").map((l) => "      " + l).join("\n"));

  console.log("\n[f] combinacao candidata para VIDEO");
  const prodVideo = {
    video_auto_crop: { enroll_status: "OPT_IN" },
    video_uncrop: { enroll_status: "OPT_IN" },
    pac_relaxation: { enroll_status: "OPT_IN" },
  };
  const rVid = await post(`/${actId}/adcreatives`, withFeatures(prodVideo));
  console.log(
    `    ${rVid.ok ? "ACEITA (em criativo de imagem; features de video sao ignoradas se inelegiveis)" : "rejeita -> " + msg(rVid)}`,
  );
}

main().catch((e) => {
  console.error("FALHA:", e);
  process.exit(1);
});
