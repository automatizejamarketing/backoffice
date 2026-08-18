import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createVindiClient, VindiApiError } from "./client";

describe("createVindiClient", () => {
  it("sends RFC2617 Basic auth with a trailing colon on the private key", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;

    const client = createVindiClient({
      keyKind: "private",
      apiKey: "test-private-key",
      baseUrl: "https://sandbox-app.vindi.com.br/api",
      fetch: (async (input, init) => {
        capturedUrl = String(input);
        capturedInit = init;
        return new Response(JSON.stringify({ customers: [] }), { status: 200 });
      }) as typeof fetch,
    });

    await client.request({ method: "GET", path: "/v1/customers" });

    assert.equal(
      capturedUrl,
      "https://sandbox-app.vindi.com.br/api/v1/customers",
    );
    const headers = new Headers(capturedInit?.headers);
    assert.equal(headers.get("Authorization"), "Basic dGVzdC1wcml2YXRlLWtleTo=");
    assert.equal(headers.get("Content-Type"), "application/json");
  });

  it("uses the production base URL when that environment is configured", async () => {
    let capturedUrl = "";

    const client = createVindiClient({
      keyKind: "private",
      apiKey: "test-private-key",
      baseUrl: "https://app.vindi.com.br/api",
      fetch: (async (input) => {
        capturedUrl = String(input);
        return new Response(JSON.stringify({ customers: [] }), { status: 200 });
      }) as typeof fetch,
    });

    await client.request({ method: "GET", path: "/v1/customers" });

    assert.equal(capturedUrl, "https://app.vindi.com.br/api/v1/customers");
  });

  it("parses a 422 errors array into a structured VindiApiError", async () => {
    const client = createVindiClient({
      keyKind: "private",
      apiKey: "test-private-key",
      baseUrl: "https://sandbox-app.vindi.com.br/api",
      fetch: (async () =>
        new Response(
          JSON.stringify({
            errors: [
              {
                id: "invalid_parameter",
                parameter: "registry_code",
                message: "não é um CPF válido",
              },
            ],
          }),
          { status: 422 },
        )) as typeof fetch,
    });

    await assert.rejects(
      () =>
        client.request({
          method: "POST",
          path: "/v1/customers",
          body: { name: "Ana", registry_code: "000" },
        }),
      (error: unknown) => {
        assert.ok(error instanceof VindiApiError);
        assert.equal(error.status, 422);
        assert.deepEqual(error.errors, [
          {
            id: "invalid_parameter",
            parameter: "registry_code",
            message: "não é um CPF válido",
          },
        ]);
        return true;
      },
    );
  });

  it("retries a 429 after waiting the Retry-After seconds", async () => {
    const slept: number[] = [];
    let attempts = 0;

    const client = createVindiClient({
      keyKind: "private",
      apiKey: "test-private-key",
      baseUrl: "https://sandbox-app.vindi.com.br/api",
      sleep: async (ms) => {
        slept.push(ms);
      },
      fetch: (async () => {
        attempts += 1;
        if (attempts === 1) {
          return new Response(JSON.stringify({ errors: [] }), {
            status: 429,
            headers: { "Retry-After": "2" },
          });
        }
        return new Response(JSON.stringify({ customer: { id: 41 } }), {
          status: 200,
        });
      }) as typeof fetch,
    });

    const result = await client.request<{ customer: { id: number } }>({
      method: "GET",
      path: "/v1/customers/41",
    });

    assert.equal(attempts, 2);
    assert.deepEqual(slept, [2000]);
    assert.deepEqual(result, { customer: { id: 41 } });
  });

  it("refuses a public path when constructed with the private key", async () => {
    let fetched = false;
    const client = createVindiClient({
      keyKind: "private",
      apiKey: "test-private-key",
      baseUrl: "https://sandbox-app.vindi.com.br/api",
      fetch: (async () => {
        fetched = true;
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
    });

    await assert.rejects(
      () =>
        client.request({
          method: "POST",
          path: "/v1/public/payment_profiles",
          body: { holder_name: "Ana" },
        }),
      /private key cannot call \/v1\/public\//,
    );
    assert.equal(fetched, false);
  });

  it("refuses a private path when constructed with the public key", async () => {
    let fetched = false;
    const client = createVindiClient({
      keyKind: "public",
      apiKey: "test-public-key",
      baseUrl: "https://sandbox-app.vindi.com.br/api",
      fetch: (async () => {
        fetched = true;
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
    });

    await assert.rejects(
      () => client.request({ method: "GET", path: "/v1/customers" }),
      /public key can only call \/v1\/public\//,
    );
    assert.equal(fetched, false);
  });

  it("sends the public key only on /v1/public paths", async () => {
    let capturedInit: RequestInit | undefined;
    const client = createVindiClient({
      keyKind: "public",
      apiKey: "test-public-key",
      baseUrl: "https://sandbox-app.vindi.com.br/api",
      fetch: (async (_input, init) => {
        capturedInit = init;
        return new Response(
          JSON.stringify({ payment_profile: { gateway_token: "tok_1" } }),
          { status: 201 },
        );
      }) as typeof fetch,
    });

    await client.request({
      method: "POST",
      path: "/v1/public/payment_profiles",
      body: { holder_name: "Ana" },
    });

    assert.equal(
      new Headers(capturedInit?.headers).get("Authorization"),
      "Basic dGVzdC1wdWJsaWMta2V5Og==",
    );
  });

  it("keeps monetary amounts as strings from the API payload", async () => {
    const client = createVindiClient({
      keyKind: "private",
      apiKey: "test-private-key",
      baseUrl: "https://sandbox-app.vindi.com.br/api",
      fetch: (async () =>
        new Response(
          JSON.stringify({
            bill: { id: 90, amount: "801.00", status: "paid" },
          }),
          { status: 200 },
        )) as typeof fetch,
    });

    const result = await client.request<{
      bill: { id: number; amount: string; status: string };
    }>({
      method: "GET",
      path: "/v1/bills/90",
    });

    assert.equal(result.bill.amount, "801.00");
    assert.equal(typeof result.bill.amount, "string");
  });

  it("treats a missing Retry-After as one second instead of retrying immediately", async () => {
    const slept: number[] = [];
    let attempts = 0;

    const client = createVindiClient({
      keyKind: "private",
      apiKey: "test-private-key",
      baseUrl: "https://sandbox-app.vindi.com.br/api",
      sleep: async (ms) => {
        slept.push(ms);
      },
      fetch: (async () => {
        attempts += 1;
        if (attempts === 1) {
          return new Response("{}", { status: 429 });
        }
        return new Response(JSON.stringify({ customers: [] }), { status: 200 });
      }) as typeof fetch,
    });

    await client.request({ method: "GET", path: "/v1/customers" });

    assert.deepEqual(slept, [1000]);
  });

  it("returns undefined when a successful response has an empty body", async () => {
    const client = createVindiClient({
      keyKind: "private",
      apiKey: "test-private-key",
      baseUrl: "https://sandbox-app.vindi.com.br/api",
      fetch: (async () => new Response(null, { status: 204 })) as typeof fetch,
    });

    const result = await client.request({
      method: "DELETE",
      path: "/v1/subscriptions/12",
    });

    assert.equal(result, undefined);
  });
});
