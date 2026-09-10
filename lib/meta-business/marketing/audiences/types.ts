/**
 * View-model types for the audience library UI.
 *
 * This file must stay free of Meta client, hashing, database and observability
 * imports. Client components may import types (and only types) from here.
 * Importing `@/lib/meta-business/marketing/audiences` or `./read` from a
 * `"use client"` module pulls `node:async_hooks` into the browser bundle and
 * fails `next build`.
 */

export type AudienceStatus = { code?: number; description?: string };

export type AudienceCapability = "available" | "unavailable" | "unknown";

export type AudienceAvailability = "available" | "blocked" | "unknown";

export type AudienceMetaProcessingState = "ready" | "processing" | "unknown";

export type AudienceImportResult =
  | { known: false; state: "not_recorded" }
  | {
      known: true;
      state: string;
      operation: string;
      pendingUnresolved: boolean;
      receivedAt: string;
      updatedAt: string;
      confirmedBatches: number;
      confirmedRecords: number;
      rejectedRecords: number;
    };

export type AudienceFunctionAvailability = {
  include: AudienceAvailability;
  exclude: AudienceAvailability;
  lookalikeSource: AudienceAvailability;
  /** A projection of operation_status; the original Meta status remains above. */
  metaProcessing: AudienceMetaProcessingState;
};

export type AudienceCapabilities = {
  read: AudienceCapability;
  include: AudienceCapability;
  exclude: AudienceCapability;
  editMetadata: AudienceCapability;
  share: AudienceCapability;
  editRule: AudienceCapability;
  manageMembers: AudienceCapability;
  delete: AudienceCapability;
  lookalikeSource: AudienceCapability;
};

export type CustomAudienceView = {
  id: string;
  name?: string;
  description?: string;
  subtype?: string;
  approximateCountLowerBound?: number;
  approximateCountUpperBound?: number;
  operationStatus?: AudienceStatus;
  deliveryStatus?: AudienceStatus;
  retentionDays?: number;
  customerFileSource?: string;
  isValueBased?: boolean;
  timeCreated?: number;
  timeUpdated?: number;
  rule?: unknown;
  lookalikeSpec?: unknown;
  lookalikeAudienceIds?: string[];
  originAudienceId?: string;
  /** Local import state, or `not_recorded` for a Meta audience with no local history. */
  importState?: string;
  importResult?: AudienceImportResult;
  availability?: AudienceFunctionAvailability;
  /** A rule is shown as external until a later editor can represent it losslessly. */
  ruleSummary: "external" | "not_applicable" | "not_loaded";
  capabilities: AudienceCapabilities;
};
