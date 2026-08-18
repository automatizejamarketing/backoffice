import { del } from "@vercel/blob";
import { and, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db/index";
import { blobUpload } from "@/lib/db/schema";
import { graphFacebookBaseUrl, graphApiVersion } from "../constant";

const INITIAL_DELAY_MS = 5_000;
const MAX_DELAY_MS = 60_000;
const MAX_TOTAL_MS = 5 * 60_000;

type CreativeStatus = "IN_PROCESS" | "ACTIVE" | "WITH_ISSUES" | string;

async function getCreativeStatus(
  creativeId: string,
  accessToken: string,
): Promise<CreativeStatus> {
  const url = `${graphFacebookBaseUrl}/${graphApiVersion}/${creativeId}?fields=status&access_token=${accessToken}`;
  const res = await fetch(url);
  if (!res.ok) return "IN_PROCESS";
  const data = await res.json();
  return data.status ?? "IN_PROCESS";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Polls Meta ad creative statuses with exponential backoff. Once all
 * creatives are ACTIVE, deletes the corresponding Vercel Blob files and soft
 * deletes their `blob_uploads` rows. Fire-and-forget; never throws.
 */
export async function cleanupBlobAfterMetaIngestion(params: {
  blobUrls: string[];
  adCreativeIds: string[];
  accessToken: string;
}): Promise<void> {
  const { blobUrls, adCreativeIds, accessToken } = params;

  if (blobUrls.length === 0) return;

  const pending = new Set(adCreativeIds);
  let delay = INITIAL_DELAY_MS;
  let elapsed = 0;

  try {
    while (pending.size > 0 && elapsed < MAX_TOTAL_MS) {
      await sleep(delay);
      elapsed += delay;

      for (const id of [...pending]) {
        const status = await getCreativeStatus(id, accessToken);

        if (status === "ACTIVE") {
          pending.delete(id);
        } else if (status === "WITH_ISSUES") {
          console.warn(
            `[cleanupBlob] Creative ${id} has WITH_ISSUES - skipping blob deletion`,
          );
          return;
        }
      }

      delay = Math.min(delay * 2, MAX_DELAY_MS);
    }

    if (pending.size > 0) {
      console.warn(
        `[cleanupBlob] Timed out after ${elapsed}ms - ${pending.size} creatives still IN_PROCESS, skipping deletion`,
      );
      return;
    }

    await del(blobUrls);
    const now = new Date();

    await db
      .update(blobUpload)
      .set({
        deletedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          inArray(blobUpload.blobUrl, blobUrls),
          isNull(blobUpload.deletedAt),
        ),
      );

    console.log(
      `[cleanupBlob] Deleted ${blobUrls.length} blob(s) after Meta ingestion`,
    );
  } catch (error) {
    console.error("[cleanupBlob] Unexpected error during cleanup:", error);
  }
}
