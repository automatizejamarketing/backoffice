import dns from "node:dns/promises";
import https from "node:https";
import net from "node:net";

const MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BODY_BYTES = 25 * 1024 * 1024;

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.goog",
]);

/** Strip brackets Node may keep on `URL.hostname` for IPv6 literals. */
function normalizeHostname(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
    return true;
  }

  const [a, b] = parts;
  if (a === 10) {
    return true;
  }
  if (a === 127) {
    return true;
  }
  if (a === 0) {
    return true;
  }
  // CGNAT / carrier-grade NAT
  if (a === 100 && b >= 64 && b <= 127) {
    return true;
  }
  if (a === 169 && b === 254) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  return false;
}

/**
 * Expand an IPv6 literal to 16 bytes. Handles compressed `::` and dotted
 * IPv4 tails (`::ffff:127.0.0.1`).
 */
function ipv6ToBytes(ip: string): Uint8Array | null {
  let normalized = normalizeHostname(ip).toLowerCase();
  if (!normalized.includes(":")) {
    return null;
  }

  const dottedTail = normalized.match(
    /:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/,
  );
  if (dottedTail?.[1]) {
    const octets = dottedTail[1].split(".").map((part) => Number.parseInt(part, 10));
    if (
      octets.length !== 4 ||
      octets.some((octet) => Number.isNaN(octet) || octet < 0 || octet > 255)
    ) {
      return null;
    }
    const hi = ((octets[0]! << 8) | octets[1]!).toString(16);
    const lo = ((octets[2]! << 8) | octets[3]!).toString(16);
    normalized = `${normalized.slice(0, -dottedTail[1].length)}${hi}:${lo}`;
  }

  if (normalized.includes(":::")) {
    return null;
  }

  const sides = normalized.split("::");
  if (sides.length > 2) {
    return null;
  }

  const left = sides[0] ? sides[0].split(":").filter(Boolean) : [];
  const right = sides[1] ? sides[1].split(":").filter(Boolean) : [];
  const fill = sides.length === 2 ? 8 - left.length - right.length : 0;
  if (fill < 0 || (sides.length === 1 && left.length !== 8)) {
    return null;
  }

  const hextets = [
    ...left,
    ...Array.from({ length: fill }, () => "0"),
    ...right,
  ];
  if (hextets.length !== 8) {
    return null;
  }

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i += 1) {
    const value = Number.parseInt(hextets[i] ?? "0", 16);
    if (Number.isNaN(value) || value < 0 || value > 0xffff) {
      return null;
    }
    bytes[i * 2] = (value >> 8) & 0xff;
    bytes[i * 2 + 1] = value & 0xff;
  }
  return bytes;
}

function bytesEqualPrefix(bytes: Uint8Array, prefix: number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value);
}

/**
 * When an IPv6 address embeds an IPv4 (mapped / translated / compatible /
 * NAT64), return the dotted IPv4 so private-range checks apply.
 */
function ipv4FromEmbeddedIpv6(bytes: Uint8Array): string | null {
  const last32 = `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`;

  // ::/96 IPv4-compatible (deprecated) — first 96 bits zero
  const ipv4Compatible = bytes.slice(0, 12).every((byte) => byte === 0);
  // ::ffff:0:0/96 IPv4-mapped
  const ipv4Mapped =
    bytes.slice(0, 10).every((byte) => byte === 0) &&
    bytes[10] === 0xff &&
    bytes[11] === 0xff;
  // ::ffff:0:0:0/96 IPv4-translated (`::ffff:0:7f00:1`)
  const ipv4Translated =
    bytes.slice(0, 8).every((byte) => byte === 0) &&
    bytes[8] === 0xff &&
    bytes[9] === 0xff &&
    bytes[10] === 0 &&
    bytes[11] === 0;
  // 64:ff9b::/96 well-known NAT64 prefix
  const isNat64 =
    bytesEqualPrefix(bytes, [0x00, 0x64, 0xff, 0x9b]) &&
    bytes.slice(4, 12).every((byte) => byte === 0);

  if (ipv4Compatible || ipv4Mapped || ipv4Translated || isNat64) {
    return last32;
  }
  return null;
}

function isBlockedIpv6(ip: string): boolean {
  const bytes = ipv6ToBytes(ip);
  if (!bytes) {
    return true;
  }

  const embeddedIpv4 = ipv4FromEmbeddedIpv6(bytes);
  if (embeddedIpv4) {
    return isPrivateIpv4(embeddedIpv4);
  }

  // Unspecified / loopback
  if (bytes.every((byte) => byte === 0) || (
    bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1
  )) {
    return true;
  }

  // Multicast ff00::/8
  if (bytes[0] === 0xff) {
    return true;
  }

  // ULA fc00::/7
  if ((bytes[0]! & 0xfe) === 0xfc) {
    return true;
  }

  // Link-local fe80::/10
  if (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0x80) {
    return true;
  }

  return false;
}

