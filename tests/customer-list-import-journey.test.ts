import assert from "node:assert/strict";
import test from "node:test";

import {
  CUSTOMER_FILE_MAX_BYTES,
  CUSTOMER_LIST_SOURCE,
  CustomerFileImportError,
  type CustomerFileImportActor,
  type CustomerFileImportDependencies,
  type CustomerFileImportSelection,
  type CustomerFileImportTarget,
  customerFileImportHistory,
  customerFileImportReport,
  customerFileImportStatus,
  prepareCustomerFileImportRun,
  previewCustomerFileImport,
  receiveCustomerFileUpload,
  runCustomerFileImportPlan,
} from "../lib/customer-file/import-service";
import { openSharedCustomerFileStores } from "./helpers/customer-file-sqlite";

const CUSTOMER: CustomerFileImportActor = { kind: "user", actorId: "user-1", customerId: "user-1" };
const OTHER_CUSTOMER: CustomerFileImportActor = { kind: "user", actorId: "user-2", customerId: "user-2" };
const DECLARATIONS = { dataOrigin: CUSTOMER_LIST_SOURCE, termsAccepted: true } as const;
const EMAIL_AND_PHONE: CustomerFileImportSelection = {
  mapping: { emailColumn: "email", phoneColumn: "telefone" },
  referenceCountry: "BR",
};

function csv(...rows: string[]): Uint8Array {
  return new TextEncoder().encode(["email,telefone", ...rows].join("\r\n"));
}

type Harness = {
  deps: CustomerFileImportDependencies;
  sends: Array<{ audienceId: string; operation: string; sequence: number; rows: number }>;
  revoke: () => void;
  setTerms: (accepted: boolean) => void;
  advance: (ms: number) => void;
  cleanup: () => void;
  store: ReturnType<typeof openSharedCustomerFileStores>["storeA"];
  otherStore: ReturnType<typeof openSharedCustomerFileStores>["storeB"];
};

function harness(overrides: Partial<CustomerFileImportDependencies> = {}): Harness {
  const { storeA, storeB, cleanup } = openSharedCustomerFileStores();
  const sends: Harness["sends"] = [];
  let authorized = true;
  let terms = true;
  let current = new Date("2026-09-09T12:00:00.000Z");
  let operations = 0;

  const deps: CustomerFileImportDependencies = {
    store: storeA,
    authorize: async () => {
      if (!authorized) {
        throw new CustomerFileImportError("UNAUTHORIZED", "A permissão sobre o público foi revogada.");
      }
    },
    termsState: async () => (terms ? { accepted: true } : { accepted: false, guidance: "Aceite os termos." }),
    createAudience: async () => ({ id: "meta-list-1" }),
    send: async (request) => {
      sends.push({
        audienceId: request.audienceId,
        operation: request.operation,
        sequence: request.sequence,
        rows: request.batch.data.length,
      });
      return { num_received: request.batch.data.length };
    },
    revalidateRemote: async () => ({ safeToContinue: true }),
    reconcileCreation: async () => undefined,
    reconcileReplacement: async () => ({ safeToContinue: false }),
    newOperationId: () => `op-${(operations += 1)}`,
    now: () => current,
    ...overrides,
  };

  return {
    deps,
    sends,
    revoke: () => { authorized = false; },
    setTerms: (accepted) => { terms = accepted; },
    advance: (ms) => { current = new Date(current.getTime() + ms); },
    cleanup,
    store: storeA,
    otherStore: storeB,
  };
}

async function upload(
  test_: Harness,
  target: Partial<CustomerFileImportTarget>,
  bytes: Uint8Array,
  actor: CustomerFileImportActor = CUSTOMER,
) {
  return receiveCustomerFileUpload(
    {
      actor,
      target: { adAccountId: "act_123", operation: "create", name: "Clientes", ...target },
      bytes,
    },
    test_.deps,
  );
}

