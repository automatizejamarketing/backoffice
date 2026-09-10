import assert from "node:assert/strict";
import test from "node:test";

import {
  CUSTOMER_LIST_SOURCE,
  type CustomerFileImportDependencies,
  type CustomerFileImportSelection,
  prepareCustomerFileImportRun,
  previewCustomerFileImport,
  receiveCustomerFileUpload,
  runCustomerFileImportPlan,
} from "../lib/customer-file/import-service";
import { createCustomAudience } from "../lib/meta-business/marketing/audiences/create";
import { listCustomAudiences } from "../lib/meta-business/marketing/audiences/read";
import {
  confirmLookalikeAudience,
  reviewLookalikeAudience,
} from "../lib/meta-business/marketing/audiences/lookalike-operation";
import {
  applyAudienceExclusions,
  validateAudienceExclusionsAgainstLibrary,
} from "../lib/meta-business/marketing/ai-creation/audience-exclusions";
import {
  applyAudienceInclusions,
  summarizeAudienceTargeting,
  validateAudienceInclusionsAgainstLibrary,
} from "../lib/meta-business/marketing/ai-creation/audience-inclusions";
import {
  ensureMetaTestEnv,
  installMetaFetchStub,
  type MetaFetchStub,
} from "./helpers/meta-fetch-stub";
import { openSharedCustomerFileStores } from "./helpers/customer-file-sqlite";

ensureMetaTestEnv();

const ACT = "act_123";
const TOKEN = "integration-test-token";
const ACTOR = { kind: "user" as const, actorId: "user-1", customerId: "customer-1" };
const SELECTION: CustomerFileImportSelection = {
  mapping: { emailColumn: "email", phoneColumn: "phone" },
  referenceCountry: "BR",
};

function csv(): Uint8Array {
  return new TextEncoder().encode("email,phone\r\nfirst@example.com,11999998888");
}

function jsonParam(params: URLSearchParams, key: string): unknown {
  const value = params.get(key);
  return value ? JSON.parse(value) : undefined;
}

function metaAudienceStub(): MetaFetchStub {
  let nextId = 1;
  const audiences: Array<Record<string, unknown>> = [];

  return installMetaFetchStub((request) => {
    if (request.method === "GET" && request.path.endsWith("/customaudiences")) {
      return { body: { data: audiences } };
    }

    if (request.method === "POST" && request.path.endsWith("/customaudiences")) {
      const rule = jsonParam(request.params, "rule") as {
        inclusions?: { rules?: Array<{ event_sources?: Array<{ type?: string }> }> };
      } | undefined;
      const sourceType = rule?.inclusions?.rules?.[0]?.event_sources?.[0]?.type;
      const id = `integration-audience-${nextId++}`;
      const subtype = request.params.get("subtype") ??
        (sourceType === "ig_business" ? "ENGAGEMENT" : sourceType === "pixel" ? "WEBSITE" : undefined);
      const lookalikeSpec = jsonParam(request.params, "lookalike_spec");
      if (subtype === "CUSTOM" && !request.params.get("customer_file_source")) {
        return { status: 422, body: { error: { message: "Customer-list source is required" } } };
      }
      const lookalikeSpecRecord = lookalikeSpec && typeof lookalikeSpec === "object" ? lookalikeSpec as Record<string, unknown> : undefined;
      if (subtype === "LOOKALIKE" && (!request.params.get("origin_audience_id") || !lookalikeSpecRecord || lookalikeSpecRecord.country !== "BR" || typeof lookalikeSpecRecord.ratio !== "number")) {
        return { status: 422, body: { error: { message: "Lookalike origin, country, and ratio are required" } } };
      }
      if (!subtype && (!rule || !sourceType || !request.params.get("prefill"))) {
        return { status: 422, body: { error: { message: "Rule-based audience payload is incomplete" } } };
      }
      audiences.push({
        id,
        name: request.params.get("name"),
        ...(request.params.get("description") ? { description: request.params.get("description") } : {}),
        ...(subtype ? { subtype } : {}),
        ...(request.params.get("customer_file_source") ? { customer_file_source: request.params.get("customer_file_source") } : {}),
        ...(rule ? { rule } : {}),
        ...(lookalikeSpec ? { lookalike_spec: lookalikeSpec, origin_audience_id: request.params.get("origin_audience_id") } : {}),
        permission_for_actions: {
          can_use: true,
          can_edit: true,
          can_share: true,
          supports_recipient_lookalike: true,
        },
        operation_status: { code: 200 },
        approximate_count_lower_bound: 100,
        approximate_count_upper_bound: 200,
      });
      return { body: { id } };
    }

    return { status: 500, body: { error: { message: `Unexpected Meta call: ${request.method} ${request.path}` } } };
  });
}

