import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { hashSecret, type StoredClient } from "./core";
import {
  createMcpOauthService,
  type CodeRow,
  type McpOauthStore,
  type TokenRow,
} from "./service";

type MemoryStore = McpOauthStore & {
  tokens: (TokenRow & { accessTokenHash: string; refreshTokenHash: string })[];
  /** Set to hold the next insertToken: `reached` fires there, it waits for `release`. */
  pauseInsert: { reached: () => void; release: Promise<void> } | null;
};

function memoryStore(): MemoryStore {
  const clients = new Map<string, StoredClient>();
  const codes = new Map<string, CodeRow & { usedAt: Date | null }>();
  const tokens: (TokenRow & { accessTokenHash: string; refreshTokenHash: string })[] = [];
  // One transaction at a time: the database version locks per person + app,
  // which is stricter than needed here but gives the same ordering.
  let queue: Promise<unknown> = Promise.resolve();
  const store: MemoryStore = {
    tokens,
    pauseInsert: null,
    transaction(fn) {
      const run = queue.then(() => fn(store));
      queue = run.catch(() => undefined);
      return run;
    },
    async getClient(id) {
      return clients.get(id) ?? null;
    },
    async insertClient(client) {
      clients.set(client.id, client);
    },
    async insertCode(code) {
      codes.set(code.codeHash, { ...code, usedAt: null });
    },
    async consumeCode(codeHash, now) {
      const row = codes.get(codeHash);
      if (!row || row.usedAt) return null;
      row.usedAt = now;
      return row;
    },
    async insertToken(token) {
      const pause = store.pauseInsert;
      if (pause) {
        store.pauseInsert = null;
        pause.reached();
        await pause.release;
      }
      const id = `token-${tokens.length + 1}`;
      tokens.push({ ...token, id, revokedAt: null });
      return { id };
    },
    async findTokenByAccessHash(hash) {
      return tokens.find((t) => t.accessTokenHash === hash) ?? null;
    },
    async consumeRefreshToken(hash, now) {
      const row = tokens.find((t) => t.refreshTokenHash === hash);
      if (!row || row.revokedAt) return null;
      row.revokedAt = now;
      return row;
    },
    async revokeConnection(actorEmail, clientId, now) {
      for (const code of codes.values()) {
        if (code.actorEmail === actorEmail && code.clientId === clientId && !code.usedAt) code.usedAt = now;
      }
      const live = tokens.filter((t) => t.actorEmail === actorEmail && t.clientId === clientId && !t.revokedAt);
      for (const t of live) t.revokedAt = now;
      return live.filter((t) => t.refreshExpiresAt > now).length;
    },
  };
  return store;
}

const verifier = "v".repeat(50);
const challenge = createHash("sha256").update(verifier).digest("base64url");
const redirectUri = "https://claude.ai/api/mcp/auth_callback";

async function setup(clock = { now: new Date("2026-09-13T12:00:00Z") }) {
  const store = memoryStore();
  const service = createMcpOauthService(store, () => clock.now);
  const registered = await service.registerClient({
    client_name: "Claude",
    redirect_uris: [redirectUri],
  });
  assert.ok(registered.ok);
  const clientId = registered.response.client_id;
  const request = {
    clientId,
    redirectUri,
    codeChallenge: challenge,
    scopes: ["backoffice:read", "backoffice:write"],
    state: null,
    resource: "https://app.example/api/mcp",
  };
  const code = await service.issueAuthorizationCode({ request, actorEmail: "bernardo@example.com" });
  return { store, service, clientId, code, clock, request };
}

