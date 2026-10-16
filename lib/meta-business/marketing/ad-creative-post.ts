/**
 * POST /{act}/adcreatives a partir de campos prontos, sempre pedindo a expansão
 * de formato sem corte (`withPlacementExpansion`, regra de produto de
 * 30/09/2026): na conta que a Meta não deixa usar IA generativa (3858023), refaz
 * UMA vez sem nenhum recurso.
 *
 * Existe para os construtores que montam o criativo à mão (wizards por nicho,
 * "novo anúncio") não repetirem essa regra. O upload de mídia acontece ANTES,
 * no chamador: a nova tentativa reaproveita o mesmo `image_hash`/`video_id`.
 *
 * `fail` recebe o corpo de erro da Graph e o status HTTP e DEVE lançar — cada
 * chamador mantém o próprio tipo de erro e log.
 */
import { fetchMetaGraph } from "@/lib/observability/meta-fetch";
import { withPlacementExpansion } from "@/lib/meta-business/creative-features";
import { graphApiVersion, graphFacebookBaseUrl } from "../constant";

export async function postAdCreativeForm<T>(args: {
  adAccountId: string;
  accessToken: string;
  fields: Record<string, string>;
  fail: (data: unknown, status: number) => never;
}): Promise<T> {
  const url = `${graphFacebookBaseUrl}/${graphApiVersion}/${args.adAccountId}/adcreatives`;
  return withPlacementExpansion(async (degreesOfFreedomSpec) => {
    const formData = new FormData();
    for (const [key, value] of Object.entries(args.fields)) formData.append(key, value);
    if (degreesOfFreedomSpec) formData.append("degrees_of_freedom_spec", degreesOfFreedomSpec);
    formData.append("access_token", args.accessToken);

    const { response, data } = await fetchMetaGraph(url, {
      method: "POST",
      body: formData,
      requestParams: formData,
      entity: "adcreative",
      operation: "create",
    });

    if (!response.ok || (data as { error?: unknown }).error) args.fail(data, response.status);
    return data as T;
  });
}
