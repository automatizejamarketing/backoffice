import { postgresClient } from "@/lib/db";
import { createCustomerFileDurableStore } from "./durable-store";
import { customerFileSqlFromPostgres } from "./sql-client";

export function customerFileDurableStore() {
  return createCustomerFileDurableStore(customerFileSqlFromPostgres(postgresClient));
}
