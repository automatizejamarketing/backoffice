import { metaApiCall } from "@/lib/meta-business/api";
import { GraphApiError } from "@/lib/meta-business/error";

type LookalikeCreateInput = {
  adAccountId: string;
  accessToken: string;
  type: "lookalike";
  originAudienceId: string;
  name: string;
  description?: string;
  lookalikeCountry: string;
  lookalikeRatio: number;
};

type CustomerListCreateInput = {
  adAccountId: string;
  accessToken: string;
  type: "raw";
  subtype: string;
  customerFileSource?: string;
  name: string;
  description?: string;
};

type CreateInput = LookalikeCreateInput | CustomerListCreateInput;

type CreateIssue = {
  code: string;
  reason: string;
  suggestion: string;
  transient?: boolean;
};

type CreateResult =
  | { ok: true; id: string; data: { id: string } }
  | { ok: false; error: string; message: string; issues: CreateIssue[] };

function failure(message: string, code = "META_CREATE_FAILED", transient = false): Extract<CreateResult, { ok: false }> {
  return {
    ok: false,
    error: "Create failed",
    message,
    issues: [{ code, reason: message, suggestion: "Revise os dados e tente novamente.", ...(transient ? { transient: true } : {}) }],
  };
}

function audiencePayload(input: CreateInput): URLSearchParams {
  const body = new URLSearchParams({ name: input.name.trim() });
  if (input.description) body.set("description", input.description);
  if (input.type === "lookalike") {
    body.set("origin_audience_id", input.originAudienceId);
    body.set("lookalike_spec", JSON.stringify({
      type: "similarity",
      country: input.lookalikeCountry,
      ratio: input.lookalikeRatio,
    }));
  } else {
    body.set("subtype", input.subtype);
    if (input.customerFileSource) body.set("customer_file_source", input.customerFileSource);
  }
  return body;
}

function audienceEdge(input: CreateInput): string {
  return input.type === "lookalike" ? "customaudiences" : "customaudiences";
}

export function previewCustomAudience(input: CreateInput):
  | { ok: true; payload: Record<string, string> }
  | { ok: false; issues: CreateIssue[] } {
  if (!input.name.trim()) return { ok: false, issues: [{ code: "NAME_REQUIRED", reason: "O público precisa de um nome.", suggestion: "Informe um nome para a lista." }] };
  if (input.type === "raw" && !input.subtype.trim()) return { ok: false, issues: [{ code: "SUBTYPE_REQUIRED", reason: "A lista precisa do subtipo CUSTOM.", suggestion: "Informe subtype=CUSTOM." }] };
  return { ok: true, payload: Object.fromEntries(audiencePayload(input)) };
}

export async function createCustomAudience(
  input: CreateInput,
): Promise<CreateResult> {
  const preview = previewCustomAudience(input);
  if (!preview.ok) return failure(preview.issues[0]?.reason ?? "Dados inválidos", preview.issues[0]?.code);
  const account = input.adAccountId.startsWith("act_")
    ? input.adAccountId
    : `act_${input.adAccountId}`;
  try {
    const created = await metaApiCall<{ id?: string }>({
      method: "POST",
      path: `${account}/${audienceEdge(input)}`,
      params: "",
      body: audiencePayload(input),
      accessToken: input.accessToken,
    });
    if (!created.id) {
      return failure("A Meta não devolveu o identificador do público.", "META_ID_MISSING");
    }
    return { ok: true, id: created.id, data: { id: created.id } };
  } catch (error) {
    const transient = error instanceof GraphApiError && (error.errorReturn.reason.isTransient || error.errorReturn.statusCode >= 500);
    return failure(error instanceof Error ? error.message : "Não foi possível criar o público.", "META_CREATE_FAILED", transient);
  }
}