describe("registerClient", () => {
  it("issues a public client without a secret", async () => {
    const { store, service, clientId } = await setup();
    assert.ok(await store.getClient(clientId));
    const registered = await service.registerClient({ redirect_uris: [redirectUri] });
    assert.ok(registered.ok && !("client_secret" in registered.response));
  });

  it("issues and hashes a secret for confidential clients", async () => {
    const { store, service } = await setup();
    const registered = await service.registerClient({
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "client_secret_post",
    });
    assert.ok(registered.ok && "client_secret" in registered.response);
    const secret = registered.response.client_secret as string;
    const stored = await store.getClient(registered.response.client_id);
    assert.equal(stored?.clientSecretHash, hashSecret(secret));
  });
});

describe("exchangeAuthorizationCode", () => {
  it("returns bearer + refresh tokens the resource accepts", async () => {
    const { service, clientId, code } = await setup();
    const result = await service.exchangeAuthorizationCode({
      credentials: { clientId, clientSecret: null },
      code,
      codeVerifier: verifier,
      redirectUri,
      resource: "https://app.example/api/mcp/",
    });
    assert.ok(result.ok);
    assert.equal(result.body.token_type, "Bearer");
    assert.equal(result.body.scope, "backoffice:read backoffice:write");

    const auth = await service.verifyAccessToken(result.body.access_token);
    assert.equal(auth?.extra.actorEmail, "bernardo@example.com");
    assert.equal(auth?.clientId, clientId);
    assert.deepEqual(auth?.scopes, ["backoffice:read", "backoffice:write"]);
    assert.equal(auth?.resource?.toString(), "https://app.example/api/mcp");
  });

  it("rejects a replayed code, a wrong verifier and a foreign client", async () => {
    const { service, clientId, code } = await setup();
    const base = { credentials: { clientId, clientSecret: null }, redirectUri, resource: null };

    const wrongVerifier = await service.exchangeAuthorizationCode({
      ...base,
      code,
      codeVerifier: "w".repeat(50),
    });
    assert.ok(!wrongVerifier.ok && wrongVerifier.error === "invalid_grant");

    // The failed attempt consumed the code: the real verifier no longer works.
    const replay = await service.exchangeAuthorizationCode({ ...base, code, codeVerifier: verifier });
    assert.ok(!replay.ok && replay.error === "invalid_grant");

    const other = await service.registerClient({ redirect_uris: [redirectUri] });
    assert.ok(other.ok);
    const foreign = await service.exchangeAuthorizationCode({
      ...base,
      credentials: { clientId: other.response.client_id, clientSecret: null },
      code,
      codeVerifier: verifier,
    });
    assert.ok(!foreign.ok && foreign.error === "invalid_grant");
  });

  it("rejects expired codes and mismatched redirect_uri", async () => {
    const clock = { now: new Date("2026-09-13T12:00:00Z") };
    const { service, clientId, code } = await setup(clock);
    const mismatch = await service.exchangeAuthorizationCode({
      credentials: { clientId, clientSecret: null },
      code,
      codeVerifier: verifier,
      redirectUri: "https://claude.ai/other",
      resource: null,
    });
    assert.ok(!mismatch.ok && mismatch.error === "invalid_grant");

    const { service: s2, clientId: c2, code: code2 } = await setup(clock);
    clock.now = new Date("2026-09-13T12:11:00Z");
    const expired = await s2.exchangeAuthorizationCode({
      credentials: { clientId: c2, clientSecret: null },
      code: code2,
      codeVerifier: verifier,
      redirectUri,
      resource: null,
    });
    assert.ok(!expired.ok && expired.error === "invalid_grant");
  });

  it("requires the secret for confidential clients", async () => {
    const { service } = await setup();
    const registered = await service.registerClient({
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "client_secret_basic",
    });
    assert.ok(registered.ok);
    const clientId = registered.response.client_id;
    const code = await service.issueAuthorizationCode({
      request: { clientId, redirectUri, codeChallenge: challenge, scopes: ["backoffice:read"], state: null, resource: null },
      actorEmail: "bernardo@example.com",
    });
    const noSecret = await service.exchangeAuthorizationCode({
      credentials: { clientId, clientSecret: null },
      code,
      codeVerifier: verifier,
      redirectUri,
      resource: null,
    });
    assert.ok(!noSecret.ok && noSecret.error === "invalid_client");
    const ok = await service.exchangeAuthorizationCode({
      credentials: { clientId, clientSecret: registered.response.client_secret as string },
      code,
      codeVerifier: verifier,
      redirectUri,
      resource: null,
    });
    assert.ok(ok.ok);
    assert.equal(ok.body.scope, "backoffice:read");
  });
});

