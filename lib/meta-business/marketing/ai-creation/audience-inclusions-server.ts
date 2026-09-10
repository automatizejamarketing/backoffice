import { customerFileDurableStore } from "@/lib/customer-file/postgres";
import { listCustomAudiences, type CustomAudienceView } from "../audiences";
import { localIssue, type CreateIssue } from "../creation/types";
import {
  validateAudienceInclusionIds,
  validateAudienceInclusionsAgainstLibrary,
} from "./audience-inclusions";

/** Re-read the account library and import ledger at the mutation boundary. */
export async function validateAudienceInclusionSelection(input: {
  adAccountId: string;
  accessToken: string;
  customerId?: string;
  ids?: readonly string[];
}): Promise<CreateIssue[]> {
  const localIssues = validateAudienceInclusionIds(input.ids);
  if (localIssues.length || input.ids === undefined || input.ids.length === 0) {
    return localIssues;
  }
  if (!input.customerId) {
    return [
      localIssue(
        "adset",
        "AUDIENCE_INCLUSION_CONTEXT_REQUIRED",
        "Não foi possível confirmar o cliente responsável pelos públicos selecionados.",
        "Atualize a sessão e revise as inclusões antes de publicar.",
        ["targeting", "custom_audiences"],
      ),
    ];
  }

  try {
    const history = await customerFileDurableStore().getLatestImportsForAudiences(
      input.customerId,
      [...new Set(input.ids)],
      input.adAccountId,
    );
    const audiences: CustomAudienceView[] = [];
    const seenCursors = new Set<string>();
    let after: string | undefined;

    for (let pageNumber = 0; pageNumber < 20; pageNumber += 1) {
      const page = await listCustomAudiences({
        adAccountId: input.adAccountId,
        accessToken: input.accessToken,
        detailed: true,
        ...(after ? { after } : {}),
        importHistory: history,
      });
      audiences.push(...page.items);
      if (!page.truncated) break;
      if (!page.nextCursor || seenCursors.has(page.nextCursor) || pageNumber === 19) {
        return [incompleteLibraryIssue()];
      }
      seenCursors.add(page.nextCursor);
      after = page.nextCursor;
    }

    return validateAudienceInclusionsAgainstLibrary(input.ids, audiences);
  } catch {
    return [
      {
        ...localIssue(
          "adset",
          "AUDIENCE_INCLUSION_REVALIDATION_FAILED",
          "Não foi possível revalidar as inclusões de públicos antes da publicação.",
          "Atualize a biblioteca e revise as inclusões antes de tentar novamente.",
          ["targeting", "custom_audiences"],
        ),
        transient: true,
      },
    ];
  }
}

function incompleteLibraryIssue(): CreateIssue {
  return {
    ...localIssue(
      "adset",
      "AUDIENCE_INCLUSION_LIBRARY_INCOMPLETE",
      "A biblioteca de públicos não pôde ser carregada por completo para confirmar as inclusões.",
      "Atualize a biblioteca e tente novamente antes de publicar.",
      ["targeting", "custom_audiences"],
    ),
    transient: true,
  };
}
