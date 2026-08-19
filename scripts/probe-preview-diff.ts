/**
 * Sondagem 3 — o preview reflete adapt_to_placement?
 *
 * Gera previews de uma imagem QUADRADA (1:1) nos posicionamentos verticais
 * (Stories / Reels) com a feature OPT_IN e OPT_OUT, e compara.
 * Se as URLs dos iframes divergirem, dá para mostrar o antes/depois sem
 * criar anuncio nenhum.
 *
 * Read-only: generatepreviews e um GET, nao persiste nada.
 *
 * Uso:  APP_ENV=staging bun .claude/worktrees/creative-placement-probe/scripts/probe-preview-diff.ts
 */

import { createDecipheriv } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "dotenv";
import postgres from "postgres";

const STAGING_PROJECT_REF = "wsbsnzgzqiehqnklzchm";
const GRAPH = "https://graph.facebook.com/v25.0";
// Conta da propria LEG (agencia), nao a do cliente.
const PREFERRED_ACT = "act_509408644106984";

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

async function main() {
  const sql = postgres(postgresUrl, { prepare: false, max: 1, connect_timeout: 15 });
  const [row] = await sql<Array<{ access_token: string; assigned_assets: any }>>`
    SELECT access_token, assigned_assets FROM meta_business_accounts
    WHERE connection_status <> 'needs_reconnect' ORDER BY created_at DESC LIMIT 1
  `;
  await sql.end();

  const token = dec(row.access_token);
  const accounts: any[] = row.assigned_assets.adAccounts;
  const page = row.assigned_assets.pages[0];

  const act =
    accounts.find((a) => a.id === PREFERRED_ACT)?.id ?? accounts[0].id;
  console.log("conta:", act, accounts.find((a) => a.id === act)?.name);
  console.log("page :", page.id, page.name);

  // -- procura uma imagem QUADRADA (o ponto da demo e quadrado -> vertical) --
  const imgs = await (
    await fetch(`${GRAPH}/${act}/adimages?fields=hash,width,height,name,permalink_url&limit=100&access_token=${token}`)
  ).json();
  const pool: any[] = imgs.data ?? [];
  console.log(`imagens na biblioteca: ${pool.length}`);
  if (!pool.length) {
    console.log("!! conta sem imagens — nao da para demonstrar aqui");
    return;
  }

  const ratio = (i: any) => (i.width ?? 1) / (i.height ?? 1);
  const squares = pool
    .filter((i) => Math.abs(ratio(i) - 1) < 0.06 && (i.width ?? 0) >= 600)
    .sort((a, b) => b.width - a.width);
  console.log(`quadradas (>=600px, ~1:1): ${squares.length}`);
  for (const s of squares.slice(0, 5))
    console.log(`   ${s.hash.slice(0, 10)}  ${s.width}x${s.height}  ${s.name ?? ""}`);

  const target = squares[0];
  if (!target) {
    console.log("!! nenhuma imagem quadrada; listando as 8 maiores para escolher outra estrategia:");
    for (const s of pool.slice().sort((a, b) => b.width * b.height - a.width * a.height).slice(0, 8))
      console.log(`   ${s.hash.slice(0, 10)}  ${s.width}x${s.height}  ratio=${ratio(s).toFixed(2)}  ${s.name ?? ""}`);
    return;
  }

  console.log(`\nimagem escolhida: ${target.hash} ${target.width}x${target.height}`);
  console.log(`permalink: ${target.permalink_url ?? "-"}`);

  const creativeFor = (optIn: boolean) => ({
    object_story_spec: {
      page_id: page.id,
      instagram_user_id: page.instagramBusinessAccountId,
      link_data: {
        link: "https://automatize.digital",
        message: "Teste de adaptacao de posicionamento",
        name: "Automatize",
        image_hash: target.hash,
        call_to_action: { type: "LEARN_MORE", value: { link: "https://automatize.digital" } },
      },
    },
    degrees_of_freedom_spec: {
      creative_features_spec: {
        adapt_to_placement: {
          enroll_status: optIn ? "OPT_IN" : "OPT_OUT",
          ...(optIn ? { customizations: { image_crop_style: "AUTO" } } : {}),
        },
        pac_relaxation: { enroll_status: optIn ? "OPT_IN" : "OPT_OUT" },
      },
    },
  });

  const formats = ["INSTAGRAM_STORY", "INSTAGRAM_REELS", "FACEBOOK_STORY_MOBILE", "INSTAGRAM_STANDARD"];
  const out: Array<{ format: string; optIn: string; optOut: string; same: boolean }> = [];

  for (const fmt of formats) {
    const grab = async (optIn: boolean) => {
      const u = new URL(`${GRAPH}/${act}/generatepreviews`);
      u.searchParams.set("ad_format", fmt);
      u.searchParams.set("creative", JSON.stringify(creativeFor(optIn)));
      u.searchParams.set("access_token", token);
      const r = await fetch(u);
      const b = await r.json();
      if (!r.ok) return `ERRO: ${b?.error?.message}`;
      const html: string = b?.data?.[0]?.body ?? "";
      const m = html.match(/src="([^"]+)"/);
      return m ? m[1].replace(/&amp;/g, "&") : "(sem src)";
    };
    const a = await grab(true);
    const b = await grab(false);
    const same = a === b;
    out.push({ format: fmt, optIn: a, optOut: b, same });
    console.log(`\n${fmt}`);
    console.log(`   OPT_IN : ${a.slice(0, 130)}`);
    console.log(`   OPT_OUT: ${b.slice(0, 130)}`);
    console.log(`   -> ${same ? "URLS IDENTICAS (preview pode nao refletir a feature)" : "URLS DIFERENTES"}`);
  }

  writeFileSync(
    resolve(process.cwd(), ".scratch/preview-urls.json"),
    JSON.stringify({ act, page: page.id, image: target, previews: out }, null, 2),
  );
  console.log("\nURLs salvas em .scratch/preview-urls.json");
}

main().catch((e) => {
  console.error("FALHA:", e);
  process.exit(1);
});
