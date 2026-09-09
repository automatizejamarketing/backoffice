import { randomUUID } from "node:crypto";

import { CUSTOMER_FILE_LEASE_MS, CUSTOMER_FILE_RETENTION_MS } from "./constants";
import {
  assertSanitizedHistory,
  parseJsonObject,
  parseNumberArray,
  parseReceipts,
  type SanitizedCustomerFileHistory,
} from "./sanitize";
import type { CustomerFileSqlClient } from "./sql-client";
import type {
  CustomerFileConflict,
  CustomerFileDurableStore,
  CustomerFilePersistedRecord,
  CustomerFileTemporaryMaterial,
} from "./types";

type CoordinationRow = {
  audience_identity: string;
  operation_id: string;
  executor_token: string | null;
  lease_until: Date | string | null;
};

type OperationRow = {
  id: string;
  actor_kind: string;
  actor_id: string | null;
  customer_id: string | null;
  ad_account_id: string | null;
  audience_identity: string;
  audience_id: string | null;
  audience_name: string | null;
  operation_type: string;
  state: string;
  received_at: Date | string;
  updated_at: Date | string;
  preview_confirmed: boolean | number;
  declarations_confirmed: boolean | number;
  counts: unknown;
  receipts: unknown;
  confirmed_batches: unknown;
  session_id: string | null;
  pending_unresolved: boolean | number;
};

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

function jsonParam(client: CustomerFileSqlClient, value: unknown): unknown {
  const text = JSON.stringify(value);
  return client.dialect === "postgres" ? text : text;
}

function operationTypeOf(record: CustomerFilePersistedRecord, existing?: string): string {
  if ("operation" in record && record.operation) return record.operation;
  if ("name" in record && record.name) return "create";
  if ("sessionStartedAt" in record && record.sessionStartedAt) return "replace";
  return existing ?? "add";
}

function pendingOf(state: string): boolean {
  return state === "partial" || state === "unknown" || state === "action_required";
}

function historyFromRow(row: OperationRow): SanitizedCustomerFileHistory {
  const history: SanitizedCustomerFileHistory = {
    id: row.id,
    actorKind: row.actor_kind === "backoffice" ? "backoffice" : "user",
    actorId: row.actor_id,
    customerId: row.customer_id,
    adAccountId: row.ad_account_id,
    audienceIdentity: row.audience_identity,
    audienceId: row.audience_id,
    audienceName: row.audience_name,
    operation: row.operation_type,
    state: row.state,
    receivedAt: asDate(row.received_at) ?? new Date(0),
    updatedAt: asDate(row.updated_at) ?? new Date(0),
    counts: parseJsonObject(row.counts),
    previewConfirmed: Boolean(row.preview_confirmed),
    declarationsConfirmed: Boolean(row.declarations_confirmed),
    receipts: parseReceipts(row.receipts),
    confirmedBatches: parseNumberArray(row.confirmed_batches),
    sessionId: row.session_id,
    pendingUnresolved: Boolean(row.pending_unresolved),
  };
  assertSanitizedHistory(history);
  return history;
}

