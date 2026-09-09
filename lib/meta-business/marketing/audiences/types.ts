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

export type AudienceCapability = "available" | "unknown";

export type AudienceCapabilities = {
  read: AudienceCapability;
  include: AudienceCapability;
  exclude: AudienceCapability;
  editMetadata: AudienceCapability;
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
  /** A rule is shown as external until a later editor can represent it losslessly. */
  ruleSummary: "external" | "not_applicable" | "not_loaded";
  capabilities: AudienceCapabilities;
};