test("a jornada pública cria a lista, envia a primeira carga e elimina o material temporário", async () => {
  const harnessed = harness();
  try {
    const received = await upload(harnessed, {}, csv("cliente@example.com,11999998888", "outro@example.com,"));
    assert.deepEqual(received.headers, ["email", "telefone"]);
    assert.equal(received.limits.maxBytes, CUSTOMER_FILE_MAX_BYTES);

    const preview = await previewCustomerFileImport(
      { actor: CUSTOMER, operationId: received.operationId, selection: EMAIL_AND_PHONE },
      harnessed.deps,
    );
    assert.equal(preview.audience.isNew, true);
    assert.equal(preview.counts.read, 2);
    assert.equal(preview.counts.valid, 2);
    assert.equal(preview.referenceCountry, "BR");
    assert.equal(preview.samples[0]?.phone, "+5511999998888");
    assert.equal(preview.confirmation.allowed, true);
    assert.equal(preview.confirmation.requiresValidRowsChoice, false);

    const { plan } = await prepareCustomerFileImportRun(
      {
        actor: CUSTOMER,
        operationId: received.operationId,
        previewToken: preview.previewToken,
        selection: EMAIL_AND_PHONE,
        explicitlySendValidRows: false,
        declarations: DECLARATIONS,
      },
      harnessed.deps,
    );
    const status = await runCustomerFileImportPlan(plan, harnessed.deps);

    assert.equal(status.phase, "completed");
    assert.equal(status.audienceId, "meta-list-1");
    assert.deepEqual(harnessed.sends, [{ audienceId: "meta-list-1", operation: "add", sequence: 0, rows: 2 }]);
    assert.equal(status.availability.include, "available");
    assert.equal(
      await harnessed.store.getTemporary(received.operationId, { customerId: "user-1" }, new Date("2026-09-09T12:00:00.000Z")),
      null,
    );
    await assert.rejects(
      customerFileImportReport({ actor: CUSTOMER, operationId: received.operationId, selection: EMAIL_AND_PHONE }, harnessed.deps),
      (error: CustomerFileImportError) => error.code === "TEMPORARY_DATA_EXPIRED",
    );

    const history = await customerFileImportHistory({ actor: CUSTOMER, adAccountId: "act_123" }, harnessed.deps);
    assert.equal(history.length, 1);
    assert.equal(history[0]?.state, "completed");
    assert.equal(JSON.stringify(history).includes("example.com"), false);
  } finally {
    harnessed.cleanup();
  }
});
test("permissão revogada entre a prévia e o envio recusa a ação sem mutação e sem relatório", async () => {
  const harnessed = harness();
  try {
    const received = await upload(harnessed, { operation: "add", audienceId: "meta-list-7" }, csv("cliente@example.com,"));
    const preview = await previewCustomerFileImport(
      { actor: CUSTOMER, operationId: received.operationId, selection: EMAIL_AND_PHONE },
      harnessed.deps,
    );

    harnessed.revoke();

    await assert.rejects(
      prepareCustomerFileImportRun(
        {
          actor: CUSTOMER,
          operationId: received.operationId,
          previewToken: preview.previewToken,
          selection: EMAIL_AND_PHONE,
          explicitlySendValidRows: false,
          declarations: DECLARATIONS,
        },
        harnessed.deps,
      ),
      (error: CustomerFileImportError) => error.code === "UNAUTHORIZED",
    );
    await assert.rejects(
      customerFileImportReport({ actor: CUSTOMER, operationId: received.operationId, selection: EMAIL_AND_PHONE }, harnessed.deps),
      (error: CustomerFileImportError) => error.code === "UNAUTHORIZED",
    );
    assert.deepEqual(harnessed.sends, []);
    const stored = await harnessed.store.getOperation(received.operationId);
    assert.equal(stored?.state, "awaiting_confirmation");
    assert.equal(stored?.declarationsConfirmed, false);
  } finally {
    harnessed.cleanup();
  }
});

