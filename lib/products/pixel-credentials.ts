import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { productPixelCredential } from "@/lib/db/schema";
import type { ConversionsApiTokenChange } from "./tracking-pixels";

type DbExecutor =
  | typeof db
  | Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Dono do token: o expert do produto, ou a Automatize (`null`). */
function ownerIs(expertId: string | null) {
  return expertId
    ? eq(productPixelCredential.expertId, expertId)
    : isNull(productPixelCredential.expertId);
}

/** Pixels Meta com token salvo — só os IDs; o token nunca volta ao cliente. */
export async function listConversionsApiPixelIds(
  expertId: string | null,
): Promise<string[]> {
  const rows = await db
    .select({ pixelId: productPixelCredential.pixelId })
    .from(productPixelCredential)
    .where(and(ownerIs(expertId), eq(productPixelCredential.provider, "meta")));
  return rows.map((row) => row.pixelId);
}

export async function applyConversionsApiTokenChanges(
  executor: DbExecutor,
  expertId: string | null,
  changes: ConversionsApiTokenChange[],
) {
  try {
    await writeTokenChanges(executor, expertId, changes);
  } catch (error) {
    // O erro do driver traz os parâmetros do INSERT — inclusive o token — e as
    // rotas devolvem a mensagem ao cliente. Loga sem ela e responde genérico.
    console.error(
      "[pixel-credentials] write failed",
      error instanceof Error ? error.name : "unknown",
    );
    throw new Error("Não foi possível salvar o token da API de Conversões.");
  }
}

async function writeTokenChanges(
  executor: DbExecutor,
  expertId: string | null,
  changes: ConversionsApiTokenChange[],
) {
  for (const change of changes) {
    await executor
      .delete(productPixelCredential)
      .where(
        and(
          ownerIs(expertId),
          eq(productPixelCredential.provider, "meta"),
          eq(productPixelCredential.pixelId, change.pixelId),
        ),
      );
    if (change.accessToken) {
      await executor.insert(productPixelCredential).values({
        expertId,
        provider: "meta",
        pixelId: change.pixelId,
        accessToken: change.accessToken,
      });
    }
  }
}

/** Pixels com token por dono (`""` = Automatize), para as listas do admin. */
export async function listConversionsApiPixelIdsByOwner() {
  const rows = await db
    .select({
      expertId: productPixelCredential.expertId,
      pixelId: productPixelCredential.pixelId,
    })
    .from(productPixelCredential)
    .where(eq(productPixelCredential.provider, "meta"));
  const byOwner = new Map<string, string[]>();
  for (const row of rows) {
    const owner = row.expertId ?? "";
    byOwner.set(owner, [...(byOwner.get(owner) ?? []), row.pixelId]);
  }
  return byOwner;
}
