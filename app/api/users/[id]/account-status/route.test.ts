import { describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Keep auth/database module mocks in a subprocess so they cannot affect other suites.
async function requestStatus(input: {
  allowed?: boolean;
  expirationDate?: string;
  subscriptions?: Record<string, unknown>[];
}) {
  const script = `
    import { mock } from "bun:test";
    const input = JSON.parse(process.env.ACCOUNT_STATUS_TEST_INPUT);
    let reads = 0;
    mock.module("@/lib/auth/rbac", () => ({
      requireMarketingUserAccessResponse: async () => input.allowed === false
        ? { ok: false, response: new Response(null, { status: 403 }) }
        : { ok: true },
    }));
    mock.module("@/lib/db", () => ({ db: {
      select: () => ({ from: () => {
        reads++;
        return { where: () => ({
          limit: async () => input.expirationDate ? [{ expirationDate: input.expirationDate }] : [],
          then: resolve => Promise.resolve(input.subscriptions ?? []).then(resolve),
        }) };
      } }),
    } }));
    const { GET } = await import(${JSON.stringify(new URL("./route.ts", import.meta.url).href)});
    const response = await GET(new Request("http://localhost/api/users/client-id/account-status"),
      { params: Promise.resolve({ id: "client-id" }) });
    console.log(JSON.stringify({ status: response.status, reads,
      cacheControl: response.headers.get("Cache-Control"),
      body: await response.json().catch(() => null) }));
  `;
  const { stdout } = await execFileAsync(process.execPath, ["--eval", script], {
    cwd: process.cwd(),
    env: { ...process.env, ACCOUNT_STATUS_TEST_INPUT: JSON.stringify(input) },
    encoding: "utf8",
  });
  return JSON.parse(stdout);
}

describe("marketing account status", () => {
  test("does not read account data when marketing access is denied", async () => {
    const response = await requestStatus({ allowed: false });
    expect(response.status).toBe(403);
    expect(response.reads).toBe(0);
  });

  test("returns not found rather than inventing an account state", async () => {
    const response = await requestStatus({});
    expect(response.status).toBe(404);
  });

  test("keeps active access and a canceled Stripe subscription distinct", async () => {
    const response = await requestStatus({
      expirationDate: "2099-10-05T12:00:00Z",
      subscriptions: [{
        provider: "stripe", status: "canceled", cancelAtPeriodEnd: false,
        currentPeriodEnd: "2099-10-05T12:00:00Z", createdAt: "2026-10-09T12:00:00Z",
      }],
    });
    const body = response.body;
    expect(response.status).toBe(200);
    expect(response.cacheControl).toBe("no-store");
    expect(body.access.label).toBe("Ativo até 05/10/2099");
    expect(body.billing.label).toBe("Cancelada");
    expect(Object.keys(body).sort()).toEqual(["access", "billing"]);
  });

  test("uses access expiration for Pix even if its subscription row says active", async () => {
    const response = await requestStatus({
      expirationDate: "2020-10-05T12:00:00Z",
      subscriptions: [{
        provider: "mercadopago", status: "active", cancelAtPeriodEnd: false,
        currentPeriodEnd: "2020-10-05T12:00:00Z", createdAt: "2026-10-09T12:00:00Z",
      }],
    });
    const body = response.body;
    expect(body.access.label).toBe("Vencido em 05/10/2020");
    expect(body.billing).toBeNull();
  });
});