test("trocar o mapeamento ou o país depois da prévia exige uma nova prévia", async () => {
  const harnessed = harness();
  try {
    const received = await upload(harnessed, {}, csv("cliente@example.com,11999998888"));
    const preview = await previewCustomerFileImport(
      { actor: CUSTOMER, operationId: received.operationId, selection: EMAIL_AND_PHONE },
      harnessed.deps,
    );
    const start = (selection: CustomerFileImportSelection) =>
      prepareCustomerFileImportRun(
        {
          actor: CUSTOMER,
          operationId: received.operationId,
          previewToken: preview.previewToken,
          selection,
          explicitlySendValidRows: false,
          declarations: DECLARATIONS,
        },
        harnessed.deps,
      );

    await assert.rejects(
      start({ mapping: { emailColumn: "email" }, referenceCountry: "BR" }),
      (error: CustomerFileImportError) => error.code === "STALE_PREVIEW",
    );
    await assert.rejects(
      start({ ...EMAIL_AND_PHONE, referenceCountry: "PT" }),
      (error: CustomerFileImportError) => error.code === "STALE_PREVIEW",
    );
    assert.deepEqual(harnessed.sends, []);
  } finally {
    harnessed.cleanup();
  }
});

test("linhas inválidas seguem a regra da operação e nunca truncam em silêncio", async () => {
  const harnessed = harness();
  try {
    const file = csv("cliente@example.com,11999998888", "sem-identificador,");
    const add = await upload(harnessed, { operation: "add", audienceId: "meta-list-7" }, file);
    const addPreview = await previewCustomerFileImport(
      { actor: CUSTOMER, operationId: add.operationId, selection: EMAIL_AND_PHONE },
      harnessed.deps,
    );
    assert.equal(addPreview.counts.invalid, 1);
    assert.equal(addPreview.confirmation.requiresValidRowsChoice, true);

    const confirm = (explicitlySendValidRows: boolean) =>
      prepareCustomerFileImportRun(
        {
          actor: CUSTOMER,
          operationId: add.operationId,
          previewToken: addPreview.previewToken,
          selection: EMAIL_AND_PHONE,
          explicitlySendValidRows,
          declarations: DECLARATIONS,
        },
        harnessed.deps,
      );
    await assert.rejects(
      confirm(false),
      (error: CustomerFileImportError) => error.code === "EXPLICIT_VALID_ROWS_CONSENT_REQUIRED",
    );
    const accepted = await confirm(true);
    await runCustomerFileImportPlan(accepted.plan, harnessed.deps);
    assert.deepEqual(harnessed.sends, [{ audienceId: "meta-list-7", operation: "add", sequence: 0, rows: 1 }]);

    const replace = await upload(harnessed, { operation: "replace", audienceId: "meta-list-8" }, file);
    const replacePreview = await previewCustomerFileImport(
      { actor: CUSTOMER, operationId: replace.operationId, selection: EMAIL_AND_PHONE },
      harnessed.deps,
    );
    assert.equal(replacePreview.confirmation.requiresCorrectedFile, true);
    await assert.rejects(
      prepareCustomerFileImportRun(
        {
          actor: CUSTOMER,
          operationId: replace.operationId,
          previewToken: replacePreview.previewToken,
          selection: EMAIL_AND_PHONE,
          explicitlySendValidRows: true,
          declarations: DECLARATIONS,
        },
        harnessed.deps,
      ),
      (error: CustomerFileImportError) => error.code === "REPLACEMENT_REQUIRES_CORRECTED_FILE",
    );
    assert.equal(harnessed.sends.length, 1);
  } finally {
    harnessed.cleanup();
  }
});

