import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type { BackofficeActor } from "@/lib/auth/rbac-core";

/**
 * Ator injetado por código do servidor para reaproveitar rotas que leem o
 * colaborador da sessão do navegador. Hoje só o MCP usa: depois de validar o
 * token OAuth e reler o cargo no banco, ele chama as mesmas rotas de mutação da
 * Meta que a tela chama, com a mesma validação e a mesma auditoria.
 *
 * Nunca derive o ator de algo que venha da requisição: só de um token já
 * verificado.
 */
const storage = new AsyncLocalStorage<BackofficeActor>();

export function runAsBackofficeActor<T>(actor: BackofficeActor, fn: () => Promise<T>): Promise<T> {
  return storage.run(actor, fn);
}

export function injectedBackofficeActor(): BackofficeActor | undefined {
  return storage.getStore();
}
