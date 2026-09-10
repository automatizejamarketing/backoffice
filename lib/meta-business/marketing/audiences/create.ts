/**
 * createCustomAudience — unified custom-audience (público personalizado) creation
 * primitive (ADR 0017), same contract as the ADR 0009 creation primitives.
 *
 * First-class types: `website` / `engagement` / `mobile_app` (rule-based, compiled
 * by ./rule — website=Pixel, engagement=Page/IG-business/lead-form, mobile_app=App
 * events), `lookalike` (subtype LOOKALIKE + lookalike_spec), `product` (dynamic
 * product audience on the DEDICATED /act_/product_audiences edge), and `raw` (escape
 * hatch for customer-file shell / offline / any Meta field via subtype + rawRule +
 * extraFields). Offline is reachable via `raw` or a rule whose event source type is
 * `offline_event`.
 *
 * Flow: local validation (collect-all) → real create. Most types POST to
 * /act_/customaudiences; `product` POSTs to /act_/product_audiences.
 * NOTE (deliberate divergence from campaign/ad-set): the customaudiences edge is
 * NOT run through Meta `validate_only` — it isn't documented to support it and a
 * "preview" must never risk creating a real audience. So `previewCustomAudience`
 * is LOCAL-only; `createCustomAudience` is the single committing call and fails
 * cleanly (creating nothing) if Meta rejects it — ToS (1870034) and integrity
 * (471) surface there as actionable issues.
 */

import { metaApiCall } from "@/lib/meta-business/api";
import {
  type CreateIssue,
  type CreateResult,
  type PreviewResult,
  fail,
  localIssue,
  mergeExtraFields,
  ok,
} from "../creation/types";
import { issuesFromError } from "../creation/normalize";
import { type AudienceRuleInput, compileAudienceRule } from "./rule";
import { isWholeLookalikeRatio } from "./lookalike";
import { audienceSubcodeSuggestion } from "./validation";

export type CustomAudienceCreateType =
  | "website"
  | "engagement"
  | "mobile_app"
  | "lookalike"
  | "product"
  | "raw";

export type CreateCustomAudienceInput = {
  /** "act_<id>" or a bare numeric id. */
  adAccountId: string;
  accessToken: string;
  type: CustomAudienceCreateType;
  /** Optional at the type level so the tool can omit it; the validator flags NAME_REQUIRED. */
  name?: string;
  description?: string;

  // ── rule-based (website | engagement): provide `rule` (compiled) OR `rawRule`. ──
  rule?: AudienceRuleInput;
  rawRule?: Record<string, unknown> | string;
  /** Website: include pre-creation activity (Meta default true). */
  prefill?: boolean;
  optOutLink?: string;

  // ── lookalike ──
  originAudienceId?: string;
  lookalikeCountry?: string;
  lookalikeType?: "similarity" | "reach";
  lookalikeRatio?: number;
  lookalikeStartingRatio?: number;
  /** Merged verbatim into lookalike_spec (page/pixel seed, value-based, etc.). */
  lookalikeSpecRaw?: Record<string, unknown>;

  // ── product (dynamic) — dedicated /product_audiences edge ──
  /** Product Set the dynamic audience is built from. */
  productSetId?: string;
  /**
   * Product-audience inclusion rules, raw Meta shape:
   * `[{ retention_seconds, rule: { event: { eq: "AddToCart" } } }]`. Passed through
   * verbatim (the product-audience rule grammar differs from the customaudiences one).
   */
  productInclusions?: unknown[];
  productExclusions?: unknown[];

  // ── raw / escape-hatch types (customer file shell, offline, any field) ──
  subtype?: string;
  customerFileSource?: string;

  /** Escape hatch — merged verbatim into the POST body (any Meta field). */
  extraFields?: Record<string, unknown>;
};

const RULE_TYPES = new Set<CustomAudienceCreateType>([
  "website",
  "engagement",
  "mobile_app",
]);