test("joins fresh Instagram, website, and customer-list origins through lookalikes into AI targeting", async () => {
  const { storeA, cleanup } = openSharedCustomerFileStores();
  let stub: MetaFetchStub | undefined;
  const sentRows: Array<{ audienceId: string; rows: number; serialized: string }> = [];
  let customerListId: string | undefined;

  try {
    const activeStub = metaAudienceStub();
    stub = activeStub;
    const instagram = await createCustomAudience({
    adAccountId: ACT,
    accessToken: TOKEN,
    type: "engagement",
    name: "Fresh Instagram audience",
    rule: {
      inclusions: [{
        eventSources: [{ id: "ig-profile-1", type: "ig_business" }],
        retentionDays: 30,
        filters: [{ field: "event", operator: "eq", value: "ig_business_profile_engaged" }],
      }],
    },
    prefill: true,
    });
    const website = await createCustomAudience({
    adAccountId: ACT,
    accessToken: TOKEN,
    type: "website",
    name: "Fresh website audience",
    rawRule: {
      inclusions: {
        operator: "or",
        rules: [{
          event_sources: [{ id: "pixel-1", type: "pixel" }],
          retention_seconds: 30 * 86_400,
          filter: { operator: "and", filters: [{ field: "event", operator: "eq", value: "PageView" }] },
        }],
      },
    },
    prefill: true,
    });

    assert.equal(instagram.ok, true);
    assert.equal(website.ok, true);
    if (!instagram.ok || !website.ok) return;

    const dependencies: CustomerFileImportDependencies = {
    store: storeA,
    authorize: async () => undefined,
    termsState: async () => ({ accepted: true }),
    createAudience: async (input) => {
      const created = await createCustomAudience({
        adAccountId: input.adAccountId,
        accessToken: TOKEN,
        type: "raw",
        subtype: "CUSTOM",
        customerFileSource: input.customerFileSource,
        name: input.name,
        description: input.description,
      });
      if (!created.ok) throw new Error(created.issues[0]?.reason ?? "customer list creation failed");
      customerListId = created.id;
      return { id: created.id };
    },
    send: async (request) => {
      sentRows.push({ audienceId: request.audienceId, rows: request.batch.data.length, serialized: JSON.stringify(request.batch.data) });
      return { num_received: request.batch.data.length };
    },
    revalidateRemote: async () => ({ safeToContinue: true }),
    reconcileCreation: async () => undefined,
    reconcileReplacement: async () => ({ safeToContinue: false }),
    newOperationId: () => "integration-import-1",
    now: () => new Date("2026-09-10T12:00:00.000Z"),
    };

    const received = await receiveCustomerFileUpload({
      actor: ACTOR,
      target: { adAccountId: ACT, operation: "create", name: "Fresh customer list" },
      bytes: csv(),
    }, dependencies);
    const preview = await previewCustomerFileImport({ actor: ACTOR, operationId: received.operationId, selection: SELECTION }, dependencies);
    assert.equal(preview.audience.isNew, true);
    assert.equal(preview.counts.valid, 1);

    const prepared = await prepareCustomerFileImportRun({
      actor: ACTOR,
      operationId: received.operationId,
      previewToken: preview.previewToken,
      selection: SELECTION,
      explicitlySendValidRows: false,
      declarations: { dataOrigin: CUSTOMER_LIST_SOURCE, termsAccepted: true },
    }, dependencies);
    const status = await runCustomerFileImportPlan(prepared.plan, dependencies);
    assert.equal(status.phase, "completed");
    assert.equal(customerListId, status.audienceId);
    assert.equal(sentRows.length, 1);
    assert.doesNotMatch(sentRows[0]!.serialized, /first@example\.com|11999998888/);

    const origins = [instagram.id, website.id, customerListId!];
    const lookalikes: string[] = [];
    for (const [index, originAudienceId] of origins.entries()) {
      const reviewed = await reviewLookalikeAudience({
        adAccountId: ACT,
        accessToken: TOKEN,
        originAudienceId,
        name: `Fresh lookalike ${index + 1}`,
        country: "BR",
        percentage: index + 1,
      });
      assert.equal(reviewed.ok, true);
      if (!reviewed.ok) continue;
      const confirmed = await confirmLookalikeAudience({
        adAccountId: ACT,
        accessToken: TOKEN,
        originAudienceId,
        name: `Fresh lookalike ${index + 1}`,
        country: "BR",
        percentage: index + 1,
        confirmationToken: reviewed.confirmationToken,
      });
      assert.equal(confirmed.ok, true);
      if (confirmed.ok) lookalikes.push(confirmed.id);
    }
    assert.equal(lookalikes.length, origins.length);

    const library = (await listCustomAudiences({ adAccountId: ACT, accessToken: TOKEN, detailed: true })).items;
    assert.deepEqual(validateAudienceInclusionsAgainstLibrary([lookalikes[0]!, lookalikes[2]!], library), []);
    assert.deepEqual(validateAudienceExclusionsAgainstLibrary([lookalikes[2]!], library), []);

    const baseTargeting = {
      geo_locations: { countries: ["BR"] },
      custom_audiences: [{ id: "legacy" }],
      excluded_custom_audiences: [{ id: "legacy-exclusion" }],
      targeting_automation: { advantage_audience: 1 },
    };
    const included = applyAudienceInclusions(baseTargeting, [lookalikes[0]!, lookalikes[2]!]);
    const targeted = applyAudienceExclusions(included.targeting, [lookalikes[2]!]).targeting!;
    assert.deepEqual(summarizeAudienceTargeting(targeted), {
      includedIds: [lookalikes[0]!, lookalikes[2]!],
      excludedIds: [lookalikes[2]!],
      effectiveIncludedIds: [lookalikes[0]!],
      overlappingIds: [lookalikes[2]!],
    });
    assert.equal((targeted.targeting_automation as Record<string, unknown>).advantage_audience, 0);
    assert.equal((targeted.targeting_relaxation_types as Record<string, unknown>).custom_audience, 0);
    assert.equal((targeted.targeting_relaxation_types as Record<string, unknown>).lookalike, 0);

    const noOptions = applyAudienceExclusions(applyAudienceInclusions(baseTargeting, undefined).targeting, undefined);
    assert.deepEqual(noOptions.targeting, baseTargeting);
    assert.ok(activeStub.realCalls().every((request) => request.path.endsWith("/customaudiences")));
  } finally {
    cleanup();
    stub?.restore();
  }
});
