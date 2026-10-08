import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const WORKSPACE = join(
  process.cwd(),
  "app/(admin)/marketing/components/marketing-workspace.tsx",
);
const HUB = join(process.cwd(), "app/(admin)/users/[id]/user-hub-page.tsx");

test("a página de marketing mostra o resumo de assinatura nos detalhes do usuário", () => {
  const workspace = readFileSync(WORKSPACE, "utf8");
  const details = workspace.indexOf("Detalhes do usuário");
  const summary = workspace.indexOf(
    "<MarketingAccessSummary userId={selectedUser.id} />",
  );
  const metaStatus = workspace.indexOf("Status da conta de marketing do Facebook");
  assert.ok(details > 0, "o cartão de detalhes existe");
  assert.ok(summary > details, "o resumo fica dentro dos detalhes do usuário");
  assert.ok(metaStatus > summary, "logo abaixo do e-mail, antes do status da Meta");
  assert.match(workspace, /showAccessSummary && \(\s*<MarketingAccessSummary/);
  assert.match(workspace, /showAccessSummary = true/);
});

test("na ficha do cliente o resumo não se repete: o cabeçalho já mostra o acesso", () => {
  const hub = readFileSync(HUB, "utf8");
  const workspace = hub.slice(hub.indexOf("<MarketingWorkspace"));
  assert.match(workspace.slice(0, workspace.indexOf("/>")), /showAccessSummary=\{false\}/);
  assert.match(hub, /Acesso até/);
});