describe("refreshAccessToken", () => {
  async function grant() {
    const ctx = await setup();
    const first = await ctx.service.exchangeAuthorizationCode({
      credentials: { clientId: ctx.clientId, clientSecret: null },
      code: ctx.code,
      codeVerifier: verifier,
      redirectUri,
      resource: null,
    });
    assert.ok(first.ok);
    return { ...ctx, first: first.body };
  }

  it("rotates the grant, revokes the old one and keeps the actor", async () => {
    const { service, clientId, first } = await grant();

    const second = await service.refreshAccessToken({
      credentials: { clientId, clientSecret: null },
      refreshToken: first.refresh_token,
      scope: null,
    });
    assert.ok(second.ok);
    assert.notEqual(second.body.access_token, first.access_token);
    assert.equal(await service.verifyAccessToken(first.access_token), null);
    const auth = await service.verifyAccessToken(second.body.access_token);
    assert.equal(auth?.extra.actorEmail, "bernardo@example.com");

    const replay = await service.refreshAccessToken({
      credentials: { clientId, clientSecret: null },
      refreshToken: first.refresh_token,
      scope: null,
    });
    assert.ok(!replay.ok && replay.error === "invalid_grant");
  });

  it("allows narrowing scope but not widening it", async () => {
    const { service, clientId, first } = await grant();
    const narrowed = await service.refreshAccessToken({
      credentials: { clientId, clientSecret: null },
      refreshToken: first.refresh_token,
      scope: "backoffice:read",
    });
    assert.ok(narrowed.ok);
    assert.equal(narrowed.body.scope, "backoffice:read");

    const widened = await service.refreshAccessToken({
      credentials: { clientId, clientSecret: null },
      refreshToken: narrowed.body.refresh_token,
      scope: "backoffice:read backoffice:write",
    });
    assert.ok(!widened.ok && widened.error === "invalid_scope");
  });

  it("rejects expired refresh tokens", async () => {
    const clock = { now: new Date("2026-09-13T12:00:00Z") };
    const ctx = await setup(clock);
    const first = await ctx.service.exchangeAuthorizationCode({
      credentials: { clientId: ctx.clientId, clientSecret: null },
      code: ctx.code,
      codeVerifier: verifier,
      redirectUri,
      resource: null,
    });
    assert.ok(first.ok);
    clock.now = new Date("2026-10-20T12:00:00Z");
    const result = await ctx.service.refreshAccessToken({
      credentials: { clientId: ctx.clientId, clientSecret: null },
      refreshToken: first.body.refresh_token,
      scope: null,
    });
    assert.ok(!result.ok && result.error === "invalid_grant");
  });
});

describe("verifyAccessToken", () => {
  it("returns null for unknown and expired tokens", async () => {
    const clock = { now: new Date("2026-09-13T12:00:00Z") };
    const ctx = await setup(clock);
    assert.equal(await ctx.service.verifyAccessToken("nope"), null);
    const first = await ctx.service.exchangeAuthorizationCode({
      credentials: { clientId: ctx.clientId, clientSecret: null },
      code: ctx.code,
      codeVerifier: verifier,
      redirectUri,
      resource: null,
    });
    assert.ok(first.ok);
    clock.now = new Date("2026-09-13T13:01:00Z");
    assert.equal(await ctx.service.verifyAccessToken(first.body.access_token), null);
  });
});

