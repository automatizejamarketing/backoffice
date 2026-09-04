/**
 * Auditoria do journal de migrations contra o estado real do banco.
 *
 * Por que isto existe: o `drizzle-kit migrate` decide o que rodar comparando o
 * `when` de cada entrada do journal com UMA marca d'água — o `max(created_at)`
 * de `drizzle.__drizzle_migrations` — e não com o conjunto do que já foi
 * aplicado. O laço dele é literalmente
 * `if (!last || Number(last.created_at) < migration.folderMillis)`.
 *
 * Isso funciona enquanto os `when` só crescem. Aqui eles não crescem: o banco é
 * compartilhado entre `backoffice` e `automatize-frontend`, os dois escrevem na
 * MESMA tabela de controle, e cada branch escolhe seu `when` na mão. Uma
 * migration cujo `when` caia abaixo de uma marca d'água já levantada por outra
 * branch — ou pelo repositório irmão — é pulada em silêncio, para sempre, com o
 * comando saindo 0 e imprimindo que não havia nada a fazer.
 *
 * Foi assim que `0044_meta_tracking_foundation` (`when=1793200000000`) nunca
 * criou as sete tabelas `meta_tracking_*` em produção: quando ela foi mesclada,
 * a marca d'água já estava em `1793300000000`, vinda do
 * `0054_marketplace_fee_checkout_channel` do frontend. Em staging a ordem das
 * branches calhou de dar certo e as tabelas existem — daí o sintoma aparecer só
 * em produção, como 500 em `/api/meta-marketing/[accountId]/tracking-history`
 * (`42P01 relation "meta_tracking_change_events" does not exist`).
 *
 * O critério de "esta migration foi aplicada?" NÃO é o hash e NÃO é a marca
 * d'água. É abrir o `.sql`, extrair os objetos que ele cria e perguntar ao
 * banco se eles existem. Hash mente quando os dois repositórios aplicam
 * arquivos byte-idênticos sob `when` diferentes (aí o hash bate mas o `when`
 * registrado é outro), e mente de novo quando um arquivo é editado depois de
 * aplicado. A marca d'água mente por construção — é ela o bug.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type JournalEntry = { tag: string; when: number };

export type MigrationFile = {
  tag: string;
  when: number;
  sql: string;
  /** Todas as grafias do hash que este arquivo pode ter no banco. */
  hashes: string[];
};

export type ColumnTarget = { table: string; column: string };

export type DdlTargets = { tables: string[]; columns: ColumnTarget[] };

/**
 * - `applied`: o hash está registrado.
 * - `pending`: não está registrado, mas o `when` está acima da marca d'água —
 *   o próximo `db:migrate` aplica normalmente.
 * - `skipped`: não está registrado e o `when` está abaixo ou igual à marca
 *   d'água. O drizzle nunca mais vai rodar esta entrada.
 */
export type MigrationState = "applied" | "pending" | "skipped";

export type AuditRow = {
  tag: string;
  when: number;
  state: MigrationState;
  missingTables: string[];
  missingColumns: ColumnTarget[];
};

/**
 * `skipped` com objeto faltando é a assinatura exata do bug: o drizzle desistiu
 * da entrada e o banco não tem o que ela criaria. `skipped` sem objeto faltando
 * é o caso benigno e comum — o repositório irmão aplicou o mesmo DDL sob outro
 * `when`.
 */
export function isBroken(row: AuditRow): boolean {
  return (
    row.state !== "applied" &&
    (row.missingTables.length > 0 || row.missingColumns.length > 0)
  );
}

/**
 * Remove comentários preservando literais. Sem isto, `-- sete CREATE TABLE
 * novos` num cabeçalho vira uma tabela chamada `novos` na extração de alvos.
 * Precisa entender `$$…$$` porque oito migrations usam blocos `DO`.
 */
export function stripSqlComments(sql: string): string {
  let out = "";
  let i = 0;

  while (i < sql.length) {
    const rest = sql.slice(i);

    if (rest.startsWith("--")) {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end;
      continue;
    }

    if (rest.startsWith("/*")) {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
      continue;
    }

    const dollar = /^\$([a-zA-Z_][a-zA-Z0-9_]*)?\$/.exec(rest);
    if (dollar) {
      const tag = dollar[0];
      const end = sql.indexOf(tag, i + tag.length);
      const stop = end === -1 ? sql.length : end + tag.length;
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }

    if (sql[i] === "'" || sql[i] === '"') {
      const quote = sql[i];
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === quote) {
          // Aspas dobradas escapam a si mesmas nos dois casos.
          if (sql[j + 1] === quote) {
            j += 2;
            continue;
          }
          j += 1;
          break;
        }
        j += 1;
      }
      out += sql.slice(i, j);
      i = j;
      continue;
    }

    out += sql[i];
    i += 1;
  }

  return out;
}

/**
 * O mesmo arquivo tem hash diferente conforme a quebra de linha do checkout.
 * `core.autocrlf=true` no Windows entrega CRLF enquanto os hashes gravados no
 * banco vieram de checkouts LF — comparar só uma grafia dá "nunca aplicada"
 * para dezenas de migrations que estão aplicadas.
 */
