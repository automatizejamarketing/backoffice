/**
 * Sondagem AO VIVO, em STAGING, do que a Marketing API v25 aceita para
 * adaptação automática de criativo entre posicionamentos (1:1 <-> 4:5 <-> 9:16).
 *
 * Responde às 3 perguntas que a documentação oficial deixa em aberto:
 *   1. Quais chaves de `creative_features_spec` a v25 realmente aceita?
 *      (a referência AdCreativeFeaturesSpec e o guia "Get Started" divergem)
 *   2. Quais são os valores válidos do enum `image_crop_style`?
 *      (o campo é declarado mas os valores não são publicados)
 *   3. O Meta ecoa `degrees_of_freedom_spec` de volta num GET do criativo?
 *      (é o que permitiria a UI mostrar o que está ligado)
 *
 * SEGURANÇA:
 *   - Só roda com APP_ENV=staging E project ref da staging conferido.
 *   - Lê `.env.staging` do checkout principal EXPLICITAMENTE. Nunca herda
 *     `process.env` (o bun auto-carrega `.env`/`.env.local`, e `.env.local`
 *     aponta para PRODUÇÃO neste repo).
 *   - Read-only por padrão. A validação usa `execution_options=['validate_only']`,
 *     que faz o Meta validar o payload sem persistir nada. Nenhum criativo,
 *     anúncio ou imagem é criado. Nada é apagado.
 *
 * Uso (a partir do checkout principal do backoffice):
 *   APP_ENV=staging bun .claude/worktrees/creative-placement-probe/scripts/probe-creative-placement.ts
 */

import { createDecipheriv } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "dotenv";
import postgres from "postgres";

// ---------------------------------------------------------------------------
// Ambiente: leitura explícita, sem herdar process.env
// ---------------------------------------------------------------------------

const STAGING_PROJECT_REF = "wsbsnzgzqiehqnklzchm";
const GRAPH = "https://graph.facebook.com/v25.0";

const envPath =
  process.env.PROBE_ENV_FILE ?? resolve(process.cwd(), ".env.staging");

const env = parse(readFileSync(envPath));

if (process.env.APP_ENV !== "staging") {
  throw new Error("Restrito a APP_ENV=staging");
}

const postgresUrl = env.POSTGRES_URL;
if (!postgresUrl) throw new Error(`POSTGRES_URL ausente em ${envPath}`);

const dbUrl = new URL(postgresUrl);
if (!`${dbUrl.hostname}:${dbUrl.username}`.includes(STAGING_PROJECT_REF)) {
  throw new Error("POSTGRES_URL nao aponta para o projeto de staging");
}

// ---------------------------------------------------------------------------
// Decrypt do envelope de token (espelha lib/meta-business/token-vault.ts)
// ---------------------------------------------------------------------------

function decryptAccessToken(value: string): string {
  if (!value.startsWith("enc:")) return value; // legado em texto puro
  const [, version, ivB64, tagB64, cipherB64] = value.split(":");
  const raw = env.META_TOKEN_ENCRYPTION_KEYS?.trim();
  if (!raw) throw new Error("META_TOKEN_ENCRYPTION_KEYS ausente");
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    const colon = trimmed.indexOf(":");
    if (colon <= 0) continue;
    if (trimmed.slice(0, colon) !== version) continue;
    const key = Buffer.from(trimmed.slice(colon + 1), "base64");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(ivB64, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return (
      decipher.update(Buffer.from(cipherB64, "base64")).toString("utf8") +
      decipher.final("utf8")
    );
  }
  throw new Error(`Nenhuma chave do keyring decifra a versao ${version}`);
}

// ---------------------------------------------------------------------------
// Helpers de Graph
// ---------------------------------------------------------------------------

type GraphResult = { ok: boolean; status: number; body: any };

