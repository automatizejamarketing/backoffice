import { customerFileDurableStore } from "@/lib/customer-file/postgres";
import {
  listCustomAudiences,
  type CustomAudienceView,
} from "../audiences";
import { localIssue, type CreateIssue } from "../creation/types";
import {
  validateAudienceInclusionIds,
  validateAudienceInclusionsAgainstLibrary,
} from "./audience-inclusions";

/** Read the account library and import ledger again at the mutation boundary. */
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
        "Nao foi possivel confirmar o cliente responsavel pelos publicos selecionados.",
        "Atualize a sessao e revise as inclusoes antes de publicar.",
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
      if (!page.nextCursor) return [incompleteLibraryIssue()];
      if (seenCursors.has(page.nextCursor)) return [incompleteLibraryIssue()];
      seenCursors.add(page.nextCursor);
      after = page.nextCursor;
      if (pageNumber === 19) return [incompleteLibraryIssue()];
    }

    return validateAudienceInclusionsAgainstLibrary(input.ids, audiences);
  } catch {
    return [
      {
        ...localIssue(
          "adset",
          "AUDIENCE_INCLUSION_REVALIDATION_FAILED",
          "Nao foi possivel revalidar as inclusoes de publicos antes da publicacao.",
          "Atualize a biblioteca e revise as inclusoes antes de tentar novamente.",
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
      "A biblioteca de publicos nao pode ser carregada por completo para confirmar as inclusoes.",
      "Atualize a biblioteca e tente novamente antes de publicar.",
      ["targeting", "custom_audiences"],
    ),
    transient: true,
  };
}
