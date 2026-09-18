import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readSource(relativePath: string) {
  return readFileSync(join(repositoryRoot, relativePath), "utf8");
}

test("standalone library and AI campaign sheet share the operator audience manager", () => {
  const standalonePage = readSource("app/(admin)/marketing/audiences/page.tsx");
  // The campaign's entry point to the library is the "Públicos da conta" tab of the advanced
  // audience sheet. It manages library objects only: no callback can turn one into a campaign
  // answer — inclusions and exclusions have their own tabs and their own editors.
  const campaignSheet = readSource("app/(admin)/marketing/ai/ai-advanced-audience-sheet.tsx");
  const manager = readSource("app/(admin)/marketing/audiences/audience-library-manager.tsx");

  assert.match(standalonePage, /import \{ AudienceLibraryManager \} from "\.\/audience-library-manager"/);
  assert.match(standalonePage, /accountUserId/);
  assert.match(standalonePage, /AudienceLibraryManager key=\{\`\$\{userId\}:\$\{selectedAccountId\}\`\} userId=\{userId\} accountId=\{selectedAccountId\}/);
  assert.match(campaignSheet, /import \{ AudienceLibraryManager \} from "\.\.\/audiences\/audience-library-manager"/);
  assert.match(
    campaignSheet,
    /<AudienceLibraryManager\s+key=\{`\$\{userId\}:\$\{accountId\}`\}\s+accountId=\{accountId\}\s+userId=\{userId\}\s*\/>/,
  );

  assert.match(manager, /CustomerListImport/);
  assert.match(manager, /userId: string/);
  assert.match(manager, /aria-label="Gerenciador de públicos"/);
  assert.match(campaignSheet, /Sheet modal=\{false\} open=\{open\} onOpenChange=\{onOpenChange\}/);
  // The tabs (and the manager with them) mount only while the sheet is open.
  assert.match(campaignSheet, /\{open \? \(\s*<Tabs/);
  assert.match(campaignSheet, /Voltar à revisão/);

  assert.doesNotMatch(campaignSheet, /InstagramAudienceEditor|WebsiteAudienceEditor|LookalikeAudienceCreator|CustomerListImport/);
  assert.doesNotMatch(campaignSheet, /onSelectAudience|onApplyAudience/);
});