async function graphGet(
  path: string,
  params: Record<string, string>,
): Promise<GraphResult> {
  const url = new URL(`${GRAPH}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url);
  return { ok: res.ok, status: res.status, body: await res.json() };
}

async function graphPost(
  path: string,
  fields: Record<string, string>,
): Promise<GraphResult> {
  const form = new URLSearchParams(fields);
  const res = await fetch(`${GRAPH}${path}`, { method: "POST", body: form });
  return { ok: res.ok, status: res.status, body: await res.json() };
}

function errOf(r: GraphResult): string {
  const e = r.body?.error;
  if (!e) return "";
  const parts = [e.message];
  if (e.error_user_msg && e.error_user_msg !== e.message)
    parts.push(e.error_user_msg);
  if (e.error_subcode) parts.push(`subcode=${e.error_subcode}`);
  return parts.filter(Boolean).join(" | ");
}

// ---------------------------------------------------------------------------
// Sondagem
// ---------------------------------------------------------------------------

// Chaves candidatas. As marcadas `refOnly` aparecem SÓ na referencia
// AdCreativeFeaturesSpec; as `guideOnly` aparecem SÓ no guia Get Started.
// A divergencia entre as duas paginas e exatamente o que queremos resolver.
const FEATURE_KEYS: Array<{ key: string; media: "image" | "video"; src: string }> =
  [
    { key: "adapt_to_placement", media: "image", src: "ambas" },
    { key: "image_touchups", media: "image", src: "ambas" },
    { key: "image_uncrop", media: "image", src: "guideOnly" },
    { key: "pac_relaxation", media: "image", src: "ambas" },
    { key: "media_type_automation", media: "image", src: "ambas" },
    { key: "image_templates", media: "image", src: "refOnly" },
    { key: "image_background_gen", media: "image", src: "refOnly" },
    { key: "text_optimizations", media: "image", src: "ambas" },
    { key: "standard_enhancements", media: "image", src: "morto na v22" },
    { key: "video_auto_crop", media: "video", src: "guideOnly" },
    { key: "video_uncrop", media: "video", src: "guideOnly" },
    { key: "chave_inexistente_de_controle", media: "image", src: "controle" },
  ];

async function main() {
  const sql = postgres(postgresUrl, {
    prepare: false,
    connect_timeout: 15,
    max: 2,
  });

  console.log("=".repeat(78));
  console.log("SONDAGEM: adaptacao de criativo por posicionamento — Marketing API v25");
  console.log("ambiente: STAGING (" + STAGING_PROJECT_REF + ")   env: " + envPath);
  console.log("=".repeat(78));

  // -- Conexões Meta disponíveis -------------------------------------------
  const rows = await sql<
    Array<{
      id: string;
      user_id: string;
      token_kind: string;
      connection_status: string;
      access_token: string;
      assigned_assets: any;
      token_expires_at: Date | null;
    }>
  >`
    SELECT id, user_id, token_kind, connection_status, access_token,
           assigned_assets, token_expires_at
    FROM meta_business_accounts
    WHERE connection_status <> 'needs_reconnect'
    ORDER BY created_at DESC
    LIMIT 20
  `;

  console.log(`\n[0] conexoes Meta ativas em staging: ${rows.length}`);

  type Candidate = {
    token: string;
    actId: string;
    actName: string;
    tokenKind: string;
    pages: Array<{ id: string; name?: string; instagramBusinessAccountId?: string }>;
  };
  const candidates: Candidate[] = [];

  for (const row of rows) {
    let token: string;
    try {
      token = decryptAccessToken(row.access_token);
    } catch (e) {
      console.log(`    - conn ${row.id.slice(0, 8)}: decrypt FALHOU (${(e as Error).message})`);
      continue;
    }
    const accounts = row.assigned_assets?.adAccounts ?? [];
    const pages = row.assigned_assets?.pages ?? [];
    console.log(
      `    - conn ${row.id.slice(0, 8)} kind=${row.token_kind} status=${row.connection_status} adAccounts=${accounts.length} pages=${pages.length}`,
    );
    for (const a of accounts) {
      const actId = a.id?.startsWith("act_") ? a.id : `act_${a.accountId ?? a.id}`;
      candidates.push({
        token,
        actId,
        actName: a.name ?? "(sem nome)",
        tokenKind: row.token_kind,
        pages,
      });
    }
  }

  if (candidates.length === 0) {
    console.log("\n!! Nenhuma conta de anuncio utilizavel. Abortando.");
    await sql.end();
    return;
  }

  // -- Escolhe a primeira conta que responde ao Graph ------------------------
  let chosen: Candidate | null = null;
  let imageHash: string | null = null;
  let pageId: string | null = null;

  outer: for (const c of candidates.slice(0, 8)) {
    const me = await graphGet(`/${c.actId}`, {
      fields: "name,account_status,currency",
      access_token: c.token,
    });
    if (!me.ok) {
      console.log(`    x ${c.actId} inacessivel: ${errOf(me)}`);
      continue;
    }
    // precisa de uma imagem ja existente na biblioteca (zero writes).
    // Escolhe a MAIOR disponivel: imagens minusculas sao recusadas por
    // features que dependem de resolucao.
    const imgs = await graphGet(`/${c.actId}/adimages`, {
      fields: "hash,width,height,name",
      limit: "50",
      access_token: c.token,
    });
    const pool: any[] = imgs.body?.data ?? [];
    if (pool.length === 0) {
      console.log(`    x ${c.actId} sem imagens na biblioteca (precisa de 1 para validar)`);
      continue;
    }
    const best = pool
      .slice()
      .sort((a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0))[0];

    // pareia com a primeira pagina que faz o criativo base validar
    for (const pg of c.pages) {
      const test = await graphPost(`/${c.actId}/adcreatives`, {
        name: "probe-pairing",
        object_story_spec: JSON.stringify({
          page_id: pg.id,
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
        execution_options: JSON.stringify(["validate_only"]),
        access_token: c.token,
      });
      if (!test.ok) {
        console.log(`    x ${c.actId} + page ${pg.id}: ${errOf(test).slice(0, 110)}`);
        continue;
      }
      chosen = c;
      imageHash = best.hash;
      pageId = pg.id;
      console.log(
        `\n[1] conta escolhida: ${c.actId} "${me.body.name}" (${me.body.currency}, status=${me.body.account_status}, token=${c.tokenKind})`,
      );
      console.log(
        `    imagem de teste: hash=${String(best.hash).slice(0, 12)}... (${best.width}x${best.height})  |  ${pool.length} imagens na biblioteca`,
      );
      console.log(`    page: ${pg.id} "${pg.name ?? ""}"  ig=${pg.instagramBusinessAccountId ?? "-"}`);
      break outer;
    }
  }

  if (!chosen || !imageHash) {
    console.log("\n!! Nenhuma conta com Graph acessivel + imagem. Abortando.");
    await sql.end();
    return;
  }
  if (!pageId) {
    console.log("!! Sem pagina promovivel: a validacao de criativo exige page_id. Abortando.");
    await sql.end();
    return;
  }

  const { token, actId } = chosen;

  // -- [2] O que os criativos EXISTENTES ja carregam -------------------------
  console.log("\n[2] degrees_of_freedom_spec em criativos ja existentes na conta");
  const existing = await graphGet(`/${actId}/adcreatives`, {
    fields: "id,name,degrees_of_freedom_spec,asset_feed_spec{optimization_type,asset_customization_rules}",
    limit: "25",
    access_token: token,
  });
  if (!existing.ok) {
    console.log(`    erro: ${errOf(existing)}`);
  } else {
    const list = existing.body?.data ?? [];
    const seen = new Map<string, number>();
    let withDof = 0;
    let withRules = 0;
    for (const cr of list) {
      const feats = cr.degrees_of_freedom_spec?.creative_features_spec;
      if (feats) {
        withDof++;
        for (const k of Object.keys(feats))
          seen.set(k, (seen.get(k) ?? 0) + 1);
      }
      if (cr.asset_feed_spec?.asset_customization_rules?.length) withRules++;
    }
    console.log(`    criativos lidos: ${list.length} | com degrees_of_freedom_spec: ${withDof} | com asset_customization_rules: ${withRules}`);
    if (seen.size) {
      console.log("    chaves realmente presentes (o que o Gerenciador grava):");
      for (const [k, n] of [...seen.entries()].sort((a, b) => b[1] - a[1]))
        console.log(`      ${String(n).padStart(3)}x  ${k}`);
    } else {
      console.log("    (nenhuma chave encontrada nos criativos lidos)");
    }
    // amostra crua da primeira que tiver, para ver o shape real
    const sample = list.find((c: any) => c.degrees_of_freedom_spec);
    if (sample)
      console.log(
        "    amostra crua:\n" +
          JSON.stringify(sample.degrees_of_freedom_spec, null, 2)
            .split("\n")
            .map((l: string) => "      " + l)
            .join("\n"),
      );
  }

  // -- [3] Quais chaves a v25 aceita (validate_only, nada e criado) ----------
  console.log("\n[3] aceitacao por chave — POST /adcreatives com execution_options=['validate_only']");
  console.log("    (nada e persistido; testamos o validador do Meta)");

  const baseCreative = (feature: Record<string, unknown> | null) => {
    const objectStorySpec = {
      page_id: pageId,
      link_data: {
        link: "https://automatize.digital",
        message: "sondagem",
        image_hash: imageHash,
        call_to_action: {
          type: "LEARN_MORE",
          value: { link: "https://automatize.digital" },
        },
      },
    };
    const fields: Record<string, string> = {
      name: "probe-placement-adaptation",
      object_story_spec: JSON.stringify(objectStorySpec),
      execution_options: JSON.stringify(["validate_only"]),
      access_token: token,
    };
    if (feature)
      fields.degrees_of_freedom_spec = JSON.stringify({
        creative_features_spec: feature,
      });
    return fields;
  };

  // sanidade: o baseline sem features precisa passar, senao o resto e ruido
  const baseline = await graphPost(`/${actId}/adcreatives`, baseCreative(null));
  console.log(
    `    baseline (sem features): ${baseline.ok ? "OK — validador funcionando" : "FALHOU — " + errOf(baseline)}`,
  );
  if (!baseline.ok) {
    console.log("    !! validate_only indisponivel ou criativo base invalido; resultados abaixo nao sao conclusivos");
  }

  const accepted: string[] = [];
  const rejected: Array<{ key: string; why: string }> = [];

  for (const f of FEATURE_KEYS) {
    const r = await graphPost(
      `/${actId}/adcreatives`,
      baseCreative({ [f.key]: { enroll_status: "OPT_IN" } }),
    );
    const mark = r.ok ? "ACEITA  " : "rejeita ";
    console.log(
      `    ${mark} ${f.key.padEnd(34)} [${f.src}]${r.ok ? "" : "  -> " + errOf(r).slice(0, 150)}`,
    );
    if (r.ok) accepted.push(f.key);
    else rejected.push({ key: f.key, why: errOf(r) });
  }

  // -- [4] image_crop_style: descobrir o enum pelo erro ----------------------
  console.log("\n[4] enum de image_crop_style — provocando o validador com valor invalido");
  const cropProbe = await graphPost(
    `/${actId}/adcreatives`,
    baseCreative({
      adapt_to_placement: {
        enroll_status: "OPT_IN",
        customizations: { image_crop_style: "VALOR_INVALIDO_DE_PROPOSITO" },
      },
    }),
  );
  console.log(
    cropProbe.ok
      ? "    o validador ACEITOU um valor invalido -> o campo nao e validado nesta versao"
      : "    erro (deve enumerar os validos): " + errOf(cropProbe),
  );

  // -- [5] payload completo de adapt_to_placement ---------------------------
  console.log("\n[5] adapt_to_placement com customizations completas");
  const full = await graphPost(
    `/${actId}/adcreatives`,
    baseCreative({
      adapt_to_placement: {
        enroll_status: "OPT_IN",
        customizations: {
          aspect_ratio_config: {
            ar_4_5: { adapt: "OPT_IN" },
            ar_9_16: { adapt: "OPT_IN" },
          },
          placement_groups: {
            vertical: "OPT_IN",
            square: "OPT_IN",
            horizontal: "OPT_OUT",
          },
        },
      },
    }),
  );
  console.log(
    full.ok
      ? "    ACEITA — aspect_ratio_config + placement_groups passam na validacao"
      : "    rejeita -> " + errOf(full),
  );

  // variante só com aspect_ratio_config
  const arOnly = await graphPost(
    `/${actId}/adcreatives`,
    baseCreative({
      adapt_to_placement: {
        enroll_status: "OPT_IN",
        customizations: {
          aspect_ratio_config: {
            ar_4_5: { adapt: "OPT_IN" },
            ar_9_16: { adapt: "OPT_IN" },
          },
        },
      },
    }),
  );
  console.log(
    arOnly.ok
      ? "    ACEITA — so aspect_ratio_config tambem passa"
      : "    so aspect_ratio_config rejeita -> " + errOf(arOnly),
  );

  // -- [6] preview por posicionamento ---------------------------------------
  console.log("\n[6] generatepreviews por posicionamento (o que a UI conseguiria mostrar)");
  const formats = [
    "MOBILE_FEED_STANDARD",
    "INSTAGRAM_STANDARD",
    "INSTAGRAM_STORY",
    "INSTAGRAM_REELS",
    "FACEBOOK_STORY_MOBILE",
    "FACEBOOK_REELS_MOBILE",
  ];
  const previewCreative = {
    object_story_spec: {
      page_id: pageId,
      link_data: {
        link: "https://automatize.digital",
        message: "sondagem",
        image_hash: imageHash,
        call_to_action: {
          type: "LEARN_MORE",
          value: { link: "https://automatize.digital" },
        },
      },
    },
    degrees_of_freedom_spec: {
      creative_features_spec: { adapt_to_placement: { enroll_status: "OPT_IN" } },
    },
  };
  for (const fmt of formats) {
    const p = await graphGet(`/${actId}/generatepreviews`, {
      ad_format: fmt,
      creative: JSON.stringify(previewCreative),
      access_token: token,
    });
    const body = p.body?.data?.[0]?.body ?? "";
    console.log(
      `    ${fmt.padEnd(24)} ${p.ok && body ? "preview OK (iframe " + body.length + " chars)" : "FALHOU — " + errOf(p).slice(0, 110)}`,
    );
  }

  // -- Resumo ---------------------------------------------------------------
  console.log("\n" + "=".repeat(78));
  console.log("RESUMO");
  console.log("=".repeat(78));
  console.log(`chaves ACEITAS pela v25 nesta conta (${accepted.length}):`);
  for (const k of accepted) console.log(`   + ${k}`);
  console.log(`\nchaves REJEITADAS (${rejected.length}):`);
  for (const r of rejected) console.log(`   - ${r.key}: ${r.why.slice(0, 120)}`);

  await sql.end();
}

main().catch((e) => {
  console.error("\nFALHA:", e);
  process.exit(1);
});
