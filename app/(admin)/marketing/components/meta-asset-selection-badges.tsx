import { Badge } from "@/components/ui/badge";

export function MetaAssetSelectionBadges({
  enabled,
  primary,
}: {
  enabled?: boolean;
  primary?: boolean;
}) {
  if (!enabled && !primary) return null;

  return (
    <span className="flex shrink-0 flex-wrap gap-1">
      {enabled ? <Badge variant="secondary">habilitada</Badge> : null}
      {primary ? <Badge>principal</Badge> : null}
    </span>
  );
}
