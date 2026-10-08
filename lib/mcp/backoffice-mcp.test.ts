import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { safeLoginReturn } from "@/lib/auth/login-return";
import { assertPublicHttpsUrl, directDownloadUrl, importCampaignMedia, sniffCampaignMedia } from "@/lib/backoffice/whatsapp-campaign-media";
import { sendConfirmationCode } from "./send-confirmation";

describe("send confirmation code", () => {
  const base = { campaignId: "c1", revision: "2026-10-08 13:00:00+00", scheduledAt: "2026-10-09T15:00:00-03:00", userIds: ["b", "a"] };
  it("is stable for the same preview regardless of audience order", () => {
    assert.equal(sendConfirmationCode(base, "s"), sendConfirmationCode({ ...base, userIds: ["a", "b"] }, "s"));
  });
  it("changes when the campaign, time, audience or secret change", () => {
    const code = sendConfirmationCode(base, "s");
    for (const changed of [{ ...base, revision: "x" }, { ...base, scheduledAt: null }, { ...base, userIds: ["a"] }, { ...base, campaignId: "c2" }])
      assert.notEqual(sendConfirmationCode(changed, "s"), code);
    assert.notEqual(sendConfirmationCode(base, "other"), code);
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