/** Pure local validation (collect-all). No Meta calls. */
export function validateCreateCustomAudienceInput(
  input: CreateCustomAudienceInput,
): CreateIssue[] {
  const issues: CreateIssue[] = [];

  if (!input.name?.trim()) {
    issues.push(
      localIssue(
        "audience",
        "NAME_REQUIRED",
        "O público precisa de um nome.",
        "Pergunte ao usuário que nome dar ao público (não invente).",
        ["name"],
      ),
    );
  }

  if (RULE_TYPES.has(input.type)) {
    if (!input.rule && input.rawRule == null) {
      issues.push(
        localIssue(
          "audience",
          "RULE_REQUIRED",
          `Público do tipo "${input.type}" precisa de uma regra.`,
          "Forneça `rule` (por intenção — o servidor compila) ou `rawRule` (JSON cru).",
          ["rule"],
        ),
      );
    } else if (input.rule) {
      const compiled = compileAudienceRule(input.rule);
      if (!compiled.ok) issues.push(...compiled.issues);
    }
  }

  if (input.type === "lookalike") {
    if (!input.originAudienceId?.trim()) {
      issues.push(
        localIssue(
          "audience",
          "LOOKALIKE_SEED_REQUIRED",
          "Lookalike precisa de um público semente (origin_audience_id).",
          "Pergunte qual público usar como semente (listCustomAudiences mostra os ids).",
          ["origin_audience_id"],
        ),
      );
    }
    if (!input.lookalikeCountry?.trim()) {
      issues.push(
        localIssue(
          "audience",
          "LOOKALIKE_COUNTRY_REQUIRED",
          "Lookalike precisa do país de origem (ISO-2).",
          "Pergunte o país (ex.: BR) para o lookalike_spec.",
          ["lookalike_spec", "country"],
        ),
      );
    }
    if (
      input.lookalikeRatio != null &&
      (input.lookalikeRatio < 0.01 || input.lookalikeRatio > 0.2)
    ) {
      issues.push(
        localIssue(
          "audience",
          "LOOKALIKE_RATIO_RANGE",
          `ratio ${input.lookalikeRatio} fora da faixa (0.01 a 0.20).`,
          "Use um ratio entre 0.01 (1%) e 0.20 (20%).",
          ["lookalike_spec", "ratio"],
        ),
      );
    }
    if (
      input.lookalikeRatio != null &&
      input.lookalikeRatio >= 0.01 &&
      input.lookalikeRatio <= 0.2 &&
      !isWholeLookalikeRatio(input.lookalikeRatio)
    ) {
      issues.push(
        localIssue(
          "audience",
          "LOOKALIKE_RATIO_RANGE",
          "O tamanho do público semelhante deve usar incrementos inteiros de 1%.",
          "Use um ratio de 0.01 (1%), 0.02 (2%) e assim por diante, até 0.20 (20%).",
          ["lookalike_spec", "ratio"],
        ),
      );
    }
  }

  if (input.type === "product") {
    if (!input.productSetId?.trim()) {
      issues.push(
        localIssue(
          "audience",
          "PRODUCT_SET_REQUIRED",
          "Público de produto (dinâmico) precisa de um Product Set (product_set_id).",
          "Informe o id do Product Set do catálogo alvo.",
          ["product_set_id"],
        ),
      );
    }
    if (!input.productInclusions?.length) {
      issues.push(
        localIssue(
          "audience",
          "PRODUCT_INCLUSIONS_REQUIRED",
          "Público de produto precisa de ao menos uma regra de inclusão.",
          'Forneça inclusions no formato [{retention_seconds, rule:{event:{eq:"AddToCart"}}}].',
          ["inclusions"],
        ),
      );
    }
  }

  if (
    input.type === "raw" &&
    !input.subtype &&
    input.rawRule == null &&
    input.rule == null &&
    !input.extraFields
  ) {
    issues.push(
      localIssue(
        "audience",
        "RAW_PAYLOAD_REQUIRED",
        'Público "raw" precisa de ao menos subtype, uma regra ou extraFields.',
        "Informe subtype (ex.: CUSTOM), rawRule ou extraFields para o tipo desejado.",
        ["subtype"],
      ),
    );
  }

  return issues;
}

function ruleValue(input: CreateCustomAudienceInput): string | undefined {
  if (input.rawRule != null) {
    return typeof input.rawRule === "string"
      ? input.rawRule
      : JSON.stringify(input.rawRule);
  }
  if (input.rule) {
    const compiled = compileAudienceRule(input.rule);
    if (compiled.ok) return JSON.stringify(compiled.rule);
  }
  return undefined;
}

function buildLookalikeSpec(input: CreateCustomAudienceInput): string {
  const spec: Record<string, unknown> = {
    type: input.lookalikeType ?? "similarity",
  };
  if (input.lookalikeCountry) spec.country = input.lookalikeCountry;
  if (input.lookalikeRatio != null) spec.ratio = input.lookalikeRatio;
  if (input.lookalikeStartingRatio != null)
    spec.starting_ratio = input.lookalikeStartingRatio;
  if (input.lookalikeSpecRaw) Object.assign(spec, input.lookalikeSpecRaw);
  return JSON.stringify(spec);
}

