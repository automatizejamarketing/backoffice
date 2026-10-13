import { isBypassStripeEmail } from "@/lib/access/billing-bypass";
import {
  countMediaLibraryRecords,
  findMediaLibraryOwner,
  findMediaLibraryRecord,
  findMediaLibraryRecordByUrl,
  insertMediaLibraryRecord,
  listMediaLibraryRecords,
  markMediaLibraryRecordDeleted,
} from "@/lib/media-library/repository";
import type { MediaLibraryDeps } from "@/lib/media-library/service";
import { mediaLibraryStorage } from "@/lib/media-library/storage";

/** Mesma regra do app: o cliente com bypass de cobrança tem a biblioteca sempre Ativa. */
export function createBackofficeMediaLibraryDeps(): MediaLibraryDeps {
  return {
    now: () => new Date(),
    hasBillingBypass: (owner) => process.env.BYPASS_STRIPE === "true" || isBypassStripeEmail(owner.email),
    findOwner: findMediaLibraryOwner,
    listRecords: listMediaLibraryRecords,
    countRecords: countMediaLibraryRecords,
    findRecord: findMediaLibraryRecord,
    findRecordByUrl: findMediaLibraryRecordByUrl,
    insertRecord: insertMediaLibraryRecord,
    markDeleted: markMediaLibraryRecordDeleted,
    storage: mediaLibraryStorage,
  };
}