function isBlockedIp(ip: string): boolean {
  const normalized = normalizeHostname(ip);
  const version = net.isIP(normalized);
  if (version === 4) {
    return isPrivateIpv4(normalized);
  }
  if (version === 6 || normalized.includes(":")) {
    return isBlockedIpv6(normalized);
  }
  return true;
}

async function resolveHostAddresses(hostname: string): Promise<string[]> {
  const normalized = normalizeHostname(hostname);
  if (net.isIP(normalized)) {
    return [normalized];
  }

  const results = await dns.lookup(normalized, { all: true, verbatim: true });
  return results.map((entry) => entry.address);
}

/** Validates a URL before server-side fetch (blocks private networks / metadata). */
export async function assertSafeFetchUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("URL de imagem inválida.");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("Somente URLs HTTPS são permitidas para upload de imagem.");
  }

  const hostname = normalizeHostname(parsed.hostname).toLowerCase();
  if (
    BLOCKED_HOSTNAMES.has(hostname) ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  ) {
    throw new Error("Host de imagem não permitido.");
  }

  const addresses = await resolveHostAddresses(hostname);
  if (addresses.length === 0) {
    throw new Error("Não foi possível resolver o host da imagem.");
  }

  for (const address of addresses) {
    if (isBlockedIp(address)) {
      throw new Error("Host de imagem aponta para rede privada ou local.");
    }
  }

  return parsed;
}

type PinnedFetchResult = {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
};

export type SafeFetchUrlOptions = {
  timeoutMs?: number;
  maxBodyBytes?: number;
};

function fetchPinnedHttps(
  url: URL,
  pinnedIp: string,
  options: { timeoutMs: number; maxBodyBytes: number; signal?: AbortSignal },
): Promise<PinnedFetchResult> {
  const port = url.port ? Number.parseInt(url.port, 10) : 443;

  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        host: pinnedIp,
        port,
        servername: url.hostname,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: {
          Host: url.hostname,
        },
        signal: options.signal,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let totalBytes = 0;

        response.on("data", (chunk: Buffer) => {
          totalBytes += chunk.length;
          if (totalBytes > options.maxBodyBytes) {
            request.destroy();
            response.destroy();
            reject(
              new Error(
                `Resposta excede o limite de ${options.maxBodyBytes} bytes.`,
              ),
            );
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            headers: Object.fromEntries(
              Object.entries(response.headers).flatMap(([key, value]) => {
                if (value == null) {
                  return [];
                }
                const normalized = Array.isArray(value) ? value[0] : value;
                return normalized ? [[key.toLowerCase(), normalized]] : [];
              }),
            ),
            body: Buffer.concat(chunks),
          });
        });
        response.on("error", reject);
      },
    );

    request.setTimeout(options.timeoutMs, () => {
      request.destroy(new Error("Tempo esgotado ao buscar a URL."));
    });
    request.on("error", reject);
    request.end();
  });
}

function toResponse(result: PinnedFetchResult): Response {
  const responseHeaders = new Headers();
  for (const [key, value] of Object.entries(result.headers)) {
    responseHeaders.set(key, value);
  }

  return new Response(new Uint8Array(result.body), {
    status: result.status,
    headers: responseHeaders,
  });
}

/**
 * Fetches a URL after SSRF validation, pinning to the resolved public IP and
 * re-validating each redirect hop (redirect: manual).
 */
export async function safeFetchUrl(
  rawUrl: string,
  options: SafeFetchUrlOptions = {},
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  let currentUrl = rawUrl;

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      if (controller.signal.aborted) {
        throw new Error("Tempo esgotado ao buscar a URL.");
      }

      const parsed = await assertSafeFetchUrl(currentUrl);
      const addresses = await resolveHostAddresses(parsed.hostname);

      for (const address of addresses) {
        if (isBlockedIp(address)) {
          throw new Error("Host de imagem aponta para rede privada ou local.");
        }
      }

      const pinnedIp = addresses[0];
      if (!pinnedIp) {
        throw new Error("Não foi possível resolver o host da imagem.");
      }

      const result = await fetchPinnedHttps(parsed, pinnedIp, {
        timeoutMs,
        maxBodyBytes,
        signal: controller.signal,
      });

      if (result.status >= 300 && result.status < 400) {
        const location = result.headers.location;
        if (!location) {
          throw new Error("Redirect sem destino.");
        }
        currentUrl = new URL(location, parsed).toString();
        continue;
      }

      return toResponse(result);
    }

    throw new Error("Muitos redirects ao buscar a URL.");
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "AbortError" || controller.signal.aborted)
    ) {
      throw new Error("Tempo esgotado ao buscar a URL.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
