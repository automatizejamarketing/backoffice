"use client";

import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  CRM_ACCOUNT_STAGE_META,
  CRM_STATUS_META,
  type CrmAccountStage,
  type CrmCommercialStatus,
} from "@/lib/backoffice/crm";

export function CommercialStatusBadge({ status }: { status: CrmCommercialStatus }) {
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
        <Badge key={title} variant="secondary" className="max-w-40 truncate" title={title}>
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