/** Build the Meta POST body (no access_token — metaApiCall appends it). */
export function buildCustomAudiencePayload(
  input: CreateCustomAudienceInput,
): URLSearchParams {
  const p = new URLSearchParams();
  // Reached only after validation passed (name present); guard keeps the type honest.
  p.set("name", (input.name ?? "").trim());
  if (input.description) p.set("description", input.description);
  if (input.optOutLink) p.set("opt_out_link", input.optOutLink);

  if (input.type === "lookalike") {
    p.set("subtype", "LOOKALIKE");
    if (input.originAudienceId)
      p.set("origin_audience_id", input.originAudienceId);
    p.set("lookalike_spec", buildLookalikeSpec(input));
  } else if (RULE_TYPES.has(input.type)) {
    // Website / Engagement carry NO subtype (unsupported since 2018) — just the rule.
    const rule = ruleValue(input);
    if (rule) p.set("rule", rule);
    if (input.prefill != null) p.set("prefill", input.prefill ? "true" : "false");
  } else {
    // raw — escape hatch (customer-file shell / offline / any field).
    // product is routed to its own edge/builder before reaching here.
    if (input.subtype) p.set("subtype", input.subtype);
    if (input.customerFileSource)
      p.set("customer_file_source", input.customerFileSource);
    const rule = ruleValue(input);
    if (rule) p.set("rule", rule);
  }

  mergeExtraFields(p, input.extraFields);
  return p;
}

/**
 * Build the POST body for the DEDICATED product-audiences edge
 * (/act_/product_audiences). Its `inclusions`/`exclusions` use the product rule
 * grammar (`{ retention_seconds, rule: { event: { eq } } }`) — distinct from the
 * customaudiences `rule` — so they are passed through verbatim as JSON.
 */
export function buildProductAudiencePayload(
  input: CreateCustomAudienceInput,
): URLSearchParams {
  const p = new URLSearchParams();
  p.set("name", (input.name ?? "").trim());
  if (input.description) p.set("description", input.description);
  if (input.productSetId) p.set("product_set_id", input.productSetId);
  if (input.productInclusions)
    p.set("inclusions", JSON.stringify(input.productInclusions));
  if (input.productExclusions?.length)
    p.set("exclusions", JSON.stringify(input.productExclusions));
  mergeExtraFields(p, input.extraFields);
  return p;
}

/** The Graph edge + body for a create, routing `product` to its dedicated edge. */
function resolveEdgeAndBody(input: CreateCustomAudienceInput): {
  edge: "customaudiences" | "product_audiences";
  body: URLSearchParams;
} {
  return input.type === "product"
    ? { edge: "product_audiences", body: buildProductAudiencePayload(input) }
    : { edge: "customaudiences", body: buildCustomAudiencePayload(input) };
}

function formatAccountId(id: string): string {
  return id.startsWith("act_") ? id : `act_${id}`;
}

/**
 * Preview: LOCAL validation + rule compilation only — NO Meta call, creates
 * nothing. Returns the compiled payload that WOULD be sent (the AI's confirm
 * step), or the issues that block it.
 */
export async function previewCustomAudience(
  input: CreateCustomAudienceInput,
): Promise<PreviewResult> {
  const issues = validateCreateCustomAudienceInput(input);
  if (issues.length) return { ok: false, issues };
  const { body } = resolveEdgeAndBody(input);
  return { ok: true, payload: Object.fromEntries(body) as Record<string, string> };
}

/**
 * Create the custom audience: local validation → real create (POST
 * /act_/customaudiences). Always returns a {@link CreateResult}; never throws.
 */
export async function createCustomAudience(
  input: CreateCustomAudienceInput,
): Promise<CreateResult> {
  const issues = validateCreateCustomAudienceInput(input);
  if (issues.length) return fail(issues);

  const account = formatAccountId(input.adAccountId);
  const { edge, body } = resolveEdgeAndBody(input);
  try {
    const res = await metaApiCall<{ id: string }>({
      method: "POST",
      path: `${account}/${edge}`,
      params: "",
      body,
      accessToken: input.accessToken,
    });
    return ok(res.id, { id: res.id });
  } catch (error) {
    return fail(
      issuesFromError(error, "create", "audience", audienceSubcodeSuggestion),
    );
  }
}
