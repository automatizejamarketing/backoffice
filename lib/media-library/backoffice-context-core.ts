import {
  canAccessMarketingUser,
  hasBackofficePermission,
  type BackofficeActor,
} from "@/lib/auth/rbac-core";
import type { MediaLibraryRequestContext } from "@/lib/media-library/handlers";

/**
 * Contexto da Biblioteca de mídias para o ator do backoffice. Puro: sem `server-only`
 * e sem sessão, para ser testado isoladamente. `backoffice-context.ts` o usa com o RBAC.
 * `canWrite` decide os botões de adicionar/excluir na tela (admin: qualquer cliente;
 * consultor comum: só o atribuído).
 */
export function buildBackofficeMediaLibraryContext(
  actor: BackofficeActor,
  userId: string,
): MediaLibraryRequestContext {
  return {
    userId,
    actor: { kind: "backoffice", email: actor.email },
    viewer: {
      canWrite: hasBackofficePermission(actor, "marketing:write") && canAccessMarketingUser(actor, userId),
    },
  };
}
