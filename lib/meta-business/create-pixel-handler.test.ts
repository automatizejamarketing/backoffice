import { describe, expect, test } from "bun:test";

import type { CreatePixelLogData } from "@/lib/db/admin-queries";
import type { AiCampaignAuth } from "@/lib/meta-business/ai-campaign-auth";
import type { CreateIssue } from "@/lib/meta-business/marketing/creation/types";
import {
  createPixelFailureStatus,
  handleCreatePixel,
  type CreatePixelHandlerDeps,
} from "./create-pixel-handler";

const auth: { ok: true } & AiCampaignAuth = {
  ok: true,
  actor: { id: "op-1", email: "op@automatize.com", role: "admin" } as unknown as AiCampaignAuth["actor"],
  userId: "user-1",
  accountId: "123",
  accessToken: "tok",
  connection: null,
};

const issue = (patch: Partial<CreateIssue>): CreateIssue => ({
  stage: "create",
  level: "pixel",
  code: "META_1",
  reason: "motivo",
  suggestion: "sugestão",
  ...patch,
});

function request(body: unknown) {
  return new Request("http://localhost/api/meta-marketing/123/pixels?userId=user-1", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function setup(overrides: Partial<CreatePixelHandlerDeps<Request>> = {}) {
  const audits: CreatePixelLogData[] = [];
  const creates: Array<[string, string, string]> = [];
  const auditFailures: unknown[] = [];
  const deps: CreatePixelHandlerDeps<Request> = {
    authorize: async () => auth,
    createPixel: async (accountId, token, name) => {
      creates.push([accountId, token, name]);
      return { ok: true, id: "PX1", data: { id: "PX1", name: name.trim() } };
    },
    writeAudit: async (entry) => {
      audits.push(entry);
    },
    onAuditFailure: (error) => auditFailures.push(error),
    tokenInvalidResponse: () => Response.json({ needsReconnect: true }, { status: 401 }),
    ...overrides,
  };
  return { deps, audits, creates, auditFailures };
}

describe("handleCreatePixel", () => {
  test("cria com o token do cliente e grava a auditoria", async () => {
    const { deps, audits, creates } = setup();
    const res = await handleCreatePixel(request({ name: "Pixel – Loja" }), "act_123", deps);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ success: true, id: "PX1", name: "Pixel – Loja", auditLogFailed: false });
    expect(creates).toEqual([["123", "tok", "Pixel – Loja"]]);
    expect(audits).toEqual([
      {
        backofficeUserEmail: "op@automatize.com",
        targetUserId: "user-1",
        adAccountId: "123",
        pixelId: "PX1",
        pixelName: "Pixel – Loja",
      },
    ]);
  });

  test("autorização negada volta como veio e não chama a Meta", async () => {
    const { deps, creates } = setup({
      authorize: async () => ({ ok: false, response: Response.json({ denied: true }, { status: 403 }) }),
    });
    const res = await handleCreatePixel(request({ name: "Pixel" }), "123", deps);
    expect(res.status).toBe(403);
    expect(creates).toHaveLength(0);
  });

  test("auditoria falhando não derruba a criação", async () => {
    const { deps, auditFailures } = setup({
      writeAudit: async () => {
        throw new Error("db down");
      },
    });
    const res = await handleCreatePixel(request({ name: "Pixel" }), "123", deps);
    expect(res.status).toBe(201);
    expect((await res.json()).auditLogFailed).toBe(true);
    expect(auditFailures).toHaveLength(1);
  });

  test("corpo sem nome chega ao helper como string vazia", async () => {
    const { deps, creates } = setup({
      createPixel: async (accountId, token, name) => {
        creates.push([accountId, token, name]);
        return { ok: false, issues: [issue({ stage: "local", code: "PIXEL_INVALID_PARAMETER" })] };
      },
    });
    const res = await handleCreatePixel(request({}), "123", deps);
    expect(res.status).toBe(400);
    expect(creates).toEqual([["123", "tok", ""]]);
  });

  test("pixel já existente → 409 com o código da issue", async () => {
    const { deps } = setup({
      createPixel: async () => ({
        ok: false,
        issues: [issue({ code: "PIXEL_ALREADY_EXISTS", metaCode: 6200 })],
      }),
    });
    const res = await handleCreatePixel(request({ name: "Pixel" }), "123", deps);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ success: false, code: "PIXEL_ALREADY_EXISTS", metaCode: 6200 });
  });

  test("token morto do cliente → resposta de reconexão", async () => {
    const { deps } = setup({
      createPixel: async () => ({ ok: false, issues: [issue({ code: "META_190", metaCode: 190 })] }),
    });
    const res = await handleCreatePixel(request({ name: "Pixel" }), "123", deps);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ needsReconnect: true });
  });
});

describe("createPixelFailureStatus", () => {
  test("mapeia cada código", () => {
    expect(createPixelFailureStatus(issue({ code: "PIXEL_INVALID_PARAMETER", metaCode: 100 }))).toBe(400);
    expect(createPixelFailureStatus(issue({ code: "PIXEL_PERMISSION_DENIED", metaCode: 200 }))).toBe(403);
    expect(createPixelFailureStatus(issue({ code: "PIXEL_ALREADY_EXISTS", metaCode: 6202 }))).toBe(409);
    expect(createPixelFailureStatus(issue({ code: "META_102", metaCode: 102 }))).toBeNull();
    expect(createPixelFailureStatus(issue({ code: "UNEXPECTED" }))).toBe(500);
  });
});
