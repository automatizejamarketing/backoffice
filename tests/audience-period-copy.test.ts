import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = join(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("backoffice audience editors explain the period in plain language instead of internal evidence fields", () => {
  const website = read("app/(admin)/marketing/audiences/website-audience-editor.tsx");
  const instagram = read("app/(admin)/marketing/audiences/instagram-audience-editor.tsx");
  for (const source of [website, instagram]) {
    for (const jargon of ["Unidade enviada", "Limite local", "Limites Meta:", "Preenchimento histórico:", "Valor inicial:"]) {
      assert.equal(source.includes(jargon), false, `jargão "${jargon}" ainda aparece no editor`);
    }
  }
  assert.equal(website.includes("são fatos distintos"), false);
  assert.ok(website.includes("Quem visitou o site nesse período entra no público, inclusive visitas anteriores à criação."));
  assert.ok(instagram.includes("Quem interagiu com o perfil nesse período entra no público."));
});

test("backoffice website sources guidance no longer claims periods are blocked", () => {
  const route = read("app/api/meta-marketing/[accountId]/audiences/route.ts");
  assert.equal(route.includes("os períodos permanecem impedidos"), false);
  assert.ok(route.includes("Há Pixel com atividade recebida. Em 'Eventos registrados' aparecem só os eventos que este Pixel já recebeu."));
});
