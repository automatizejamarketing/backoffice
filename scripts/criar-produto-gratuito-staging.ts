// Cria o produto gratuito de teste na STAGING pelo caminho do BACKOFFICE.
//
// `parseProductAdminInput` é a MESMA validação que a tela de cadastro usa, e o
// insert abaixo é a mesma linha de `createProductAdmin` — a linha nasce idêntica
// à que a UI produziria. O que não passa por aqui é a camada HTTP/RBAC, porque
// não tenho (e não devo ter) a senha de admin da staging. `createProductAdmin`
// não é importado direto só porque ele puxa `server-only`, que o Next fornece e
// o bun fora do Next não resolve.
//
// Idempotente: se o slug já existir, imprime e sai sem escrever.

import { eq } from "drizzle-orm";
import { loadAppEnv } from "../lib/env/load-env";

loadAppEnv();

const STAGING_PROJECT_REF = "wsbsnzgzqiehqnklzchm";
const PROD_PROJECT_REF = "hosjqwtfjjtmphchsuqf";

if (process.env.APP_ENV !== "staging") {
  throw new Error("Restrito a APP_ENV=staging");
}
const postgresUrl = process.env.POSTGRES_URL;
if (!postgresUrl) throw new Error("POSTGRES_URL ausente");
const dbUrl = new URL(postgresUrl);
const fingerprint = `${dbUrl.hostname}:${dbUrl.username}`;
if (fingerprint.includes(PROD_PROJECT_REF)) {
  throw new Error("POSTGRES_URL aponta para PRODUÇÃO — abortado");
}
if (!fingerprint.includes(STAGING_PROJECT_REF)) {
  throw new Error("POSTGRES_URL não é o projeto de staging");
}

const SLUG = "teste-gratuito-automatize";

const { parseProductAdminInput } = await import("@/lib/products/admin-input");
const { db } = await import("@/lib/db");
const { product } = await import("@/lib/db/schema");

const [already] = await db
  .select()
  .from(product)
  .where(eq(product.slug, SLUG))
  .limit(1);

if (already) {
  console.log("Já existe, nada a fazer:");
  console.log(JSON.stringify(already, null, 2));
  process.exit(0);
}

const values = parseProductAdminInput({
  ownerType: "automatize",
  title: "Teste — Produto gratuito do Automatize",
  slug: SLUG,
  description:
    'Produto de teste, preço zero. Existe para exercitar o ramo gratuito do checkout público (kind: "free") e o caso S02 do roteiro de pagamentos. Não é um produto comercial.',
  priceCentavos: 0,
  visibility: "public",
  status: "published",
  salesEnabled: true,
  termsVersion: "v1",
});

const [created] = await db.insert(product).values(values).returning();

console.log("Criado:");
console.log(JSON.stringify(created, null, 2));
process.exit(0);
