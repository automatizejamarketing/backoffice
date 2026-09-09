import { customerFileDurableStore } from "@/lib/customer-file/postgres";
import {
  listCustomAudiences,
  type CustomAudienceView,
} from "../audiences";
import { localIssue, type CreateIssue } from "../creation/types";
import {
  validateAudienceExclusionIds,
  validateAudienceExclusionsAgainstLibrary,
} from "./audience-exclusions";

/**
 * Read the account library and the import ledger again at the mutation
 * boundary. Missing history is allowed; a known compromised import is not.
 */
export async function validateAudienceExclusionSelection(input: {
  adAccountId: string;
  accessToken: string;
  customerId?: string;
  ids?: readonly string[];
}): Promise<CreateIssue[]> {
  const localIssues = validateAudienceExclusionIds(input.ids);
  if (localIssues.length || input.ids === undefined || input.ids.length === 0) {
    return localIssues;
  }
  if (!input.customerId) {
    return [
      localIssue(
        "adset",
        "AUDIENCE_EXCLUSION_CONTEXT_REQUIRED",
        "Não foi possível confirmar o cliente responsável pelos públicos selecionados.",
        "Atualize a sessão e revise as exclusões antes de publicar.",
        ["targeting", "excluded_custom_audiences"],
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

    // The normal account page is 200 items. Follow its cursors so an audience
    // on a later page cannot be treated as missing after a context change.
    for (let pageNumber = 0; pageNumber < 20; pageNumber += 1) {
      const page = await listCustomAudiences({
        adAccountId: input.adAccountId,
        accessToken: input.accessToken,
        detailed: true,
        ...(after ? { after } : {}),
        importHistory: history,
      });
      audiences.push(...page.items);
      if (!page.truncated || !page.nextCursor || seenCursors.has(page.nextCursor)) {
        break;
      }
      seenCursors.add(page.nextCursor);
      after = page.nextCursor;
    }

    return validateAudienceExclusionsAgainstLibrary(input.ids, audiences);
  } catch {
    return [
      {
        ...localIssue(
          "adset",
          "AUDIENCE_EXCLUSION_REVALIDATION_FAILED",
          "Não foi possível revalidar as exclusões de públicos antes da publicação.",
          "Atualize a biblioteca e revise as exclusões antes de tentar novamente.",
          ["targeting", "excluded_custom_audiences"],
        ),
        transient: true,
      },
    ];
  }
}