test("sem linhas válidas, sem declarações ou sem termos aceitos nada é enviado à Meta", async () => {
  const harnessed = harness();
  try {
    const empty = await upload(harnessed, {}, csv("sem-identificador,"));
    const emptyPreview = await previewCustomerFileImport(
      { actor: CUSTOMER, operationId: empty.operationId, selection: EMAIL_AND_PHONE },
      harnessed.deps,
    );
    assert.equal(emptyPreview.confirmation.allowed, false);

    const valid = await upload(harnessed, {}, csv("cliente@example.com,"));
    const validPreview = await previewCustomerFileImport(
      { actor: CUSTOMER, operationId: valid.operationId, selection: EMAIL_AND_PHONE },
      harnessed.deps,
    );
    const confirm = (declarations: { dataOrigin: typeof CUSTOMER_LIST_SOURCE; termsAccepted: boolean }) =>
      prepareCustomerFileImportRun(
        {
          actor: CUSTOMER,
          operationId: valid.operationId,
          previewToken: validPreview.previewToken,
          selection: EMAIL_AND_PHONE,
          explicitlySendValidRows: false,
          declarations,
        },
        harnessed.deps,
      );

    await assert.rejects(
      confirm({ dataOrigin: CUSTOMER_LIST_SOURCE, termsAccepted: false }),
      (error: CustomerFileImportError) => error.code === "DECLARATIONS_REQUIRED",
    );
    harnessed.setTerms(false);
    await assert.rejects(
      confirm(DECLARATIONS),
      (error: CustomerFileImportError) => error.code === "TERMS_PENDING",
    );
    assert.deepEqual(harnessed.sends, []);
  } finally {
    harnessed.cleanup();
  }
});

test("um identificador de outro cliente não abre prévia, relatório nem acompanhamento", async () => {
  const harnessed = harness();
  try {
    const received = await upload(harnessed, {}, csv("cliente@example.com,"));
    for (const call of [
      previewCustomerFileImport({ actor: OTHER_CUSTOMER, operationId: received.operationId, selection: EMAIL_AND_PHONE }, harnessed.deps),
      customerFileImportReport({ actor: OTHER_CUSTOMER, operationId: received.operationId, selection: EMAIL_AND_PHONE }, harnessed.deps),
      customerFileImportStatus({ actor: OTHER_CUSTOMER, operationId: received.operationId }, harnessed.deps),
    ]) {
      await assert.rejects(call, (error: CustomerFileImportError) => error.code === "NOT_FOUND");
    }
  } finally {
    harnessed.cleanup();
  }
});

test("o relatório de correção não vira fórmula executável e morre com o material temporário", async () => {
  const harnessed = harness();
  try {
    const received = await upload(harnessed, {}, csv("=CMD()|'/c calc'!A1,11999998888", "cliente@example.com,"));
    const report = await customerFileImportReport(
      { actor: CUSTOMER, operationId: received.operationId, selection: EMAIL_AND_PHONE },
      harnessed.deps,
    );
    assert.equal(report.csv.includes('"\'=CMD()'), true);
    assert.equal(report.csv.includes('"=CMD()'), false);

    harnessed.advance(24 * 60 * 60 * 1000 + 1);
    assert.equal(await harnessed.store.discardExpiredTemporary(new Date(Date.parse("2026-09-10T12:00:01.000Z"))), 1);
    await assert.rejects(
      customerFileImportReport({ actor: CUSTOMER, operationId: received.operationId, selection: EMAIL_AND_PHONE }, harnessed.deps),
      (error: CustomerFileImportError) => error.code === "TEMPORARY_DATA_EXPIRED",
    );
    const status = await customerFileImportStatus({ actor: CUSTOMER, operationId: received.operationId }, harnessed.deps);
    assert.equal(status.temporaryDataAvailable, false);
  } finally {
    harnessed.cleanup();
  }
});

test("um segundo envio sobre o mesmo público é recusado com a operação em andamento", async () => {
  const harnessed = harness();
  try {
    const first = await upload(harnessed, { operation: "add", audienceId: "meta-list-7" }, csv("cliente@example.com,"));
    assert.ok(await harnessed.otherStore.acquire(first.operationId, "meta-list-7", new Date("2026-09-09T12:00:00.000Z")));

    await assert.rejects(
      upload(harnessed, { operation: "remove", audienceId: "meta-list-7" }, csv("cliente@example.com,")),
      (error: CustomerFileImportError) => error.code === "IMPORT_IN_PROGRESS",
    );
    const other = await upload(harnessed, { operation: "add", audienceId: "meta-list-9" }, csv("cliente@example.com,"));
    assert.ok(other.operationId);
  } finally {
    harnessed.cleanup();
  }
});

