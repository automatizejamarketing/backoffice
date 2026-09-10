declare module "bun:sqlite" {
  export class Database {
    constructor(filename: string);
    exec(sql: string): void;
    query(sql: string): { all(...values: unknown[]): unknown[] };
    close(): void;
  }
}