describe("disconnect", () => {
  it("cuts the access and refresh tokens and burns a pending consent, only for that person and app", async () => {
    const ctx = await setup();
    const exchange = (clientId: string, code: string) => ctx.service.exchangeAuthorizationCode({
      credentials: { clientId, clientSecret: null }, code, codeVerifier: verifier, redirectUri, resource: null,
    });
    const first = await exchange(ctx.clientId, ctx.code);
    assert.ok(first.ok);
    // Another colleague on the same app, and a consent given just before the click.
    const colleagueCode = await ctx.service.issueAuthorizationCode({ request: ctx.request, actorEmail: "ana@example.com" });
    const colleague = await exchange(ctx.clientId, colleagueCode);
    assert.ok(colleague.ok);
    const pending = await ctx.service.issueAuthorizationCode({ request: ctx.request, actorEmail: "bernardo@example.com" });

    assert.equal(await ctx.service.disconnect({ actorEmail: "bernardo@example.com", clientId: ctx.clientId }), 1);

    assert.equal(await ctx.service.verifyAccessToken(first.body.access_token), null);
    const refresh = await ctx.service.refreshAccessToken({
      credentials: { clientId: ctx.clientId, clientSecret: null }, refreshToken: first.body.refresh_token, scope: null,
    });
    assert.ok(!refresh.ok && refresh.error === "invalid_grant");
    const late = await exchange(ctx.clientId, pending);
    assert.ok(!late.ok && late.error === "invalid_grant");
    assert.equal((await ctx.service.verifyAccessToken(colleague.body.access_token))?.extra.actorEmail, "ana@example.com");

    // Already disconnected: nothing left to revoke.
    assert.equal(await ctx.service.disconnect({ actorEmail: "bernardo@example.com", clientId: ctx.clientId }), 0);
  });
});

describe("disconnect during a grant", () => {
  function deferred() {
    let resolve = () => {};
    const promise = new Promise<void>((r) => { resolve = r; });
    return { promise, resolve };
  }

  /** Runs `grant` until it is about to insert the new token, disconnects, then lets it finish. */
  async function disconnectMidGrant(ctx: Awaited<ReturnType<typeof setup>>, grant: () => Promise<Awaited<ReturnType<typeof ctx.service.refreshAccessToken>>>) {
    const reached = deferred();
    const release = deferred();
    ctx.store.pauseInsert = { reached: reached.resolve, release: release.promise };
    const granting = grant();
    await reached.promise;
    const disconnecting = ctx.service.disconnect({ actorEmail: "bernardo@example.com", clientId: ctx.clientId });
    release.resolve();
    const granted = await granting;
    await disconnecting;
    return granted;
  }

  it("does not let a refresh in flight outlive the disconnect", async () => {
    const ctx = await setup();
    const first = await ctx.service.exchangeAuthorizationCode({
      credentials: { clientId: ctx.clientId, clientSecret: null }, code: ctx.code, codeVerifier: verifier, redirectUri, resource: null,
    });
    assert.ok(first.ok);
    const refreshed = await disconnectMidGrant(ctx, () => ctx.service.refreshAccessToken({
      credentials: { clientId: ctx.clientId, clientSecret: null }, refreshToken: first.body.refresh_token, scope: null,
    }));
    assert.ok(refreshed.ok);
    assert.equal(await ctx.service.verifyAccessToken(refreshed.body.access_token), null);
  });

  it("does not let a code exchange in flight outlive the disconnect", async () => {
    const ctx = await setup();
    const exchanged = await disconnectMidGrant(ctx, () => ctx.service.exchangeAuthorizationCode({
      credentials: { clientId: ctx.clientId, clientSecret: null }, code: ctx.code, codeVerifier: verifier, redirectUri, resource: null,
    }));
    assert.ok(exchanged.ok);
    assert.equal(await ctx.service.verifyAccessToken(exchanged.body.access_token), null);
  });
});