export function createCustomerFileDurableStore(
  sql: CustomerFileSqlClient,
): CustomerFileDurableStore {
  const store: CustomerFileDurableStore = {
    async acquire(operationId, audienceIdentity, now) {
      const token = randomUUID();
      const leaseUntil = new Date(now.getTime() + CUSTOMER_FILE_LEASE_MS);
      const rows = await sql.query<{ executor_token: string }>(
        `INSERT INTO customer_file_coordination (
           audience_identity, operation_id, executor_token, lease_until, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $5)
         ON CONFLICT (audience_identity) DO UPDATE SET
           executor_token = EXCLUDED.executor_token,
           lease_until = EXCLUDED.lease_until,
           updated_at = EXCLUDED.updated_at
         WHERE customer_file_coordination.operation_id = EXCLUDED.operation_id
           AND (
             customer_file_coordination.lease_until IS NULL
             OR customer_file_coordination.lease_until <= EXCLUDED.updated_at
           )
         RETURNING executor_token`,
        [audienceIdentity, operationId, token, leaseUntil.toISOString(), now.toISOString()],
      );
      const won = rows[0]?.executor_token === token;
      return won ? { token } : null;
    },

    async stillOwns(operationId, token, now) {
      const leaseUntil = new Date(now.getTime() + CUSTOMER_FILE_LEASE_MS);
      const rows = await sql.query<{ executor_token: string }>(
        `UPDATE customer_file_coordination
         SET lease_until = $4, updated_at = $3
         WHERE operation_id = $1 AND executor_token = $2 AND lease_until > $3
         RETURNING executor_token`,
        [operationId, token, now.toISOString(), leaseUntil.toISOString()],
      );
      return rows.length > 0;
    },

    async bindAudienceIdentity(operationId, token, audienceIdentity, now) {
      return sql.transaction(async (tx) => {
        if (!(await storeOwns(tx, operationId, token, now))) return false;
        const current = await tx.query<CoordinationRow>(
          `SELECT audience_identity, operation_id, executor_token, lease_until
           FROM customer_file_coordination
           WHERE operation_id = $1 AND executor_token = $2`,
          [operationId, token],
        );
        const owned = current[0];
        if (!owned) return false;
        if (owned.audience_identity !== audienceIdentity) {
          const moved = await tx.query<{ audience_identity: string }>(
            `INSERT INTO customer_file_coordination (
               audience_identity, operation_id, executor_token, lease_until, created_at, updated_at
             ) VALUES ($1, $2, $3, $4, $5, $5)
             ON CONFLICT (audience_identity) DO UPDATE SET
               executor_token = EXCLUDED.executor_token,
               lease_until = EXCLUDED.lease_until,
               updated_at = EXCLUDED.updated_at
             WHERE customer_file_coordination.operation_id = EXCLUDED.operation_id
             RETURNING audience_identity`,
            [
              audienceIdentity,
              operationId,
              owned.executor_token,
              asDate(owned.lease_until)?.toISOString() ?? now.toISOString(),
              now.toISOString(),
            ],
          );
          if (!moved[0]) return false;
          await tx.query(
            `DELETE FROM customer_file_coordination
             WHERE audience_identity = $1 AND operation_id = $2`,
            [owned.audience_identity, operationId],
          );
        }
        await tx.query(
          `UPDATE customer_file_operations
           SET audience_identity = $2, audience_id = $2, updated_at = $3
           WHERE id = $1`,
          [operationId, audienceIdentity, now.toISOString()],
        );
        return true;
      });
    },

    async save(record) {
      const existing = await sql.query<{ operation_type: string; received_at: Date | string }>(
        `SELECT operation_type, received_at FROM customer_file_operations WHERE id = $1`,
        [record.id],
      );
      const receivedAt = asDate(existing[0]?.received_at) ?? record.receivedAt;
      const operation = operationTypeOf(record, existing[0]?.operation_type);
      const customerId = "customerId" in record ? record.customerId : undefined;
      const adAccountId = "adAccountId" in record ? record.adAccountId : undefined;
      const actorKind = "actorKind" in record && record.actorKind === "backoffice" ? "backoffice" : "user";
      const actorId = "actorId" in record ? record.actorId ?? null : null;
      const name = "name" in record ? record.name ?? null : null;
      const description = "description" in record ? record.description ?? null : null;
      const sessionStartedAt = "sessionStartedAt" in record ? record.sessionStartedAt : undefined;
      const now = new Date();
      await sql.query(
        `INSERT INTO customer_file_operations (
           id, actor_kind, actor_id, customer_id, ad_account_id, audience_identity, audience_id,
           audience_name, operation_type, state, received_at, created_at, updated_at,
           preview_confirmed, declarations_confirmed, counts, session_id, session_started_at,
           confirmed_batches, receipts, pending_unresolved, name, description
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22
         )
         ON CONFLICT (id) DO UPDATE SET
           actor_kind = COALESCE(EXCLUDED.actor_kind, customer_file_operations.actor_kind),
           actor_id = COALESCE(EXCLUDED.actor_id, customer_file_operations.actor_id),
           customer_id = COALESCE(EXCLUDED.customer_id, customer_file_operations.customer_id),
           ad_account_id = COALESCE(EXCLUDED.ad_account_id, customer_file_operations.ad_account_id),
           audience_identity = COALESCE(EXCLUDED.audience_identity, customer_file_operations.audience_identity),
           audience_id = COALESCE(EXCLUDED.audience_id, customer_file_operations.audience_id),
           operation_type = COALESCE(EXCLUDED.operation_type, customer_file_operations.operation_type),
           state = EXCLUDED.state,
           received_at = customer_file_operations.received_at,
           updated_at = EXCLUDED.updated_at,
           session_id = COALESCE(EXCLUDED.session_id, customer_file_operations.session_id),
           session_started_at = COALESCE(EXCLUDED.session_started_at, customer_file_operations.session_started_at),
           preview_confirmed = EXCLUDED.preview_confirmed OR customer_file_operations.preview_confirmed,
           declarations_confirmed = EXCLUDED.declarations_confirmed OR customer_file_operations.declarations_confirmed,
           counts = COALESCE(NULLIF(EXCLUDED.counts, '{}'), customer_file_operations.counts),
           confirmed_batches = EXCLUDED.confirmed_batches,
           receipts = EXCLUDED.receipts,
           pending_unresolved = CASE
             WHEN EXCLUDED.state IN ('completed', 'failed_before_mutation') THEN $23
             WHEN EXCLUDED.state IN ('partial', 'unknown', 'action_required') THEN $24
             ELSE customer_file_operations.pending_unresolved
           END,
           name = COALESCE(EXCLUDED.name, customer_file_operations.name),
           description = COALESCE(EXCLUDED.description, customer_file_operations.description)`,
        [
          record.id,
          actorKind,
          actorId,
          customerId ?? null,
          adAccountId ?? null,
          record.audienceIdentity,
          "audienceId" in record ? record.audienceId ?? null : null,
          null,
          operation,
          record.state,
          receivedAt.toISOString(),
          now.toISOString(),
          "previewConfirmed" in record ? Boolean(record.previewConfirmed) : false,
          "declarationsConfirmed" in record ? Boolean(record.declarationsConfirmed) : false,
          jsonParam(sql, parseJsonObject("counts" in record ? record.counts : {})),
          record.sessionId ?? null,
          sessionStartedAt?.toISOString() ?? null,
          jsonParam(sql, record.confirmedBatches ?? []),
          jsonParam(sql, parseReceipts(record.receipts ?? [])),
          pendingOf(record.state),
          name,
          description,
          false,
          true,
        ],
      );
      if ("rows" in record && record.rows) {
        await store.putTemporary(record.id, { rows: record.rows }, receivedAt);
      }
      if (record.state === "completed" || record.state === "failed_before_mutation") {
        await sql.query(
          `DELETE FROM customer_file_coordination WHERE operation_id = $1`,
          [record.id],
        );
      }
    },

    async discardTemporary(operationId) {
      await sql.query(`DELETE FROM customer_file_temporary_material WHERE operation_id = $1`, [operationId]);
    },

    async putTemporary(operationId, material, receivedAt) {
      const expiresAt = new Date(receivedAt.getTime() + CUSTOMER_FILE_RETENTION_MS);
      await sql.query(
        `INSERT INTO customer_file_temporary_material (
           operation_id, received_at, expires_at, raw_file, normalized_rows, hashes,
           error_samples, correction_report, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $2)
         ON CONFLICT (operation_id) DO UPDATE SET
           raw_file = COALESCE(EXCLUDED.raw_file, customer_file_temporary_material.raw_file),
           normalized_rows = COALESCE(EXCLUDED.normalized_rows, customer_file_temporary_material.normalized_rows),
           hashes = COALESCE(EXCLUDED.hashes, customer_file_temporary_material.hashes),
           error_samples = COALESCE(EXCLUDED.error_samples, customer_file_temporary_material.error_samples),
           correction_report = COALESCE(EXCLUDED.correction_report, customer_file_temporary_material.correction_report)`,
        [
          operationId,
          receivedAt.toISOString(),
          expiresAt.toISOString(),
          material.rawFile ? Buffer.from(material.rawFile).toString("base64") : null,
          material.rows ? jsonParam(sql, material.rows) : null,
          material.hashes ? jsonParam(sql, material.hashes) : null,
          material.errorSamples ? jsonParam(sql, material.errorSamples) : null,
          material.report ?? null,
        ],
      );
    },

    async getTemporary(operationId, access, now) {
      const owner = await sql.query<{ customer_id: string | null }>(
        `SELECT customer_id FROM customer_file_operations WHERE id = $1`,
        [operationId],
      );
      if (owner[0]?.customer_id && owner[0].customer_id !== access.customerId) return null;
      const rows = await sql.query<{
        received_at: Date | string;
        expires_at: Date | string;
        raw_file: string | null;
        normalized_rows: unknown;
        hashes: unknown;
        error_samples: unknown;
        correction_report: string | null;
      }>(
        `SELECT received_at, expires_at, raw_file, normalized_rows, hashes, error_samples, correction_report
         FROM customer_file_temporary_material
         WHERE operation_id = $1`,
        [operationId],
      );
      const row = rows[0];
      if (!row) return null;
      const expiresAt = asDate(row.expires_at);
      if (!expiresAt || expiresAt <= now) return null;
      return {
        receivedAt: asDate(row.received_at) ?? new Date(0),
        expiresAt,
        rawFile: row.raw_file ? new Uint8Array(Buffer.from(row.raw_file, "base64")) : null,
        rows: parseIdentifierRows(row.normalized_rows),
        hashes: parseStringArray(row.hashes),
        errorSamples: parseStringArray(row.error_samples),
        report: row.correction_report ?? undefined,
      };
    },

    async getConflict(audienceIdentity) {
      const rows = await sql.query<CustomerFileConflict & { audience_identity: string; state: string }>(
        `SELECT c.operation_id AS "operationId", o.state, c.audience_identity AS "audienceIdentity"
         FROM customer_file_coordination c
         LEFT JOIN customer_file_operations o ON o.id = c.operation_id
         WHERE c.audience_identity = $1`,
        [audienceIdentity],
      );
      const row = rows[0];
      if (!row) return null;
      return { operationId: row.operationId, state: row.state ?? "running", audienceIdentity };
    },

    async releaseAfterReconciliation(audienceIdentity, operationId) {
      await sql.query(
        `DELETE FROM customer_file_coordination
         WHERE audience_identity = $1 AND operation_id = $2`,
        [audienceIdentity, operationId],
      );
    },

    async listHistory(customerId) {
      const rows = await sql.query<OperationRow>(
        `SELECT id, actor_kind, actor_id, customer_id, ad_account_id, audience_identity, audience_id,
                audience_name, operation_type, state, received_at, updated_at, preview_confirmed,
                declarations_confirmed, counts, receipts, confirmed_batches, session_id, pending_unresolved
         FROM customer_file_operations
         WHERE customer_id = $1
         ORDER BY received_at DESC`,
        [customerId],
      );
      return rows.map(historyFromRow);
    },

    async getOperation(operationId) {
      const rows = await sql.query<OperationRow>(
        `SELECT id, actor_kind, actor_id, customer_id, ad_account_id, audience_identity, audience_id,
                audience_name, operation_type, state, received_at, updated_at, preview_confirmed,
                declarations_confirmed, counts, receipts, confirmed_batches, session_id, pending_unresolved
         FROM customer_file_operations WHERE id = $1`,
        [operationId],
      );
      return rows[0] ? historyFromRow(rows[0]) : null;
    },

    async discardExpiredTemporary(now) {
      const rows = await sql.query<{ operation_id: string }>(
        `DELETE FROM customer_file_temporary_material WHERE expires_at <= $1 RETURNING operation_id`,
        [now.toISOString()],
      );
      return rows.length;
    },

    async deactivateCustomer(_customerId) {
      // History stays while the Automatize customer row exists.
    },

    async deleteHistoryForCustomer(customerId) {
      await sql.transaction(async (tx) => {
        await tx.query(
          `DELETE FROM customer_file_temporary_material
           WHERE operation_id IN (SELECT id FROM customer_file_operations WHERE customer_id = $1)`,
          [customerId],
        );
        await tx.query(
          `DELETE FROM customer_file_coordination
           WHERE operation_id IN (SELECT id FROM customer_file_operations WHERE customer_id = $1)`,
          [customerId],
        );
        await tx.query(`DELETE FROM customer_file_operations WHERE customer_id = $1`, [customerId]);
      });
    },

    async markAudienceDeleted(audienceId) {
      await sql.query(
        `UPDATE customer_file_operations
         SET audience_name = COALESCE(audience_name, audience_identity), updated_at = $2
         WHERE audience_id = $1 OR audience_identity = $1`,
        [audienceId, new Date().toISOString()],
      );
    },
  };

  return store;
}

async function storeOwns(
  sql: CustomerFileSqlClient,
  operationId: string,
  token: string,
  now: Date,
): Promise<boolean> {
  const rows = await sql.query<{ executor_token: string }>(
    `SELECT executor_token FROM customer_file_coordination
     WHERE operation_id = $1 AND executor_token = $2 AND lease_until > $3`,
    [operationId, token, now.toISOString()],
  );
  return rows.length > 0;
}

function parseIdentifierRows(value: unknown): Array<{ email?: string; phone?: string }> {
  const items = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    return [{
      ...(typeof item.email === "string" ? { email: item.email } : {}),
      ...(typeof item.phone === "string" ? { phone: item.phone } : {}),
    }];
  });
}

function parseStringArray(value: unknown): string[] {
  const items = typeof value === "string" ? JSON.parse(value) : value;
  return Array.isArray(items) ? items.filter((item): item is string => typeof item === "string") : [];
}

export type { CustomerFileTemporaryMaterial };
