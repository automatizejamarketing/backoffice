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

/** Extract dotted IPv4 from IPv4-mapped IPv6 (`::ffff:127.0.0.1` / `::ffff:7f00:1`). */
function ipv4FromMappedIpv6(ip: string): string | null {
  const normalized = normalizeHostname(ip).toLowerCase();
  const mappedPrefix = "::ffff:";
  if (!normalized.startsWith(mappedPrefix)) {
    return null;
  }

  const rest = normalized.slice(mappedPrefix.length);
  if (net.isIP(rest) === 4) {
    return rest;
  }

  const hex = rest.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex?.[1] || !hex[2]) {
    return null;
  }

  const hi = Number.parseInt(hex[1], 16);
  const lo = Number.parseInt(hex[2], 16);
  if (Number.isNaN(hi) || Number.isNaN(lo)) {
    return null;
  }

  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
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

function isPrivateIpv6(ip: string): boolean {
  const mappedIpv4 = ipv4FromMappedIpv6(ip);
  if (mappedIpv4) {
    return isPrivateIpv4(mappedIpv4);
  }

  const normalized = normalizeHostname(ip).toLowerCase();
  if (normalized === "::1" || normalized === "::") {
    return true;
  }
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) {
    return true;
  }
  if (
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  ) {
    return true;
  }
  return false;
}

function isBlockedIp(ip: string): boolean {
  const normalized = normalizeHostname(ip);
  const mappedIpv4 = ipv4FromMappedIpv6(normalized);
  if (mappedIpv4) {
    return isPrivateIpv4(mappedIpv4);
  }

  const version = net.isIP(normalized);
  if (version === 4) {
    return isPrivateIpv4(normalized);
  }
  if (version === 6) {
    return isPrivateIpv6(normalized);
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