test("um arquivo acima do teto de bytes é recusado antes de qualquer leitura de contatos", async () => {
  const harnessed = harness();
  try {
    await assert.rejects(
      upload(harnessed, {}, new Uint8Array(CUSTOMER_FILE_MAX_BYTES + 1)),
      (error: CustomerFileImportError) => error.code === "FILE_TOO_LARGE",
    );
    assert.deepEqual(await customerFileImportHistory({ actor: CUSTOMER }, harnessed.deps), []);
  } finally {
    harnessed.cleanup();
  }
});

test("uma lista criada cuja primeira carga falhou continua identificada com o estado correto", async () => {
  const harnessed = harness({
    send: async () => { throw new Error("timeout"); },
  });
  try {
    const received = await upload(harnessed, {}, csv("cliente@example.com,"));
    const preview = await previewCustomerFileImport(
      { actor: CUSTOMER, operationId: received.operationId, selection: EMAIL_AND_PHONE },
      harnessed.deps,
    );
    const { plan } = await prepareCustomerFileImportRun(
      {
        actor: CUSTOMER,
        operationId: received.operationId,
        previewToken: preview.previewToken,
        selection: EMAIL_AND_PHONE,
        explicitlySendValidRows: false,
        declarations: DECLARATIONS,
      },
      harnessed.deps,
    );
    const status = await runCustomerFileImportPlan(plan, harnessed.deps);

    assert.equal(status.phase, "partial_or_unknown");
    assert.equal(status.audienceId, "meta-list-1");
    assert.equal(status.pendingUnresolved, true);
    assert.equal(status.availability.lookalikeSource, "blocked");
    const history = await customerFileImportHistory({ actor: CUSTOMER, adAccountId: "act_123" }, harnessed.deps);
    assert.equal(history[0]?.audienceId, "meta-list-1");
  } finally {
    harnessed.cleanup();
  }
});

test("uma recuperação sem evidência remota não reenvia um lote incerto", async () => {
  let attempts = 0;
  const harnessed = harness({
    send: async () => { attempts += 1; throw new Error("timeout"); },
    revalidateRemote: async (request) => ({ safeToContinue: request?.state === "awaiting_confirmation" }),
  });
  try {
    const received = await upload(harnessed, {}, csv("cliente@example.com,"));
    const selection = await previewCustomerFileImport(
      { actor: CUSTOMER, operationId: received.operationId, selection: EMAIL_AND_PHONE },
      harnessed.deps,
    );
    const start = await prepareCustomerFileImportRun(
      {
        actor: CUSTOMER,
        operationId: received.operationId,
        previewToken: selection.previewToken,
        selection: EMAIL_AND_PHONE,
        explicitlySendValidRows: false,
        declarations: DECLARATIONS,
      },
      harnessed.deps,
    );
    await runCustomerFileImportPlan(start.plan, harnessed.deps);

    harnessed.advance(16 * 60 * 1000);
    const recoveryPreview = await previewCustomerFileImport(
      { actor: CUSTOMER, operationId: received.operationId, selection: EMAIL_AND_PHONE },
      harnessed.deps,
    );
    const recovery = await prepareCustomerFileImportRun(
      {
        actor: CUSTOMER,
        operationId: received.operationId,
        previewToken: recoveryPreview.previewToken,
        selection: EMAIL_AND_PHONE,
        explicitlySendValidRows: false,
        declarations: DECLARATIONS,
        stage: "recover",
      },
      harnessed.deps,
    );
    const status = await runCustomerFileImportPlan(recovery.plan, harnessed.deps);

    assert.equal(status.phase, "action_required");
    assert.equal(attempts, 1);
  } finally {
    harnessed.cleanup();
  }
});
