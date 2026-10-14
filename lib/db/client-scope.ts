import { inArray, notInArray, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { ClientScope } from "@/lib/auth/rbac-core";

/** Condição SQL do escopo de clientes do ator sobre uma coluna `user_id`. */
export function clientScopeCondition(userIdColumn: AnyPgColumn, scope: ClientScope): SQL | undefined {
  if ("only" in scope) return scope.only.length ? inArray(userIdColumn, scope.only) : sql`false`;
  return scope.except.length ? notInArray(userIdColumn, scope.except) : undefined;
}
