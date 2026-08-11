/**
 * Carrega o `.env` roteado por `APP_ENV` ANTES de qualquer outro módulo.
 *
 * Existe por causa de uma armadilha de ESM: `import` é hoisted e avaliado em
 * profundidade na ordem de declaração, então um `loadAppEnv()` escrito no corpo
 * do script roda DEPOIS de todos os imports dele. Como `lib/db/index.ts` lê
 * `process.env.POSTGRES_URL` no topo do módulo, o cliente Postgres já nasceu
 * apontando para o que o Bun autocarregou do `.env.local` — que neste projeto é
 * PRODUÇÃO. O `APP_ENV=staging` da linha de comando chegava tarde demais e não
 * tinha efeito nenhum sobre a conexão.
 *
 * Importar este módulo em PRIMEIRO lugar resolve: por ser a primeira aresta do
 * grafo, ele é avaliado antes dos imports seguintes e o `POSTGRES_URL` correto
 * já está em `process.env` quando o cliente é construído.
 *
 *   import "./bootstrap-env";   // <- sempre a primeira linha de import
 *   import { algo } from "@/lib/...";
 *
 * O wrapper `scripts/with-env.ts` resolve o mesmo problema por outro caminho
 * (spawna um processo filho com o env já resolvido) e continua valendo para os
 * scripts do `package.json`. Este módulo é o que torna a invocação DIRETA
 * (`APP_ENV=staging bun scripts/<script>.ts`) igualmente segura.
 */

import { loadAppEnv } from "../lib/env/load-env";

const appEnv = loadAppEnv();

// O alvo é a informação mais importante da execução: estes scripts escrevem no
// banco, e os arquivos `.env` deste projeto não seguem a intuição.
const dbUser = process.env.POSTGRES_URL?.match(/:\/\/([^:]+):/)?.[1] ?? "(indefinido)";
console.log(`[env] APP_ENV=${appEnv} → POSTGRES_URL user=${dbUser}`);

export { appEnv };
