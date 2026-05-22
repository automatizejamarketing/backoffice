"use client";

import { useState, type FormEvent } from "react";
import { History, Save, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { BusinessRulesSummary } from "@/components/business-rules-summary";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { BusinessOperatingRules } from "@/lib/business/business-health";

type RulesState = BusinessOperatingRules & {
  id: string;
  updatedByEmail: string | null;
  createdAt: string;
  updatedAt: string;
};

type LogItem = {
  id: string;
  adminEmail: string;
  fieldName: string;
  oldValue: string | null;
  newValue: string;
  createdAt: string;
};

const FIELD_LABELS: Record<string, string> = {
  renewalCriticalDays: "Renovação crítica",
  renewalAttentionDays: "Renovação em atenção",
  trialCriticalDays: "Trial crítico",
  trialAttentionDays: "Trial em atenção",
  inactivityAttentionDays: "Sem atividade geral",
  lowCreditsThreshold: "Créditos baixos",
  managedCampaignNamePrefix: "Prefixo campanha gerenciada",
  activeManagedCampaignExcludesInactivity: "Campanha ativa exclui sem uso",
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

export function BusinessRulesPageClient({
  initialRules,
  initialLogs,
}: {
  initialRules: RulesState;
  initialLogs: LogItem[];
}) {
  const [rules, setRules] = useState(initialRules);
  const [logs, setLogs] = useState(initialLogs);
  const [isSaving, setIsSaving] = useState(false);

  function setNumberField(
    field: keyof Omit<
      BusinessOperatingRules,
      "managedCampaignNamePrefix" | "activeManagedCampaignExcludesInactivity"
    >,
    value: string,
  ) {
    setRules((current) => ({
      ...current,
      [field]: Number(value),
    }));
  }

  async function saveRules(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    try {
      const response = await fetch("/api/backoffice/business-rules", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rules),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Erro ao salvar regras");
      }
      setRules({
        ...data.rules,
        createdAt: data.rules.createdAt,
        updatedAt: data.rules.updatedAt,
      });
      setLogs(data.logs);
      toast.success("Regras de business atualizadas");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Erro ao salvar regras",
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="min-w-0 space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
          <Settings2 className="size-6" />
          Regras de Business
        </h1>
        <p className="text-sm text-muted-foreground">
          Critérios usados pela carteira e pela aba Business para classificar
          clientes em crítico, atenção ou saudável.
        </p>
      </div>

      <BusinessRulesSummary rules={rules} />

      <form onSubmit={saveRules} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Limites operacionais</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <NumberField
              id="renewal-critical"
              label="Renovação crítica"
              suffix="dias"
              value={rules.renewalCriticalDays}
              onChange={(value) => setNumberField("renewalCriticalDays", value)}
            />
            <NumberField
              id="renewal-attention"
              label="Renovação em atenção"
              suffix="dias"
              value={rules.renewalAttentionDays}
              onChange={(value) => setNumberField("renewalAttentionDays", value)}
            />
            <NumberField
              id="trial-critical"
              label="Trial crítico"
              suffix="dias"
              value={rules.trialCriticalDays}
              onChange={(value) => setNumberField("trialCriticalDays", value)}
            />
            <NumberField
              id="trial-attention"
              label="Trial em atenção"
              suffix="dias"
              value={rules.trialAttentionDays}
              onChange={(value) => setNumberField("trialAttentionDays", value)}
            />
            <NumberField
              id="inactivity"
              label="Sem atividade geral"
              suffix="dias"
              value={rules.inactivityAttentionDays}
              onChange={(value) => setNumberField("inactivityAttentionDays", value)}
            />
            <NumberField
              id="credits"
              label="Créditos baixos"
              suffix="créditos"
              value={rules.lowCreditsThreshold}
              onChange={(value) => setNumberField("lowCreditsThreshold", value)}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Campanhas gerenciadas</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="space-y-1.5">
              <Label htmlFor="managed-prefix">Prefixo da campanha</Label>
              <Input
                id="managed-prefix"
                value={rules.managedCampaignNamePrefix}
                onChange={(event) =>
                  setRules((current) => ({
                    ...current,
                    managedCampaignNamePrefix: event.target.value,
                  }))
                }
              />
              <p className="text-xs text-muted-foreground">
                Campanhas ativas na Meta que começam com este prefixo são
                consideradas campanhas nossas.
              </p>
            </div>

            <div className="flex items-center justify-between gap-4 rounded-lg border bg-muted/30 p-4">
              <div>
                <Label>Excluir alerta de “sem uso”</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  Quando ativo, campanha Meta gerenciada remove apenas o alerta
                  de inatividade.
                </p>
              </div>
              <Switch
                checked={rules.activeManagedCampaignExcludesInactivity}
                onCheckedChange={(checked) =>
                  setRules((current) => ({
                    ...current,
                    activeManagedCampaignExcludesInactivity: checked,
                  }))
                }
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">
            Última alteração: {formatDate(rules.updatedAt)}
            {rules.updatedByEmail ? ` por ${rules.updatedByEmail}` : ""}
          </p>
          <Button type="submit" disabled={isSaving}>
            <Save className="size-4" />
            Salvar regras
          </Button>
        </div>
      </form>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="size-5" />
            Histórico de mudanças
          </CardTitle>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma mudança registrada ainda.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-muted-foreground">
                      Data
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-muted-foreground">
                      Admin
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-muted-foreground">
                      Regra
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-muted-foreground">
                      Antes → Depois
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {logs.map((log) => (
                    <tr key={log.id}>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                        {formatDate(log.createdAt)}
                      </td>
                      <td className="px-3 py-2 text-sm text-foreground">
                        {log.adminEmail}
                      </td>
                      <td className="px-3 py-2 text-sm text-foreground">
                        {FIELD_LABELS[log.fieldName] ?? log.fieldName}
                      </td>
                      <td className="px-3 py-2 text-sm">
                        <span className="text-muted-foreground">
                          {log.oldValue ?? "—"}
                        </span>
                        {" → "}
                        <span className="font-medium text-foreground">
                          {log.newValue}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function NumberField({
  id,
  label,
  suffix,
  value,
  onChange,
}: {
  id: string;
  label: string;
  suffix: string;
  value: number;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="number"
          min={0}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <span className="w-16 text-sm text-muted-foreground">{suffix}</span>
      </div>
    </div>
  );
}
