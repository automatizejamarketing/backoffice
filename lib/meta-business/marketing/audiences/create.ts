import { metaApiCall } from "@/lib/meta-business/api";

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

export async function createCustomAudience(
  input: LookalikeCreateInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string; message: string }> {
  const account = input.adAccountId.startsWith("act_")
    ? input.adAccountId
    : `act_${input.adAccountId}`;
  const body = new URLSearchParams({
    name: input.name.trim(),
    origin_audience_id: input.originAudienceId,
    lookalike_spec: JSON.stringify({
      type: "similarity",
      country: input.lookalikeCountry,
      ratio: input.lookalikeRatio,
    }),
  });
  if (input.description) body.set("description", input.description);
  try {
    const created = await metaApiCall<{ id?: string }>({
      method: "POST",
      path: `${account}/customaudiences`,
      params: "",
      body,
      accessToken: input.accessToken,
    });
    if (!created.id) {
      return { ok: false, error: "Create failed", message: "A Meta não devolveu o identificador do público." };
    }
    return { ok: true, id: created.id };
  } catch (error) {
    return {
      ok: false,
      error: "Create failed",
      message: error instanceof Error ? error.message : "Não foi possível criar o público semelhante.",
    };
  }
}
