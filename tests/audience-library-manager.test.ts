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
  assert.match(standalonePage, /accountState\.userId === userId/);
  assert.match(standalonePage, /AudienceLibraryManager key=\{\`\$\{userId\}:\$\{selectedAccountId\}\`\} userId=\{userId\} accountId=\{selectedAccountId\}/);
  assert.match(campaignSheet, /import \{ AudienceLibraryManager \} from "\.\.\/audiences\/audience-library-manager"/);
  assert.match(
    campaignSheet,
    /<AudienceLibraryManager\s+key=\{`\$\{userId\}:\$\{accountId\}`\}\s+accountId=\{accountId\}\s+userId=\{userId\}\s+surface="embedded"\s*\/>/,
  );

  assert.match(manager, /AudienceWorkspace/);
  assert.match(manager, /userId: string/);
  assert.match(manager, /aria-label="Gerenciador de públicos"/);
  assert.match(campaignSheet, /Sheet modal=\{false\} open=\{open\} onOpenChange=\{onOpenChange\}/);
  // The tabs (and the manager with them) mount only while the sheet is open.
  assert.match(campaignSheet, /\{open \? \(\s*<Tabs/);
  assert.match(campaignSheet, /Voltar à revisão/);

  assert.doesNotMatch(campaignSheet, /InstagramAudienceEditor|WebsiteAudienceEditor|LookalikeAudienceCreator|CustomerListImport/);
  assert.doesNotMatch(campaignSheet, /onSelectAudience|onApplyAudience/);
});


test("shared workspace preserves administrative scope and resets editor defaults per target", () => {
  const workspace = readSource("app/(admin)/marketing/audiences/audience-workspace.tsx");
  const manager = readSource("app/(admin)/marketing/audiences/audience-library-manager.tsx");
  assert.match(workspace, /userId: string/);
  assert.match(workspace, /defaultAudienceId=\{state\.audience\.id\}/);
  assert.match(workspace, /defaultOperation="add"/);
  assert.match(workspace, /<AudienceWorkspaceBody\s+key=\{`\$\{userId\}:\$\{accountId\}:\$\{state\.view\}:\$\{state\.view === "create-type" \? "types" : state\.kind\}:\$\{state\.view === "edit" \? state\.audience\.id : "new"\}`\}\s+accountId=\{accountId\} userId=\{userId\}/);
  assert.match(manager, /surface\?: "page" \| "embedded"/);
  assert.match(manager, /new URLSearchParams\(\{ detailed: "1", userId \}\)/);
  assert.match(manager, /userId=\{userId\}/);
  assert.doesNotMatch(manager + workspace, /\/api\/meta-business\/marketing\/|onApplyAudience|onSelectAudience/);
});

test("audience navigation preserves workspace boundaries and embedded page permission", () => {
  const marketing = readSource("app/(admin)/marketing/components/marketing-workspace.tsx");
  assert.match(marketing, /router\.push\(buildAudienceLibraryHref\(\{ userId: selectedUser\.id, accountId: selectedAccountId, embedded \}\)\)/);
  const embed = readSource("app/embed/marketing/audiences/page.tsx");
  assert.match(embed, /await requirePagePermission\("marketing:write"\)/);
  assert.match(embed, /<Suspense/);
  assert.match(embed, /<AudiencesPage\s*\/>/);
});

test("account page gates the manager on current loaded client and validates URL selection", () => {
  const page = readSource("app/(admin)/marketing/audiences/page.tsx");
  assert.match(page, /searchParams\.get\("accountId"\)/);
  assert.match(page, /resolveAudienceAccountId\(items, requestedAccountId\)/);
  assert.match(page, /accountState\.status === "ready"/);
  assert.match(page, /accountState\.requestedAccountId === requestedAccountId/);
  assert.match(page, /if \(!active\) return/);
  assert.match(page, /Tentar novamente/);
});
