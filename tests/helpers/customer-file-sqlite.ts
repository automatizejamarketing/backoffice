import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createCustomerFileDurableStore } from "@/lib/customer-file/durable-store";
import type { CustomerFileSqlClient } from "@/lib/customer-file/sql-client";
import type { CustomerFileDurableStore } from "@/lib/customer-file/types";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS customer_file_operations (
  id TEXT PRIMARY KEY,
  actor_kind TEXT NOT NULL DEFAULT 'user',
  actor_id TEXT,
  customer_id TEXT,
  ad_account_id TEXT,
  audience_identity TEXT NOT NULL,
  audience_id TEXT,
  audience_name TEXT,
  operation_type TEXT NOT NULL DEFAULT 'add',
  state TEXT NOT NULL,
  received_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  preview_confirmed INTEGER NOT NULL DEFAULT 0,
  declarations_confirmed INTEGER NOT NULL DEFAULT 0,
  customer_file_source TEXT,
  counts TEXT NOT NULL DEFAULT '{}',
  session_id TEXT,
  session_started_at TEXT,
  confirmed_batches TEXT NOT NULL DEFAULT '[]',
  receipts TEXT NOT NULL DEFAULT '[]',
  pending_unresolved INTEGER NOT NULL DEFAULT 0,
  name TEXT,
  description TEXT
);
CREATE TABLE IF NOT EXISTS customer_file_coordination (
  audience_identity TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL,
  executor_token TEXT,
  lease_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS customer_file_temporary_material (
  operation_id TEXT PRIMARY KEY,
  received_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  raw_file TEXT,
  normalized_rows TEXT,
  hashes TEXT,
  error_samples TEXT,
  correction_report TEXT,
  created_at TEXT NOT NULL
);
`;

export function applyCustomerFileSqliteSchema(database: Database): void {
  database.exec(SCHEMA);
}
export function customerFileSqlFromSqlite(database: Database): CustomerFileSqlClient {
  const client: CustomerFileSqlClient = {
    dialect: "sqlite",
    query: async (text, values = []) => {
      const bound: unknown[] = [];
      const converted = text.replace(/\$(\d+)/g, (_match, index: string) => {
        bound.push(values[Number(index) - 1]);
        return "?";
      });
      const started = Date.now();
      while (true) {
        try {
          return database.query(converted).all(...bound) as never;
        } catch (error) {
          const busy = error instanceof Error && /locked|BUSY/i.test(error.message);
          if (!busy || Date.now() - started > 2_000) throw error;
          await new Promise((resolve) => setTimeout(resolve, 15));
        }
      }
    },
    transaction: async (fn) => {
      const started = Date.now();
      while (true) {
        try {
          database.exec("BEGIN IMMEDIATE");
          break;
        } catch (error) {
          const busy = error instanceof Error && /locked|BUSY/i.test(error.message);
          if (!busy || Date.now() - started > 2_000) throw error;
          await new Promise((resolve) => setTimeout(resolve, 15));
        }
      }
      try {
        const result = await fn(client);
        database.exec("COMMIT");
        return result;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return client;
}

export function openSharedCustomerFileStores(): {
  storeA: CustomerFileDurableStore;
  storeB: CustomerFileDurableStore;
  cleanup: () => void;
} {
  const directory = mkdtempSync(join(tmpdir(), "customer-file-store-"));
  const path = join(directory, "store.sqlite");
  const first = new Database(path);
  first.exec("PRAGMA journal_mode = WAL");
  first.exec("PRAGMA busy_timeout = 5000");
  applyCustomerFileSqliteSchema(first);
  const second = new Database(path);
  second.exec("PRAGMA journal_mode = WAL");
  second.exec("PRAGMA busy_timeout = 5000");
  return {
    storeA: createCustomerFileDurableStore(customerFileSqlFromSqlite(first)),
    storeB: createCustomerFileDurableStore(customerFileSqlFromSqlite(second)),
    cleanup: () => {
      first.close();
      second.close();
    },
  };
}
