export type CustomerFileSqlClient = {
  dialect: "postgres" | "sqlite";
  query<T>(text: string, values?: unknown[]): Promise<T[]>;
  transaction<T>(fn: (tx: CustomerFileSqlClient) => Promise<T>): Promise<T>;
};

type PostgresUnsafe = {
  unsafe: (query: string, params?: unknown[]) => Promise<unknown>;
  begin: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
};

export function customerFileSqlFromPostgres(sql: unknown): CustomerFileSqlClient {
  const asClient = (raw: unknown): CustomerFileSqlClient => {
    const pg = raw as PostgresUnsafe;
    return {
      dialect: "postgres",
      query: async <T>(text: string, values: unknown[] = []): Promise<T[]> => {
        const rows = await pg.unsafe(text, values);
        return rows as T[];
      },
      transaction: (fn) => pg.begin((tx) => fn(asClient(tx))),
    };
  };
  return asClient(sql);
}
