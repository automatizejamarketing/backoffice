/* Browser-only synthetic transport. Load with agent-browser --init-script BEFORE navigation.
 * Never import this file into the application. It performs no Meta/AI/database requests.
 * Network route --abort rules in README are a mandatory second boundary. */
(() => {
  "use strict";
  if (window.__audienceFixture) return;
  const nativeFetch = window.fetch.bind(window);
  const NOW = "2026-10-05T15:00:00.000Z";
  const USER = "fixture-user";
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const config = {
    scenario: new URL(window.location.href).searchParams.get("audienceFixtureScenario") || "default",
    delayMs: 0,
  };
  const log = [];
  const pending = new Map();
  const uploads = new Map();
  let sequence = 0;
  let termsAccepted = config.scenario !== "terms-pending";
  const accounts = ["111", "222"];
  const caps = {
    read: "available", include: "unknown", exclude: "unknown", editMetadata: "available",
    share: "unknown", editRule: "unknown", manageMembers: "unknown", delete: "unknown", lookalikeSource: "unknown",
  };
  const rule = (id, type, event, days, field = "event", operator = "eq") => ({
    inclusions: { operator: "or", rules: [{
      event_sources: [{ id, type }], retention_seconds: days * 86400,
      filter: { operator: "and", filters: [{ field, operator, value: event }] },
    }] },
  });
  const status = (accountId, id, operation = "create", partial = false) => ({
    operationId: `history-${id}`, operation, state: partial ? "unknown" : "completed",
    phase: partial ? "partial_or_unknown" : "completed",
    label: partial ? "Resultado parcial ou desconhecido" : "Envio concluído",
    detail: "Evidência sintética: nenhum contato foi enviado.", adAccountId: accountId,
    audienceId: id, audienceIdentity: id, receivedAt: NOW, updatedAt: NOW,
    counts: { read: 3, valid: 2, invalid: 1, warnings: 1, duplicatesRemoved: 0 },
    confirmedBatches: 1, confirmedRecords: partial ? 1 : 2, rejectedRecords: 0,
    previewConfirmed: true, declarationsConfirmed: true, pendingUnresolved: partial,
    temporaryDataAvailable: false,
    availability: { include: partial ? "blocked" : "unknown", exclude: partial ? "blocked" : "unknown", lookalikeSource: partial ? "blocked" : "unknown" },
  });
  const library = Object.fromEntries(accounts.map((a) => [a, [
    { id: `aud${a}-customer`, name: `Clientes com capacidade comprovada ${a}`, subtype: "CUSTOM", customerFileSource: "USER_PROVIDED_ONLY", approximateCountLowerBound: 1000, approximateCountUpperBound: 1500, capabilities: { ...caps, manageMembers: "available" }, ruleSummary: "not_applicable" },
    { id: `aud${a}-instagram`, name: `Instagram engajamento ${a}`, subtype: "ENGAGEMENT", retentionDays: 365, rule: rule(`ig${a}`, "ig_business", "ig_business_profile_engaged", 365), ruleSummary: "external", capabilities: { ...caps, editRule: "available" }, approximateCountLowerBound: 2500, approximateCountUpperBound: 3500 },
    { id: `aud${a}-website`, name: `Visitantes do site ${a}`, subtype: "WEBSITE", retentionDays: 30, rule: rule(`pixel${a}`, "pixel", "PageView", 30), ruleSummary: "external", capabilities: { ...caps, editRule: "available" }, approximateCountLowerBound: 0, approximateCountUpperBound: 0 },
    { id: `aud${a}-lookalike`, name: `Semelhante Brasil 1% ${a}`, subtype: "LOOKALIKE", originAudienceId: `aud${a}-customer`, lookalikeSpec: { country: "BR", ratio: 0.01 }, ruleSummary: "not_applicable", capabilities: { ...caps, lookalikeSource: "unavailable" } },
    { id: `aud${a}-external`, name: `Regra externa composta ${a}`, subtype: "WEBSITE", ruleSummary: "external", rule: { inclusions: { operator: "or", rules: [rule(`pixel${a}`, "pixel", "PageView", 30).inclusions.rules[0], rule(`pixel${a}`, "pixel", "Purchase", 180).inclusions.rules[0]] } }, capabilities: { ...caps } },
    { id: `aud${a}-pending`, name: `Lista com importação pendente ${a}`, subtype: "CUSTOM", customerFileSource: "USER_PROVIDED_ONLY", ruleSummary: "not_applicable", importState: "unknown", importResult: { known: true, state: "unknown", operation: "replace", pendingUnresolved: true, receivedAt: NOW, updatedAt: NOW, confirmedBatches: 1, confirmedRecords: 1, rejectedRecords: 0 }, availability: { include: "blocked", exclude: "blocked", lookalikeSource: "blocked", metaProcessing: "processing" }, capabilities: { ...caps }, operationStatus: { code: 200, description: "Processando" } },
    { id: `aud${a}-unknown`, name: `Lista sem permissão de membros ${a}`, subtype: "CUSTOM", customerFileSource: "USER_PROVIDED_ONLY", capabilities: { ...caps }, ruleSummary: "not_applicable" },
    { id: `aud${a}-historical`, name: `Instagram período histórico 730 dias ${a}`, subtype: "ENGAGEMENT", retentionDays: 730, rule: rule(`ig${a}`, "ig_business", "ig_business_profile_visit", 730), ruleSummary: "external", capabilities: { ...caps } },
  ].map((item) => ({ description: "Público sintético para evidência de UI.", importResult: { known: false, state: "not_recorded" }, deliveryStatus: { code: 200, description: "Pronto" }, ...item }))]));
  const history = Object.fromEntries(accounts.map((a) => [a, [status(a, `aud${a}-pending`, "replace", true), status(a, `aud${a}-customer`)]]));
  const limitations = ["Fixture do navegador: consulta não comprova autorização Meta.", "Nenhuma operação real foi executada."];
  const impact = () => ({ knownUses: [{ campaignId: "campaign-fixture", campaignName: "Campanha sintética", adSetId: "adset-fixture", adSetName: "Conjunto sintético", placement: "include" }], dependentAudienceIds: [], coverage: "complete", limitations });
  const period = (criterion, max, initial, key, id) => ({
    [key]: id, criterion, initialDays: initial, editable: "yes", metaMinimumDays: 1,
    metaMaximumDays: max, localValidationMaximumDays: max, unit: "days", historicalFill: "available",
    observedAt: "2026-09-30", context: "Evidência sintética de período para exercitar o formulário.", source: "browser-support/audiences.init.js",
  });
  const igActivities = { all: "ig_business_profile_all", engaged: "ig_business_profile_engaged", profile_visit: "ig_business_profile_visit", messaged: "ig_user_messaged_business", saved: "ig_business_profile_ad_saved" };
  const igEvidence = (a) => Object.fromEntries(Object.keys(igActivities).map((c) => [c, period(c, 365, 365, "profileId", `ig${a}`)]));
  const webEvidence = (a) => Object.fromEntries(["visitors", "url", "event"].map((c) => [c, period(c, 180, 30, "sourceId", `pixel${a}`)]));
  const webSource = { access: "available", activity: "available", availability: "unknown", observedEvents: ["PageView", "Purchase", "Lead"], observedEventsStatus: "available", observedEventsObservedAt: NOW, guidance: "Eventos observados por este Pixel sintético; nenhuma consulta remota." };
  const igSource = { access: "available", activity: "unknown", availability: "unknown", guidance: "Perfil sintético acessível; atividade e disponibilidade não confirmadas." };
  const json = (body, statusCode = 200) => new Response(JSON.stringify(body), { status: statusCode, headers: { "content-type": "application/json", "x-audience-fixture": "browser-only" } });
  const fail = (message, code = 409) => json({ ok: false, success: false, error: "FIXTURE_REFUSED", message }, code);
  const find = (a, id) => library[a].find((item) => item.id === id);
  const formLimits = { maxBytes: 20971520, maxBytesLabel: "20.0 MB", maxRows: 100000, batchSize: 10000 };
  // Inline image avoids image/CDN requests and keeps the review screenshots deterministic.
  const image = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640"><rect width="640" height="640" fill="#312e81"/><circle cx="320" cy="260" r="120" fill="#a5b4fc"/><text x="320" y="480" text-anchor="middle" font-size="32" fill="white">Mídia sintética</text></svg>');
  function saveAudience(a, payload, kind) {
    let target = payload.audienceId && find(a, payload.audienceId);
    if (!target) {
      target = { id: `aud${a}-created-${++sequence}`, ruleSummary: "not_applicable", capabilities: { ...caps }, importResult: { known: false, state: "not_recorded" }, deliveryStatus: { code: 200, description: "Pronto" } };
      library[a].unshift(target);
    }
    for (const key of ["name", "description"]) if (payload[key] !== undefined) target[key] = payload[key];
    if (kind === "instagram") Object.assign(target, { subtype: "ENGAGEMENT", retentionDays: payload.retentionDays, ruleSummary: "external", rule: rule(payload.profileId, "ig_business", igActivities[payload.criterion], payload.retentionDays) });
    if (kind === "website") Object.assign(target, { subtype: "WEBSITE", retentionDays: payload.retentionDays, ruleSummary: "external", rule: rule(payload.pixelId, "pixel", payload.criterion === "url" ? payload.url : payload.criterion === "event" ? payload.event : "PageView", payload.retentionDays, payload.criterion === "url" ? "url" : "event", payload.criterion === "url" ? "i_contains" : "eq") });
    if (kind === "lookalike") Object.assign(target, { subtype: "LOOKALIKE", originAudienceId: payload.originAudienceId, lookalikeSpec: { country: payload.country, ratio: payload.percentage / 100 }, capabilities: { ...caps, lookalikeSource: "unavailable" } });
    return target;
  }
  const fingerprint = (payload) => JSON.stringify(Object.fromEntries(Object.entries(payload).filter(([key]) => !["action", "confirmationToken", "commandId"].includes(key)).sort(([a], [b]) => a.localeCompare(b))));
  function audiencePost(a, payload) {
    const action = payload.action;
    const kind = action === "review" || action === "confirm" || action === "reconcile" ? "metadata" : action?.split("-")[0];
    if (!["metadata", "instagram", "website", "lookalike", "delete"].includes(kind)) return fail(`Unknown audience action: ${action}`, 501);
    const target = payload.audienceId ? find(a, payload.audienceId) : undefined;
    if ((payload.audienceId && !target) || (["metadata", "delete"].includes(kind) && !target)) return fail("Audience not in synthetic account", 404);
    if (kind === "instagram" && (!payload.name?.trim() || payload.profileId !== `ig${a}` || !Object.hasOwn(igActivities, payload.criterion) || !Number.isInteger(payload.retentionDays))) return fail("Invalid synthetic Instagram selection", 422);
    if (kind === "website" && (!payload.name?.trim() || payload.pixelId !== `pixel${a}` || !["visitors", "url", "event"].includes(payload.criterion) || !Number.isInteger(payload.retentionDays) || (payload.criterion === "event" && !webSource.observedEvents.includes(payload.event)) || (payload.criterion === "url" && !payload.url?.trim()))) return fail("Invalid synthetic website selection", 422);
    if (kind === "lookalike") {
      const origin = find(a, payload.originAudienceId);
      if (!origin || origin.subtype === "LOOKALIKE" || origin.importResult?.pendingUnresolved || !(origin.customerFileSource || ["ENGAGEMENT", "WEBSITE"].includes(origin.subtype)) || !payload.name?.trim() || !/^[A-Z]{2}$/.test(payload.country || "") || !Number.isInteger(payload.percentage) || payload.percentage < 1 || payload.percentage > 20) return fail("Ineligible synthetic lookalike source or formation", 422);
    }
    const reviewing = action === "review" || action.endsWith("-review");
    if (reviewing) {
      if (kind === "delete" && target.id.endsWith("-customer")) return fail("Exclusão impedida: público usado como origem de semelhante.");
      const token = `fixture-${a}-${++sequence}`;
      pending.set(token, { a, kind, payload: clone(payload), fingerprint: fingerprint(payload), uncertain: false });
      const common = { ok: true, confirmationToken: token, commandId: token, notice: "Revisão sintética. Confirmar altera somente a memória deste navegador." };
      if (kind === "metadata") return json({ ...common, before: { name: target.name, description: target.description }, after: { name: payload.name ?? target.name, description: payload.description ?? target.description }, impact: impact() });
      if (kind === "delete") return json({ ok: true, message: common.notice, preflight: { name: target.name, retentionDays: target.retentionDays, knownUses: [], lookalikeAudienceIds: [], coverage: "complete", limitations, confirmationToken: token } });
      if (kind === "lookalike") return json({ ...common, source: { id: payload.originAudienceId, name: find(a, payload.originAudienceId).name, subtype: find(a, payload.originAudienceId).subtype }, formation: { country: payload.country, percentage: payload.percentage, ratio: payload.percentage / 100 } });
      const after = Object.fromEntries((kind === "instagram" ? ["profileId", "criterion", "retentionDays"] : ["pixelId", "criterion", "retentionDays", "url", "event"]).filter((key) => payload[key] !== undefined).map((key) => [key, payload[key]]));
      const parsed = target?.rule?.inclusions?.rules?.[0];
      const before = target && parsed ? { ...after, retentionDays: parsed.retention_seconds / 86400, criterion: kind === "instagram" ? Object.keys(igActivities).find((c) => igActivities[c] === parsed.filter.filters[0].value) : parsed.filter.filters[0].field === "url" ? "url" : parsed.filter.filters[0].value === "PageView" ? "visitors" : "event" } : null;
      return json({ ...common, before, after, source: kind === "instagram" ? igSource : webSource, periodEvidence: (kind === "instagram" ? igEvidence(a) : webEvidence(a))[payload.criterion], impact: impact() });
    }
    if (!["confirm", "reconcile", "delete-confirm", "instagram-confirm", "instagram-reconcile", "website-confirm", "website-reconcile", "lookalike-confirm", "lookalike-reconcile"].includes(action)) return fail(`Unknown audience action: ${action}`, 501);
    const reviewed = pending.get(payload.confirmationToken);
    if (!reviewed || reviewed.a !== a || reviewed.kind !== kind || reviewed.fingerprint !== fingerprint(payload)) return fail("Review token or payload is stale or belongs to another account");
    if (config.scenario === "confirm-error") return fail("Falha sintética na confirmação; biblioteca preservada.");
    if (config.scenario === "reconcile" && !reviewed.uncertain && !action.includes("reconcile")) {
      reviewed.uncertain = true;
      return json({ ok: false, state: "reconciliation_required", message: "Resposta sintética incerta. Reconcilie o resultado.", issues: [{ code: "META_MUTATION_UNCERTAIN", reason: "Resposta sintética incerta." }] }, 409);
    }
    if (kind === "delete") library[a] = library[a].filter((item) => item.id !== payload.audienceId);
    const saved = kind === "delete" ? null : saveAudience(a, reviewed.payload, kind);
    pending.delete(payload.confirmationToken);
    return json({ ok: true, state: "confirmed", audienceId: saved?.id ?? payload.audienceId, audience: saved, message: "Operação sintética concluída; nenhuma escrita remota." });
  }
  function customerFile(a, tail, method, body) {
    if (config.scenario === "import-disabled") return fail("Importação sintética indisponível.", 503);
    if (!tail && method === "GET") return json({ operations: history[a] });
    if (!tail && method === "POST" && body instanceof FormData) {
      const file = body.get("file");
      const operation = body.get("operation");
      if (!(file instanceof Blob) || !["create", "add", "remove", "replace"].includes(operation)) return fail("Missing synthetic file or operation", 422);
      const audienceId = body.get("audienceId");
      if (operation !== "create" && find(a, audienceId)?.capabilities.manageMembers !== "available") return fail("Members capability is not proven", 403);
      if (operation === "create" && !String(body.get("name") || "").trim()) return fail("Name required", 422);
      const operationId = `upload-${a}-${++sequence}`;
      const format = /\.xlsx$/i.test(file.name || "") ? "xlsx" : "csv";
      uploads.set(operationId, { a, operation, audienceId, name: body.get("name"), description: body.get("description"), format });
      return json({ operationId, format, ...(format === "xlsx" ? { worksheets: ["Clientes", "Outra planilha"] } : { headers: ["email", "phone"] }), receivedAt: NOW, expiresAt: "2026-10-06T15:00:00.000Z", limits: formLimits, retentionNotice: "Arquivo sintético: conteúdo retido somente na memória do navegador." });
    }
    if (tail === "/terms" && method === "POST") { termsAccepted = true; return json({ accepted: true }); }
    const operationId = tail.slice(1);
    const upload = uploads.get(operationId);
    if (!upload || upload.a !== a) return fail("Unknown synthetic upload", 404);
    if (method === "GET") return json(upload.status ?? { ...status(a, upload.audienceId || ""), operationId, operation: upload.operation, state: "awaiting_confirmation", phase: "validating", previewConfirmed: false, declarationsConfirmed: false, temporaryDataAvailable: true });
    if (method !== "POST" || body instanceof FormData) return fail("Unsupported synthetic import request", 501);
    if (body.action === "inspect") return json({ headers: ["email", "phone"] });
    if (body.action === "preview") {
      if (!body.emailColumn && !body.phoneColumn) return fail("Column mapping required", 400);
      const corrected = upload.operation === "replace";
      const token = `preview-${operationId}-${++sequence}`;
      upload.previewToken = token;
      return json({ operationId, previewToken: token, adAccountId: a, audience: { id: upload.audienceId || undefined, name: upload.name || find(a, upload.audienceId)?.name, isNew: upload.operation === "create" }, operation: upload.operation, mapping: { emailColumn: body.emailColumn, phoneColumn: body.phoneColumn }, referenceCountry: body.referenceCountry, format: upload.format, worksheet: body.worksheet, samples: [{ line: 2, email: "a***@example.test", phone: "+55***0001", warnings: [] }, { line: 4, warnings: ["Sem identificador válido"] }], counts: { read: 3, valid: 2, invalid: 1, warnings: 1, duplicatesRemoved: 0 }, invalidReasons: [{ code: "NO_VALID_IDENTIFIER", message: "Sem identificador válido", count: 1 }], report: { available: false, expiresAt: "2026-10-06T15:00:00.000Z", notice: "Download de relatório não simulado." }, confirmation: { allowed: !corrected, requiresValidRowsChoice: !corrected, requiresCorrectedFile: corrected }, declarations: { dataOrigin: "USER_PROVIDED_ONLY", termsAccepted, guidance: "Aceite sintético exigido nesta conta." }, limits: formLimits });
    }
    if (body.action === "start" || body.action === "recover") {
      if (body.previewToken !== upload.previewToken || !termsAccepted || body.declarations?.dataOrigin !== "USER_PROVIDED_ONLY" || !body.declarations?.termsAccepted || !body.explicitlySendValidRows || upload.operation === "replace") return fail("Preview, valid-row choice or declarations missing; replacement requires corrected file");
      if (upload.operation === "create" && !upload.audienceId) {
        const saved = saveAudience(a, { name: upload.name, description: upload.description }, "metadata");
        Object.assign(saved, { subtype: "CUSTOM", customerFileSource: "USER_PROVIDED_ONLY", capabilities: { ...caps } });
        upload.audienceId = saved.id;
      }
      upload.status = { ...status(a, upload.audienceId, upload.operation), operationId };
      history[a].unshift(upload.status);
      return json(upload.status);
    }
    return fail(`Unknown customer-file action: ${body.action}`, 501);
  }
  function withAdSetReview(result, answers) {
    const audience = result.review.audience;
    audience.adSets = [{ ...clone(audience), index: 0, ageSource: answers.demographics?.age != null ? "applied" : "inherited", genderSource: answers.demographics?.genders != null ? "applied" : "inherited" }];
    return result;
  }
  function ai(a, action, method, payload) {
    if (method !== "POST") return fail("AI fixture requires POST", 501);
    const metrics = { spend: 1000, roas: 8, resultLabel: "Compras", resultCount: 80, costPerResult: 12.5, currency: "BRL" };
    if (action === "scan") return json({ success: true, currency: "BRL", durationPolicy: { accountState: "legacy", defaultDurationDays: 7 }, mold: { kind: "validated", adId: `ad${a}`, adName: "Anúncio sintético validado", adSetId: `adset${a}`, campaignId: `campaign${a}`, objective: "OUTCOME_SALES", metrics }, provenAds: [{ kind: "validated", adId: `ad${a}`, adName: "Anúncio sintético validado", adSetId: `adset${a}`, campaignId: `campaign${a}`, thumbnailUrl: image, isDynamicCreative: false, ...metrics }] });
    if (action === "copy") return json({ success: true, headline: "Título sintético", message: "Texto sintético, sem AI Gateway.", whatsappAutofillMessage: "Quero saber mais." });
    if (action === "plan") {
      const answers = payload.answers || {};
      const included = answers.includedCustomAudienceIds ?? [`aud${a}-customer`];
      const excluded = answers.excludedCustomAudienceIds ?? [`aud${a}-external`];
      return json(withAdSetReview({ success: true, issues: [], review: { basedOn: { kind: "validated", adName: "Anúncio sintético validado", spend: 1000, roas: 8, costPerResult: 12.5, resultLabel: "Compras", currency: "BRL" }, currency: "BRL", objective: "OUTCOME_SALES", campaignName: "Campanha sintética para revisão", structure: { adSets: 1, adsPerAdSet: 1 }, budget: { mode: "ABO", dailyCents: Math.round((answers.dailyBudget || 30) * 100), daypartingAllowed: false }, medias: (answers.medias || []).map((m) => ({ kind: m.kind, preview: m.imageUrl || image })), audience: { geo: { customLocations: 0, cities: 0, regions: 0, countries: 1, locations: [{ label: "Brasil" }] }, advantagePlus: true, interestGroups: 0, customAudiences: included.length, includedCustomAudienceIds: included, excludedCustomAudienceIds: excluded, effectiveCustomAudiences: included.filter((id) => !excluded.includes(id)).length, overlappingCustomAudiences: included.filter((id) => excluded.includes(id)).length, excludedCustomAudiences: excluded.length, includedCustomAudiencesApplied: answers.includedCustomAudienceIds !== undefined, excludedCustomAudiencesApplied: answers.excludedCustomAudienceIds !== undefined, placements: { automatic: answers.placementsMode !== "manual", platforms: ["facebook", "instagram"] }, ageMin: answers.demographics?.age?.min ?? 18, ageMax: answers.demographics?.age?.max ?? 65, genders: answers.demographics?.genders || [] }, identity: { pageId: `page${a}`, instagramUserId: `ig${a}` }, pixelId: `pixel${a}` } }, answers));
    }
    // Publication, pixel creation and uploads must never look successful.
    return fail(`AI action ${action} is deliberately blocked; this fixture only reaches review`, 403);
  }
  async function dispatch(url, method, body) {
    const userPath = url.pathname.match(/^\/api\/users\/([^/]+)(.*)$/);
    if (userPath) {
      if (decodeURIComponent(userPath[1]) !== USER || method !== "GET") return fail("Unknown user or user mutation refused", 403);
      if (userPath[2] === "/meta-account") return json({ id: "connection-fixture", userId: USER, facebookUserId: "facebook-fixture", bisuAppScopedId: null, clientBusinessId: "business-fixture", name: "Conexão Meta sintética", pictureUrl: null, tokenKind: "user", configId: null, grantedScopes: [], assignedAssets: null, connectionStatus: "active", lastValidatedAt: NOW, lastValidationError: null, partnerAccessStatus: "complete", partnerAccessDiagnosis: null, partnerAccessCheckedAt: NOW, tokenExpiresAt: null, createdAt: NOW, updatedAt: NOW, deletedAt: null });
      if (userPath[2] === "/meta-account/publish-holds") return json({ holds: [] });
      if (userPath[2] === "/meta-account/partner-access") return json({ status: "complete", diagnosis: null, checkedAt: NOW, clientBusinessId: "business-fixture", automatizeBusinessId: "business-operator-fixture", peopleUrl: null, partnersUrl: null, instructions: [] });
      if (userPath[2] === "/playbook-insights") return json({ insights: [] });
      if (userPath[2] === "/client-reports") return json({ snapshots: [] });
      if (userPath[2] === "/meta-assets") return json({ canEdit: false, limits: { adAccounts: 2, identities: 2 }, connection: { status: "active" }, selection: { status: "fixed", reason: null, requestedNote: null, since: NOW, selectedBy: "Operador sintético", mode: "explicit" }, granted: { adAccounts: accounts.map((a, i) => ({ id: `act_${a}`, name: `Conta sintética ${a}`, statusLabel: "Ativa", enabled: true, primary: i === 0 })), identities: accounts.map((a, i) => ({ pageId: `page${a}`, pageName: `Página sintética ${a}`, instagramBusinessAccountId: `ig${a}`, instagramUsername: `fixture_${a}`, pagePictureUrl: null, enabled: true, primary: i === 0 })) }, enabled: { adAccounts: accounts.map((a, i) => ({ id: `act_${a}`, name: `Conta sintética ${a}`, primary: i === 0, available: true })), identities: accounts.map((a, i) => ({ id: `ig${a}`, name: `Página sintética ${a}`, instagramUsername: `fixture_${a}`, primary: i === 0, available: true })) } });
      const money = userPath[2].match(/^\/ad-accounts\/(?:act_)?(111|222)\/money$/);
      if (money) return json({ adAccountId: money[1], name: `Conta sintética ${money[1]}`, currency: "BRL", isPrepaid: false, money: { kind: "owed", amountMajor: 0 }, accountStatus: 1, accountStatusLabel: "Ativa", fetchedAt: NOW, connectionKind: "user" });
      if (userPath[2] === "/ad-accounts") {
        if (config.scenario === "accounts-error") return fail("Falha sintética ao consultar as contas.", 503);
        return json({ data: config.scenario === "accounts-empty" ? [] : accounts.map((a, i) => ({ id: `act_${a}`, account_id: a, name: `Conta sintética ${a}`, account_status: 1, currency: "BRL", timezone_name: "America/Sao_Paulo", enabled: true, primary: i === 0 })) });
      }
      if (userPath[2] === "/company-locations") return json({ company: { id: "company-fixture", name: "Cliente sintético", niche: "retail", websiteUrl: "https://example.test/oferta" }, locations: [] });
      return fail(`Unmatched synthetic user route: ${userPath[2]}`, 501);
    }
    const match = url.pathname.match(/^\/api\/meta-marketing\/(?:act_)?(111|222)(\/.*)$/);
    if (!match || url.searchParams.get("userId") !== USER) return fail("Meta route not covered, missing synthetic user or inaccessible account", 501);
    const [, a, suffix] = match;
    if (suffix === "/audiences") {
      if (method === "POST") return audiencePost(a, body);
      if (method !== "GET") return fail("Audience method refused", 501);
      const sources = url.searchParams.get("sources");
      if (sources === "instagram") return json({ profiles: config.scenario === "sources-empty" ? [] : [{ id: `ig${a}`, username: `fixture_${a}`, name: `Instagram sintético ${a}`, source: igSource }], periodEvidence: igEvidence(a), periodEvidenceByProfile: { [`ig${a}`]: igEvidence(a) }, guidance: config.scenario === "sources-empty" ? "Nenhum perfil profissional sintético acessível." : undefined });
      if (sources === "website") return json({ sources: config.scenario === "sources-empty" ? [] : [{ id: `pixel${a}`, name: `Pixel sintético ${a}`, lastFiredTime: NOW, source: webSource }, { id: `inactive${a}`, name: "Pixel sem eventos observados", source: { ...webSource, activity: "unavailable", observedEvents: [], observedEventsStatus: "unknown" } }], events: webSource.observedEvents.map((event) => ({ pixelId: `pixel${a}`, event })), periodEvidence: { [`pixel${a}`]: webEvidence(a), [`inactive${a}`]: webEvidence(a) }, guidance: "Catálogo sintético por Pixel, sem catálogo de eventos genérico." });
      if (sources) return fail("Unknown source catalog", 501);
      if (config.scenario === "library-error") return fail("Falha sintética ao consultar a biblioteca.", 503);
      if (config.scenario === "library-empty") return json({ audiences: [], hasNextPage: false, queriedAt: NOW, limitations });
      const cursor = url.searchParams.get("after");
      if (cursor && cursor !== `fixture-${a}-page2`) return fail("Unknown or cross-account cursor", 400);
      const next = !cursor && library[a].length > 6;
      return json({ audiences: clone(cursor ? library[a].slice(6) : library[a].slice(0, 6)), hasNextPage: next, ...(next ? { nextCursor: `fixture-${a}-page2` } : {}), queriedAt: NOW, limitations });
    }
    if (suffix === "/audiences/customer-file" || suffix.startsWith("/audiences/customer-file/")) return customerFile(a, suffix.slice("/audiences/customer-file".length), method, body);
    if (suffix === "/pages" && method === "GET") return json({ pages: [{ pageId: `page${a}`, pageName: `Página sintética ${a}`, instagramBusinessAccountId: `ig${a}`, instagramUsername: `fixture_${a}`, available: true, linkage: "known_page", enabled: true, primary: true }] });
    if (suffix === "/campaigns" && method === "GET") return json({ data: [], pagination: { hasNextPage: false } });
    if (suffix === "/pixels" && method === "GET") return json({ data: [{ id: `pixel${a}`, name: `Pixel sintético ${a}`, last_fired_time: NOW }], accountName: `Conta sintética ${a}` });
    if (suffix === "/instagram/user-media" && method === "GET") return json({ media: [{ id: `media${a}`, caption: "Post sintético para testar revisão e públicos", media_type: "IMAGE", media_url: image, timestamp: NOW, like_count: 42, comments_count: 3, boost_eligibility_info: { eligible_to_boost: true } }], pagination: { hasNextPage: false }, instagramAccount: { id: `ig${a}`, username: `fixture_${a}` } });
    if (suffix === "/automatize-media" && method === "GET") return json({ media: [{ id: `image${a}`, imageUrl: image, prompt: "Fixture", aspectRatio: "1:1", createdAt: NOW }], total: 1 });
    if (suffix.startsWith("/campaigns/ai/")) return ai(a, suffix.slice("/campaigns/ai/".length), method, body);
    return fail(`Unmatched Meta fixture: ${method} ${suffix}`, 501);
  }
  window.fetch = async (input, init = {}) => {
    const request = typeof Request !== "undefined" && input instanceof Request ? input : null;
    const url = new URL(request ? request.url : String(input), window.location.href);
    const method = String(init.method || request?.method || "GET").toUpperCase();
    const covered = url.pathname === "/api/meta-marketing" || url.pathname.startsWith("/api/meta-marketing/") || url.pathname === "/api/users" || url.pathname.startsWith("/api/users/");
    const external = url.origin !== window.location.origin;
    if (!covered && !external && (!url.pathname.startsWith("/api/") || ["GET", "HEAD"].includes(method))) return nativeFetch(input, init);
    let body = init.body;
    if (request && body === undefined && !["GET", "HEAD"].includes(method)) {
      const copy = request.clone();
      body = /multipart\/form-data/i.test(copy.headers.get("content-type") || "") ? await copy.formData() : await copy.text();
    }
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    body ??= {};
    const entry = { method, path: url.pathname, query: url.search, action: body instanceof FormData ? "upload" : body.action, fixture: true };
    log.push(entry);
    let response;
    try {
      response = external ? fail("External fetch is blocked by synthetic fixture", 403) : covered ? await dispatch(url, method, body) : fail("Non-fixture API mutation blocked", 403);
    } catch (error) { response = fail(`Fixture implementation error: ${error.message}`, 500); }
    const delay = config.delayMs || (config.scenario === "slow" && method === "GET" ? 2500 : 0);
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    entry.status = response.status;
    return response;
  };
  // Fetch is the transport used by the real components. Refuse alternate API
  // transports so future changes cannot bypass fixtures unnoticed.
  if (window.XMLHttpRequest) {
    const nativeOpen = window.XMLHttpRequest.prototype.open;
    window.XMLHttpRequest.prototype.open = function (method, url, ...args) {
      const resolved = new URL(String(url), window.location.href);
      if (resolved.pathname.startsWith("/api/") || resolved.origin !== window.location.origin) throw new Error("Fixture refuses XHR API/external requests");
      return nativeOpen.call(this, method, url, ...args);
    };
  }
  if (window.navigator?.sendBeacon) {
    const nativeBeacon = window.navigator.sendBeacon.bind(window.navigator);
    window.navigator.sendBeacon = (url, data) => {
      const resolved = new URL(String(url), window.location.href);
      return resolved.pathname.startsWith("/api/") || resolved.origin !== window.location.origin ? false : nativeBeacon(url, data);
    };
  }
  window.__audienceFixture = {
    version: "1", userId: USER, accounts: clone(accounts), log,
    configure(options) { Object.assign(config, options); if (options.scenario === "terms-pending") termsAccepted = false; return clone(config); },
    inspect() { return clone({ config, library, history, requests: log, outstandingReviews: pending.size, uploads: uploads.size }); },
  };
})();
