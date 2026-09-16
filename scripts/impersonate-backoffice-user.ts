#!/usr/bin/env bun
/**
 * Entra no backoffice local como alguém da equipe, sem Google OAuth: emite o
 * cookie `backoffice_magic_session` que o rbac aceita no lugar da sessão do
 * NextAuth. Serve para ver o que um papel (comercial, consultor de marketing,
 * financeiro) enxerga, com o banco do ambiente escolhido.
 *
 *   bun scripts/impersonate-backoffice-user.ts --env prod --user vini@empresa.com --confirm-prod
 *   bun scripts/impersonate-backoffice-user.ts --env staging --user vini@empresa.com --browser chrome
 *
 * Só imprime/instala o cookie; não altera nada no banco.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import net from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import postgres from "postgres";
import { isAdminEmail } from "../lib/config";
import { createBackofficeMagicSessionToken } from "../lib/auth/magic-session";
import { BACKOFFICE_MAGIC_SESSION_COOKIE } from "../lib/auth/magic-session-constants";
import { type AppEnv, loadAppEnv } from "../lib/env/load-env";

const EXPECTED_DB_REFS: Record<Exclude<AppEnv, "local">, string> = {
  staging: "wsbsnzgzqiehqnklzchm",
  prod: "hosjqwtfjjtmphchsuqf",
};

type CliOptions = {
  env: Exclude<AppEnv, "local">;
  user: string | null;
  url: string;
  browser: "print" | "chrome";
  profile: string;
  confirmProd: boolean;
};

function usage(): never {
  console.error(`Usage:
  bun scripts/impersonate-backoffice-user.ts --env staging --user pessoa@empresa.com
  bun scripts/impersonate-backoffice-user.ts --env prod --user pessoa@empresa.com --confirm-prod --browser chrome

Options:
  --env staging|prod   Env file to load (default: staging). Define AUTH_SECRET e o banco consultado.
  --user <email>       Email de backoffice_users (ou da lista ADMIN_EMAILS)
  --url <origin>       Backoffice local (default: https://automatize-backoffice.localhost:1355)
  --browser print|chrome
                       print mostra o cookie e os comandos do agent-browser (default)
                       chrome abre um Chrome separado já logado
  --profile <name>     Perfil do Chrome dedicado (default: default)
  --confirm-prod       Obrigatório com --env prod
`);
  process.exit(1);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    env: "staging",
    user: null,
    url: "https://automatize-backoffice.localhost:1355",
    browser: "print",
    profile: "default",
    confirmProd: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    switch (arg) {
      case "--env":
        if (next !== "staging" && next !== "prod") usage();
        options.env = next;
        index += 1;
        break;
      case "--user":
        if (!next) usage();
        options.user = next.trim().toLowerCase();
        index += 1;
        break;
      case "--url":
        if (!next) usage();
        options.url = next.replace(/\/$/, "");
        index += 1;
        break;
      case "--browser":
        if (next !== "print" && next !== "chrome") usage();
        options.browser = next;
        index += 1;
        break;
      case "--profile":
        if (!next) usage();
        options.profile = next.trim();
        index += 1;
        break;
      case "--confirm-prod":
        options.confirmProd = true;
        break;
      default:
        usage();
    }
  }
  if (!options.user || !options.user.includes("@")) usage();
  return options;
}

function extractSupabaseRef(postgresUrl: string): string | null {
  const userMatch = /postgres(?:ql)?:\/\/postgres\.([^:]+):/.exec(postgresUrl);
  if (userMatch?.[1]) return userMatch[1];
  const hostMatch = /@db\.([^.]+)\./.exec(postgresUrl);
  return hostMatch?.[1] ?? null;
}

type TeamRow = {
  email: string;
  name: string | null;
  role: string;
  sales_role: string | null;
  active: boolean;
};

async function describeAccess(postgresUrl: string, email: string): Promise<string> {
  const sql = postgres(postgresUrl, { max: 1, prepare: false });
  try {
    const [row] = await sql<TeamRow[]>`
      select email, name, role, sales_role, active from backoffice_users where email = ${email} limit 1
    `;
    if (isAdminEmail(email)) {
      return row
        ? `admin (ADMIN_EMAILS sobrepõe o papel ${row.role} do banco)${row.sales_role ? ` · cargo ${row.sales_role}` : ""}`
        : "admin (ADMIN_EMAILS, sem linha em backoffice_users)";
    }
    if (!row) return "SEM ACESSO: não está em backoffice_users nem em ADMIN_EMAILS";
    if (!row.active) return `SEM ACESSO: ${row.role}, mas inativo`;
    return `${row.role}${row.sales_role ? ` · cargo ${row.sales_role}` : ""}${row.name ? ` (${row.name})` : ""}`;
  } finally {
    await sql.end();
  }
}

// ---------- Chrome dedicado via CDP ----------

function resolveChromePath(): string {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error("Chrome não encontrado em /Applications.");
  return found;
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === "object" && address?.port) resolve(address.port);
        else reject(new Error("Sem porta livre."));
      });
    });
  });
}

async function waitForPageWebSocket(port: number): Promise<string> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const targets = (await response.json()) as Array<{ type?: string; webSocketDebuggerUrl?: string }>;
        const page = targets.find((t) => t.type === "page" && typeof t.webSocketDebuggerUrl === "string");
        if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
      }
    } catch {
      // Chrome ainda subindo.
    }
    await sleep(250);
  }
  throw new Error("Chrome não respondeu no DevTools Protocol.");
}

async function cdpSend(ws: WebSocket, id: number, method: string, params: Record<string, unknown> = {}) {
  return new Promise<void>((resolve, reject) => {
    const onMessage = (event: MessageEvent) => {
      const data = JSON.parse(String(event.data)) as { id?: number; error?: { message?: string } };
      if (data.id !== id) return;
      ws.removeEventListener("message", onMessage);
      if (data.error) reject(new Error(data.error.message ?? "CDP falhou"));
      else resolve();
    };
    ws.addEventListener("message", onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function openDedicatedChrome(options: { token: string; url: string; env: string; profile: string }) {
  const port = await getFreePort();
  const userDataDir = join(homedir(), ".automatize", "backoffice-impersonation", `${options.env}-${options.profile}`);
  await mkdir(userDataDir, { recursive: true });
  const chrome = spawn(
    resolveChromePath(),
    [
      `--user-data-dir=${userDataDir}`,
      `--remote-debugging-port=${port}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--ignore-certificate-errors",
      "about:blank",
    ],
    { detached: true, stdio: "ignore" },
  );
  chrome.unref();

  const ws = new WebSocket(await waitForPageWebSocket(port));
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", () => reject(new Error("Falha ao conectar no Chrome.")), { once: true });
  });
  try {
    await cdpSend(ws, 1, "Network.enable");
    await cdpSend(ws, 2, "Network.setCookie", {
      name: BACKOFFICE_MAGIC_SESSION_COOKIE,
      value: options.token,
      url: options.url,
      path: "/",
      httpOnly: true,
      secure: options.url.startsWith("https://"),
      sameSite: "Lax",
    });
    await cdpSend(ws, 3, "Page.navigate", { url: `${options.url}/` });
  } finally {
    ws.close();
  }
  console.log(`Chrome dedicado aberto (perfil ${userDataDir}) em ${options.url}/`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.env === "prod" && !options.confirmProd) {
    throw new Error("Com --env prod é obrigatório --confirm-prod.");
  }
  const envFile = join(process.cwd(), `.env.${options.env}`);
  if (!existsSync(envFile)) {
    throw new Error(`Falta ${envFile}. Rode bun run env:pull antes.`);
  }
  process.env.APP_ENV = options.env;
  loadAppEnv();

  const postgresUrl = process.env.POSTGRES_URL;
  if (!postgresUrl?.trim()) throw new Error("POSTGRES_URL ausente no env escolhido.");
  const ref = extractSupabaseRef(postgresUrl);
  console.log(`Environment: ${options.env}`);
  console.log(`Supabase ref: ${ref ?? "unknown"}`);
  if (ref !== EXPECTED_DB_REFS[options.env]) {
    throw new Error(`Esperava o ref ${EXPECTED_DB_REFS[options.env]} para ${options.env}, veio ${ref ?? "unknown"}.`);
  }

  const email = options.user as string;
  console.log(`Usuário: ${email}`);
  console.log(`Acesso resolvido pelo servidor local: ${await describeAccess(postgresUrl, email)}`);
  console.log(
    "Obs.: o servidor local precisa estar rodando com o MESMO env (AUTH_SECRET) e o mesmo banco.",
  );

  const token = createBackofficeMagicSessionToken(email);

  if (options.browser === "chrome") {
    await openDedicatedChrome({ token, url: options.url, env: options.env, profile: options.profile });
    return;
  }

  console.log("");
  console.log(`Cookie: ${BACKOFFICE_MAGIC_SESSION_COOKIE}`);
  console.log(token);
  console.log("");
  console.log("agent-browser:");
  console.log(`  agent-browser --ignore-https-errors open "${options.url}/login"`);
  console.log(
    `  agent-browser cookies set ${BACKOFFICE_MAGIC_SESSION_COOKIE} "<token acima>" --url ${options.url} --path /${options.url.startsWith("https://") ? " --secure" : ""}`,
  );
  console.log(`  agent-browser open "${options.url}/"`);
  console.log("");
  console.log("Para sair dessa sessão: apagar o cookie ou usar outro perfil de navegador.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
