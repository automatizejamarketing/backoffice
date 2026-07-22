import { describe, expect, test } from "bun:test";
import { assertSafeFetchUrl } from "./safe-fetch-url";

describe("assertSafeFetchUrl", () => {
  test("rejects IPv4-mapped loopback and metadata hosts", async () => {
    // Node may rewrite dotted mapped form to hex (`::ffff:7f00:1`).
    await expect(
      assertSafeFetchUrl("https://[::ffff:127.0.0.1]/image.png"),
    ).rejects.toThrow(/privada|local/i);

    await expect(
      assertSafeFetchUrl("https://[::ffff:7f00:1]/image.png"),
    ).rejects.toThrow(/privada|local/i);

    await expect(
      assertSafeFetchUrl("https://[::ffff:a9fe:a9fe]/latest/meta-data/"),
    ).rejects.toThrow(/privada|local/i);

    await expect(
      assertSafeFetchUrl("https://[::ffff:10.0.0.1]/image.png"),
    ).rejects.toThrow(/privada|local/i);
  });

  test("rejects CGNAT range", async () => {
    await expect(
      assertSafeFetchUrl("https://100.64.0.1/image.png"),
    ).rejects.toThrow(/privada|local/i);
  });
});
