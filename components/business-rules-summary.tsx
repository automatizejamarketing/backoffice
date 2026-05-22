import { ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { BusinessOperatingRules } from "@/lib/business/business-health";

export function BusinessRulesSummary({
  rules,
  compact = false,
}: {
  rules: BusinessOperatingRules;
  compact?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-muted/30 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">
              Regras de Business em uso
            </h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            O score usa atividade interna e ignora “sem uso” quando há campanha
            Meta ativa com prefixo gerenciado.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <RuleBadge label="Renovação crítica" value={`${rules.renewalCriticalDays}d`} />
          <RuleBadge label="Renovação atenção" value={`${rules.renewalAttentionDays}d`} />
          {!compact && (
            <>
              <RuleBadge label="Trial crítico" value={`${rules.trialCriticalDays}d`} />
              <RuleBadge label="Trial atenção" value={`${rules.trialAttentionDays}d`} />
            </>
          )}
          <RuleBadge label="Sem uso" value={`${rules.inactivityAttentionDays}d`} />
          <RuleBadge label="Créditos baixos" value={`<= ${rules.lowCreditsThreshold}`} />
          <RuleBadge label="Campanha gerenciada" value={rules.managedCampaignNamePrefix} />
        </div>
      </div>
    </div>
  );
}

function RuleBadge({ label, value }: { label: string; value: string }) {
  return (
    <Badge variant="secondary" className="gap-1 rounded-md">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </Badge>
  );
}
