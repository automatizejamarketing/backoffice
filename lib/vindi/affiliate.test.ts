import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { VindiApiError, type VindiClient, type VindiRequest } from "./client";
import { ensureVindiAffiliate } from "./affiliate";

type StoredAffiliate = {
  id: number;
  login: string;
  status: string;
};

function queryLogin(path: string): string | null {
  const query = new URL(path, "https://vindi.test").searchParams.get("query");
  const match = query?.match(/^login=(.+)$/);
  return match?.[1] ?? null;
}

function affiliateIdFromPath(path: string): string | null {
  const match = path.match(/^\/v1\/affiliates\/(\d+)$/);
  return match?.[1] ?? null;
}

function createFakeVindiAffiliates(options?: { affiliates?: StoredAffiliate[] }) {
  const affiliates = new Map(
    (options?.affiliates ?? []).map((affiliate) => [affiliate.id, affiliate]),
  );
  let nextId = 40;
  const requests: VindiRequest[] = [];

  const client: VindiClient = {
    async request<T>(input: VindiRequest): Promise<T> {
      requests.push(input);

      if (input.method === "GET" && input.path.startsWith("/v1/affiliates?")) {
        const login = queryLogin(input.path);
        const found = [...affiliates.values()].filter(
          (affiliate) => affiliate.login === login,
        );
        return { affiliates: found } as T;
      }

      if (input.method === "GET") {
        const id = affiliateIdFromPath(input.path);
        const found = id ? affiliates.get(Number(id)) : undefined;
        if (!found) {
          throw new VindiApiError(404, [
            { id: "not_found", message: "Affiliate not found" },
          ]);
        }
        return { affiliate: found } as T;
      }

      if (input.method === "PUT" && input.path.endsWith("/verify")) {
        const id = Number(input.path.split("/")[3]);
        const current = affiliates.get(id);
        if (!current) {
          throw new VindiApiError(404, [
            { id: "not_found", message: "Affiliate not found" },
          ]);
        }
        if (current.status !== "blocked") {
          throw new VindiApiError(422, [
            { id: "invalid_status", message: "only blocked affiliates" },
          ]);
        }
        current.status = "pending_approval";
        return { affiliate: current } as T;
      }

      if (input.method === "POST" && input.path === "/v1/affiliates") {
        const body = input.body as { login?: string };
        const login = body.login ?? "";
        const already = [...affiliates.values()].find(
          (affiliate) => affiliate.login === login,
        );
        if (already) {
          throw new VindiApiError(422, [
            { id: "taken", parameter: "login", message: "já existe" },
          ]);
        }
        const created = {
          id: nextId++,
          login,
          status: "pending_approval",
        };
        affiliates.set(created.id, created);
        return { affiliate: created } as T;
      }

      throw new Error(`Unexpected Vindi request ${input.method} ${input.path}`);
    },
  };

  return { client, requests, affiliates };
}

describe("ensureVindiAffiliate", () => {
  it("creates the affiliate with the expert email as login", async () => {
    const fake = createFakeVindiAffiliates();

    const result = await ensureVindiAffiliate(fake.client, {
      login: " Ana@Expert.com ",
    });

    assert.deepEqual(result, {
      affiliateId: "40",
      status: "pending",
      created: true,
    });
    assert.equal(fake.requests.at(-1)?.method, "POST");
    assert.deepEqual(fake.requests.at(-1)?.body, { login: "ana@expert.com" });
  });

  it("reuses an affiliate already stored on the expert without creating another", async () => {
    const fake = createFakeVindiAffiliates({
      affiliates: [
        { id: 77, login: "ana@expert.com", status: "active" },
      ],
    });

    const result = await ensureVindiAffiliate(fake.client, {
      login: "ana@expert.com",
      existingAffiliateId: "77",
    });

    assert.deepEqual(result, {
      affiliateId: "77",
      status: "verified",
      created: false,
    });
    assert.equal(
      fake.requests.some((request) => request.method === "POST"),
      false,
    );
  });

  it("attaches an existing Vindi affiliate found by login", async () => {
    const fake = createFakeVindiAffiliates({
      affiliates: [
        { id: 88, login: "ana@expert.com", status: "pending_approval" },
      ],
    });

    const result = await ensureVindiAffiliate(fake.client, {
      login: "ana@expert.com",
    });

    assert.deepEqual(result, {
      affiliateId: "88",
      status: "pending",
      created: false,
    });
    assert.equal(
      fake.requests.some((request) => request.method === "POST"),
      false,
    );
  });

  it("treats a 422 on create as idempotent when the login already exists", async () => {
    const affiliates = new Map<number, StoredAffiliate>([
      [91, { id: 91, login: "ana@expert.com", status: "blocked" }],
    ]);
    let posts = 0;
    const client: VindiClient = {
      async request<T>(input: VindiRequest): Promise<T> {
        if (input.method === "GET" && input.path.startsWith("/v1/affiliates?")) {
          if (posts === 0) return { affiliates: [] } as T;
          return { affiliates: [...affiliates.values()] } as T;
        }
        if (input.method === "POST") {
          posts += 1;
          throw new VindiApiError(422, [
            { id: "taken", parameter: "login", message: "já existe" },
          ]);
        }
        throw new Error(`Unexpected ${input.method} ${input.path}`);
      },
    };

    const result = await ensureVindiAffiliate(client, {
      login: "ana@expert.com",
    });

    assert.deepEqual(result, {
      affiliateId: "91",
      status: "rejected",
      created: false,
    });
  });

  it("reopens verification when a stored affiliate is still blocked", async () => {
    const fake = createFakeVindiAffiliates({
      affiliates: [
        { id: 77, login: "ana@expert.com", status: "blocked" },
      ],
    });

    const result = await ensureVindiAffiliate(fake.client, {
      login: "ana@expert.com",
      existingAffiliateId: "77",
    });

    assert.deepEqual(result, {
      affiliateId: "77",
      status: "pending",
      created: false,
    });
    assert.equal(
      fake.requests.some(
        (request) =>
          request.method === "PUT" &&
          request.path === "/v1/affiliates/77/verify",
      ),
      true,
    );
  });
});
