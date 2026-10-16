import history from "../fixtures/staging-20261016-migration-history.json";

type MigrationIdentity = { tag: string; when: number; hashes: string[] };
type HistoricalIdentity = { tag: string; when: number; hash: string };

function matches(file: MigrationIdentity, saved: HistoricalIdentity): boolean {
  return file.tag === saved.tag && file.when === saved.when && file.hashes.includes(saved.hash);
}

/** Only exact, immutable SQL identities inherited from the two source branches. */
export function isPreservedMigrationPair(left: MigrationIdentity, right: MigrationIdentity): boolean {
  return history.pairs.some(({ members: [a, b] }) =>
    (matches(left, a) && matches(right, b)) || (matches(left, b) && matches(right, a)),
  );
}
