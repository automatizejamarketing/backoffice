import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readSource(relativePath: string) {
  return readFileSync(join(repositoryRoot, relativePath), "utf8");
}

test("standalone library and AI campaign dialog share the operator audience manager", () => {
  const standalonePage = readSource("app/(admin)/marketing/audiences/page.tsx");
  const campaignDialog = readSource("app/(admin)/marketing/ai/ai-audience-library-dialog.tsx");
  const manager = readSource("app/(admin)/marketing/audiences/audience-library-manager.tsx");

  assert.match(standalonePage, /import \{ AudienceLibraryManager \} from "\.\/audience-library-manager"/);
  assert.match(standalonePage, /accountUserId/);
  assert.match(standalonePage, /AudienceLibraryManager key=\{\`\$\{userId\}:\$\{selectedAccountId\}\`\} userId=\{userId\} accountId=\{selectedAccountId\}/);
  assert.match(campaignDialog, /import \{ AudienceLibraryManager \} from "\.\.\/audiences\/audience-library-manager"/);
  assert.match(campaignDialog, /AudienceLibraryManager key=\{\`\$\{userId\}:\$\{accountId\}\`\} userId=\{userId\} accountId=\{accountId\}/);

  assert.match(manager, /CustomerListImport/);
  assert.match(manager, /userId: string/);
  assert.match(manager, /aria-label="Gerenciador de públicos"/);
  assert.match(campaignDialog, /Dialog open=\{open\} onOpenChange=\{onOpenChange\}/);
  assert.match(campaignDialog, /DialogClose asChild/);
  assert.match(campaignDialog, /Voltar à campanha/);
  assert.match(campaignDialog, /\{open \? <AudienceLibraryManager key=\{`\$\{userId\}:\$\{accountId\}`\} userId=\{userId\} accountId=\{accountId\} \/> : null\}/);

  assert.doesNotMatch(campaignDialog, /InstagramAudienceEditor|WebsiteAudienceEditor|LookalikeAudienceCreator|CustomerListImport/);
  assert.doesNotMatch(campaignDialog, /onSelectAudience|onApplyAudience|includedCustomAudienceIds/);
});
