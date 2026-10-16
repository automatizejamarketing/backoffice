"use client";

import { CrmTagBadge, useCrmTags } from "./crm-tag-settings";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  CRM_ACCOUNT_STAGE_META,
  CRM_STATUS_META,
  type CrmAccountStage,
  type CrmCommercialStatus,
} from "@/lib/backoffice/crm";

export function CommercialStatusBadge({
  status,
}: {
  status: CrmCommercialStatus;
}) {
  const meta = CRM_STATUS_META[status];
  return (
    <StatusBadge tone={meta.tone} icon={meta.icon}>
      {meta.label}
    </StatusBadge>
  );
}

export function AccountStageBadge({ stage }: { stage: CrmAccountStage }) {
  const meta = CRM_ACCOUNT_STAGE_META[stage];
  return <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>;
}

export function ProductTags({
  titles,
  max = 2,
}: {
  titles: string[];
  max?: number;
}) {
  if (titles.length === 0) return null;
  const visible = titles.slice(0, max);
  const rest = titles.length - visible.length;
  return (
    <div className="flex flex-wrap gap-1">
      {visible.map((title) => (
        <Badge
          key={title}
          variant="secondary"
          className="max-w-40 truncate"
          title={title}
        >
          {title}
        </Badge>
      ))}
      {rest > 0 ? (
        <Badge variant="outline" title={titles.slice(max).join(", ")}>
          +{rest}
        </Badge>
      ) : null}
    </div>
  );
}

export function CaptureTags({
  lead,
}: {
  lead: { captureSource?: string | null; captureProfile?: string | null };
}) {
  const { tags } = useCrmTags();
  const visible = tags.filter(
    (tag) =>
      tag.key === `source:${lead.captureSource}` ||
      tag.key === `profile:${lead.captureProfile}`,
  );
  if (!visible.length) return null;
  return (
    <span className="inline-flex min-w-0 flex-wrap gap-1">
      {visible.map((tag) => (
        <CrmTagBadge key={tag.key} tag={tag} />
      ))}
    </span>
  );
}