export function hashVariants(sql: string): string[] {
  const lf = sql.replace(/\r\n/g, "\n");
  const spellings = new Set([lf, lf.replace(/\n/g, "\r\n")]);
  return [...spellings].map((text) =>
    createHash("sha256").update(text).digest("hex"),
  );
}

export function readMigrationJournal(migrationsFolder: string): MigrationFile[] {
  const journal = JSON.parse(
    readFileSync(join(migrationsFolder, "meta/_journal.json"), "utf8"),
  ) as { entries: JournalEntry[] };

  return journal.entries.map((entry) => {
    const sql = readFileSync(join(migrationsFolder, `${entry.tag}.sql`), "utf8");
    return { tag: entry.tag, when: entry.when, sql, hashes: hashVariants(sql) };
  });
}

export function extractDdlTargets(sql: string): DdlTargets {
  const clean = stripSqlComments(sql);

  const tables = [
    ...clean.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z0-9_]+)"?/gi),
  ].map((match) => match[1]);

  const columns = [
    ...clean.matchAll(
      /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?"?([a-z0-9_]+)"?\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z0-9_]+)"?/gi,
    ),
  ].map((match) => ({ table: match[1], column: match[2] }));

  return { tables: [...new Set(tables)], columns };
}

/**
 * O contrário de `extractDdlTargets`: o que a migration REMOVE.
 *
 * Serve para separar as duas causas de "o objeto não está no banco". Ausência
 * por migration pulada é defeito; ausência porque uma migration posterior
 * dropou de propósito é o resultado esperado — e sem essa distinção todo drop
 * deliberado deixa a auditoria vermelha para sempre, o que derruba o build.
 */
export function extractDroppedDdlTargets(sql: string): DdlTargets {
  const clean = stripSqlComments(sql);

  const tables = [
    ...clean.matchAll(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([^;]+)/gi),
  ].flatMap((match) =>
    [...match[1].matchAll(/"?([a-z0-9_]+)"?/gi)]
      .map((name) => name[1])
      .filter((name) => !/^(cascade|restrict|if|exists)$/i.test(name)),
  );

  const columns = [
    ...clean.matchAll(
      /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?"?([a-z0-9_]+)"?\s+DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?"?([a-z0-9_]+)"?/gi,
    ),
  ].map((match) => ({ table: match[1], column: match[2] }));

  return { tables: [...new Set(tables)], columns };
}

export type AuditInput = {
  files: MigrationFile[];
  /** Hashes presentes em `drizzle.__drizzle_migrations`. */
  appliedHashes: ReadonlySet<string>;
  /** `max(created_at)` da mesma tabela. */
  watermark: number;
  existingTables: ReadonlySet<string>;
  /** Chaves `tabela.coluna`. */
  existingColumns: ReadonlySet<string>;
};

export function auditMigrations(input: AuditInput): AuditRow[] {
  const { files, appliedHashes, watermark, existingTables, existingColumns } =
    input;

  const stateOf = (file: MigrationFile): MigrationState => {
    if (file.hashes.some((hash) => appliedHashes.has(hash))) return "applied";
    return file.when > watermark ? "pending" : "skipped";
  };

  const states = new Map(files.map((file) => [file.tag, stateOf(file)]));

  // Uma coluna cuja tabela não existe só conta como faltando se alguma
  // migration ainda não aplicada é que criaria essa tabela. Sem esse recorte,
  // toda migration que mexeu numa tabela depois removida vira falso positivo —
  // e `0045_meta_tracking_metric_columns` (que altera a tabela criada pela
  // 0044) deixaria de ser vista no mesmo diagnóstico.
  const tablesFromUnapplied = new Set(
    files
      .filter((file) => states.get(file.tag) !== "applied")
      .flatMap((file) => extractDdlTargets(file.sql).tables),
  );

  return files.map((file) => {
    const state = states.get(file.tag) as MigrationState;
    if (state === "applied") {
      return { tag: file.tag, when: file.when, state, missingTables: [], missingColumns: [] };
    }

    const targets = extractDdlTargets(file.sql);

    // O que migrations POSTERIORES dropam de propósito não conta como faltando.
    // Só as posteriores: recriar um objeto depois de dropá-lo é legítimo, e aí
    // a ausência volta a ser defeito.
    const droppedLater = files
      .filter((other) => other.when > file.when)
      .map((other) => extractDroppedDdlTargets(other.sql));
    const droppedTables = new Set(droppedLater.flatMap((t) => t.tables));
    const droppedColumns = new Set(
      droppedLater.flatMap((t) =>
        t.columns.map(({ table, column }) => `${table}.${column}`),
      ),
    );

    const missingTables = targets.tables.filter(
      (table) => !existingTables.has(table) && !droppedTables.has(table),
    );

    const missingColumns = targets.columns.filter(({ table, column }) => {
      if (droppedColumns.has(`${table}.${column}`)) return false;
      if (droppedTables.has(table)) return false;
      if (existingTables.has(table)) {
        return !existingColumns.has(`${table}.${column}`);
      }
      return tablesFromUnapplied.has(table);
    });

    return { tag: file.tag, when: file.when, state, missingTables, missingColumns };
  });
}
