import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { safeLoginReturn } from "@/lib/auth/login-return";
import { assertPublicHttpsUrl, directDownloadUrl, importCampaignMedia, isPublicAddress, sniffCampaignMedia } from "@/lib/backoffice/whatsapp-campaign-media";
import { SEND_CONFIRMATION_TTL_MS, sendConfirmationCode, verifySendConfirmation } from "./send-confirmation";

describe("send confirmation code", () => {
  const base = { campaignId: "c1", revision: "2026-10-08 13:00:00+00", scheduledAt: "2026-10-09T15:00:00-03:00", userIds: ["b", "a"] };
  const now = Date.parse("2026-10-08T16:00:00Z");
  it("verifies the same preview regardless of audience order", () => {
    assert.equal(verifySendConfirmation(sendConfirmationCode(base, "s", now), { ...base, userIds: ["a", "b"] }, "s", now + 1000), "ok");
  });
  it("rejects a changed campaign, time, audience or secret", () => {
    const code = sendConfirmationCode(base, "s", now);
    for (const changed of [{ ...base, revision: "x" }, { ...base, scheduledAt: null }, { ...base, userIds: ["a"] }, { ...base, campaignId: "c2" }])
      assert.equal(verifySendConfirmation(code, changed, "s", now), "mismatch");
    assert.equal(verifySendConfirmation(code, base, "other", now), "mismatch");
  });
  it("expires, and a forged expiry does not verify", () => {
    const code = sendConfirmationCode({ ...base, scheduledAt: null }, "s", now);
    assert.equal(verifySendConfirmation(code, { ...base, scheduledAt: null }, "s", now + SEND_CONFIRMATION_TTL_MS + 1), "expired");
    const forged = `${(now + 10 * SEND_CONFIRMATION_TTL_MS).toString(36)}.${code.split(".")[1]}`;
    assert.equal(verifySendConfirmation(forged, { ...base, scheduledAt: null }, "s", now + SEND_CONFIRMATION_TTL_MS + 1), "mismatch");
    assert.equal(verifySendConfirmation("garbage", base, "s", now), "mismatch");
  });
});

describe("login return", () => {
  it("only allows the MCP consent page", () => {
    assert.equal(safeLoginReturn("/oauth/authorize?client_id=x"), "/oauth/authorize?client_id=x");
    for (const value of ["/", "//evil.com", "https://evil.com/oauth/authorize?", "/oauth/authorizex", null, undefined]) assert.equal(safeLoginReturn(value), null);
  });
});

describe("campaign media by link", () => {
  const mp4 = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  it("turns Drive share links into direct downloads", () => {
    assert.equal(directDownloadUrl("https://drive.google.com/file/d/abc123/view?usp=sharing"), "https://drive.usercontent.google.com/download?id=abc123&export=download&confirm=t");
    assert.equal(directDownloadUrl("https://cdn.example.com/a.mp4"), "https://cdn.example.com/a.mp4");
  });
  it("rejects non-https, localhost and IP literal hosts", () => {
    for (const url of ["http://example.com/a.mp4", "https://localhost/a.mp4", "https://127.0.0.1/a.mp4", "https://[::1]/a.mp4", "not a url"]) assert.throws(() => assertPublicHttpsUrl(url));
    assert.doesNotThrow(() => assertPublicHttpsUrl("https://example.com/a.mp4"));
  });
  it("only treats public addresses as fetchable", () => {
    for (const ip of ["10.0.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.1", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) assert.equal(isPublicAddress(ip), false, ip);
    for (const ip of ["8.8.8.8", "142.250.79.46", "2800:3f0:4001:80d::200e"]) assert.equal(isPublicAddress(ip), true, ip);
  });
  it("re-validates redirects and refuses internal destinations", async () => {
    const store = async () => "https://media.example/x";
    const redirectTo = (location: string) => (async () => new Response(null, { status: 302, headers: { location } })) as unknown as typeof fetch;
    await assert.rejects(importCampaignMedia("c1", "https://example.com/v", store, redirectTo("http://169.254.169.254/latest")), /https/);
    await assert.rejects(importCampaignMedia("c1", "https://example.com/v", store, redirectTo("https://127.0.0.1/x")), /público/);
    await assert.rejects(importCampaignMedia("c1", "https://example.com/v", store, redirectTo("https://example.com/loop")), /redireciona demais/);
  });
  it("detects the type from the file signature", () => {
    assert.equal(sniffCampaignMedia(mp4)?.kind, "video");
    assert.equal(sniffCampaignMedia(jpg)?.contentType, "image/jpeg");
    assert.equal(sniffCampaignMedia(new TextEncoder().encode("<html>")), null);
  });
  it("stores a valid file and refuses oversized or unknown ones", async () => {
    const stored: string[] = [];
    const store = async (pathname: string) => { stored.push(pathname); return `https://media.example/${pathname}`; };
    const fetchBytes = (bytes: Uint8Array, headers: Record<string, string> = {}) => (async () => new Response(new Blob([bytes as BlobPart]), { headers })) as unknown as typeof fetch;
    assert.deepEqual(await importCampaignMedia("c1", "https://example.com/v", store, fetchBytes(mp4)), { type: "video", url: "https://media.example/whatsapp-campaigns/c1.mp4" });
    await assert.rejects(importCampaignMedia("c1", "https://example.com/v", store, fetchBytes(new TextEncoder().encode("<html>"))), /Formato não aceito/);
    await assert.rejects(importCampaignMedia("c1", "https://example.com/v", store, fetchBytes(mp4, { "content-length": String(80 * 1024 * 1024) })), /16 MB/);
    const bigImage = new Uint8Array(6 * 1024 * 1024); bigImage.set(jpg);
    await assert.rejects(importCampaignMedia("c1", "https://example.com/i", store, fetchBytes(bigImage)), /5 MB/);
    assert.equal(stored.length, 1);
  });
});
