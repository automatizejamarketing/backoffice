/**
 * deleteMetaObject — best-effort DELETE of a Meta ad object (campaign / ad set /
 * ad / creative) by id. Used for rollback of partial creation and for the AI
 * assistant's cleanup of abandoned/orphan objects (ADR 0009).
 *
 * Returns `true` on success, `false` if Meta refused (so the caller can report
 * the surviving id as an orphan rather than throwing).
 */

import { metaApiCall } from "@/lib/meta-business/api";

export async function deleteMetaObject(
  id: string,
  accessToken: string,
): Promise<boolean> {
  try {
    await metaApiCall<{ success?: boolean }>({
      method: "DELETE",
      path: id,
      params: "",
      accessToken,
    });
    return true;
  } catch {
    return false;
  }
}

/** Delete ids in the given order, returning the ids Meta refused to delete. */
export async function deleteMetaObjects(
  ids: string[],
  accessToken: string,
): Promise<string[]> {
  const orphans: string[] = [];
  for (const id of ids) {
    const okDeleted = await deleteMetaObject(id, accessToken);
    if (!okDeleted) orphans.push(id);
  }
  return orphans;
}
