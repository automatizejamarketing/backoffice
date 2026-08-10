"use client";

import { useState } from "react";
import { Bell, Lock, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  REMARKETING_WHATSAPP_NUDGES,
  type RemarketingNudgeDefinition,
} from "@/lib/proactivity/remarketing-nudge-catalog";

export type ProactivityAlertClient = {
  id: string;
  ruleKey: string;
  audience: "client" | "consultant";
  enabled: boolean;
  thresholds: Record<string, number>;
  deliverWhatsapp: boolean;
  deliverSlack: boolean;
  updatedByEmail: string | null;
  createdAt: string;
  updatedAt: string;
  definition: {
    title: string;
    description: string;
    thresholdFields: Array<{
      key: string;
      label: string;
      suffix?: string;
      min?: number;
      step?: number;
    }>;
    defaultThresholds: Record<string, number>;
  };
};

export type ProactivityAlertLogClient = {
  id: string;
  alertId: string;
  adminEmail: string;
  fieldName: string;
  oldValue: string | null;
  newValue: string;
  createdAt: string;
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

export function ProactivityAlertsSection({
  initialAlerts,
  initialLogs,
  onLogsChange,
}: {
  initialAlerts: ProactivityAlertClient[];
  initialLogs: ProactivityAlertLogClient[];
  onLogsChange?: (logs: ProactivityAlertLogClient[]) => void;
}) {
  const [alerts, setAlerts] = useState(initialAlerts);
  const [logs, setLogs] = useState(initialLogs);
  const [isSaving, setIsSaving] = useState(false);

  const clientAlerts = alerts.filter((a) => a.audience === "client");
  const consultantAlerts = alerts.filter((a) => a.audience === "consultant");

  function updateAlert(
    id: string,
    updater: (current: ProactivityAlertClient) => ProactivityAlertClient,
  ) {
    setAlerts((current) =>
      current.map((alert) => (alert.id === id ? updater(alert) : alert)),
    );
  }

  async function saveAlerts() {
    setIsSaving(true);
    try {
      const response = await fetch("/api/backoffice/proactivity-alerts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          alerts: alerts.map((alert) => ({
            id: alert.id,
            enabled: alert.enabled,
            thresholds: alert.thresholds,
            deliverWhatsapp: alert.deliverWhatsapp,
            deliverSlack: alert.deliverSlack,
          })),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Erro ao salvar alertas");
      }
      setAlerts(data.alerts);
      setLogs(data.logs);
      onLogsChange?.(data.logs);
      toast.success("Alertas de proatividade atualizados");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Erro ao salvar alertas",
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold text-foreground">
            <Bell className="size-5" />
            Alertas de proatividade
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Regras estáticas com valores e canais configuráveis. In-app fica
            ativo quando o alerta está ligado; WhatsApp (cliente) e Slack
            (consultor) são extras.
          </p>
        </div>
        <Button type="button" onClick={saveAlerts} disabled={isSaving}>
          <Save className="size-4" />
          Salvar alertas
        </Button>
      </div>

      <AudienceGroup
        title="Cliente"
        description="Sugestões no app Automatize (e WhatsApp opcional)."
        alerts={clientAlerts}
        onUpdate={updateAlert}
      />

      <AudienceGroup
        title="Consultor"
        description="Sugestões do playbook no backoffice (e Slack opcional)."
        alerts={consultantAlerts}
        onUpdate={updateAlert}
      />

      <RemarketingNudgesReadonlySection />

      {logs.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Histórico de alertas de proatividade
            </CardTitle>
          </CardHeader>
          <CardContent>
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
                      Campo
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-muted-foreground">
                      Antes → Depois
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {logs.slice(0, 15).map((log) => (
                    <tr key={log.id}>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                        {formatDate(log.createdAt)}
                      </td>
                      <td className="px-3 py-2 text-sm">{log.adminEmail}</td>
                      <td className="px-3 py-2 text-sm">{log.fieldName}</td>
                      <td className="max-w-md truncate px-3 py-2 text-sm">
                        <span className="text-muted-foreground">
                          {log.oldValue ?? "—"}
                        </span>
                        {" → "}
                        <span className="font-medium">{log.newValue}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function RemarketingNudgesReadonlySection() {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <Lock className="size-3.5" />
          Remarketing WhatsApp (somente leitura)
        </h3>
        <p className="text-xs text-muted-foreground">
          Sequência de ativação do app Automatize (hardcoded no frontend).
          Valores e canais ainda não são editáveis neste painel — histórico em{" "}
          <a href="/whatsapp" className="underline underline-offset-2">
            WhatsApp
          </a>
          .
        </p>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {REMARKETING_WHATSAPP_NUDGES.map((nudge) => (
          <RemarketingNudgeCard key={nudge.ruleKey} nudge={nudge} />
        ))}
      </div>
    </div>
  );
}

function RemarketingNudgeCard({
  nudge,
}: {
  nudge: RemarketingNudgeDefinition;
}) {
  return (
    <Card className="border-dashed bg-muted/10">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-3">
        <div className="min-w-0 space-y-1">
          <CardTitle className="text-base leading-snug">{nudge.title}</CardTitle>
          <p className="text-xs text-muted-foreground">{nudge.description}</p>
          <p className="font-mono text-[11px] text-muted-foreground">
            {nudge.templateName}
          </p>
        </div>
        <span className="shrink-0 rounded-md border bg-background px-2 py-1 text-[11px] font-medium text-muted-foreground">
          Somente leitura
        </span>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <dl className="grid gap-2 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">Delay (produção)</dt>
            <dd className="font-medium text-foreground">
              {nudge.delayProduction}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Delay (staging)</dt>
            <dd className="font-medium text-foreground">{nudge.delayStaging}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted-foreground">Gatilho</dt>
            <dd className="font-medium text-foreground">{nudge.trigger}</dd>
          </div>
        </dl>
        <div className="rounded-lg border bg-background/60 p-3">
          <p className="text-xs font-medium text-foreground">Preview do texto</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {nudge.bodyPreview}
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground">
            CTA: {nudge.ctaLabel} → {nudge.ctaUrl}
          </p>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/20 p-3">
          <div>
            <p className="text-xs font-medium">Canal</p>
            <p className="text-[11px] text-muted-foreground">
              WhatsApp (cliente) · sempre ativo na sequência de ativação
            </p>
          </div>
          <Switch checked disabled aria-label="WhatsApp (somente leitura)" />
        </div>
      </CardContent>
    </Card>
  );
}

function AudienceGroup({
  title,
  description,
  alerts,
  onUpdate,
}: {
  title: string;
  description: string;
  alerts: ProactivityAlertClient[];
  onUpdate: (
    id: string,
    updater: (current: ProactivityAlertClient) => ProactivityAlertClient,
  ) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {alerts.map((alert) => (
          <AlertCard key={alert.id} alert={alert} onUpdate={onUpdate} />
        ))}
      </div>
    </div>
  );
}

function AlertCard({
  alert,
  onUpdate,
}: {
  alert: ProactivityAlertClient;
  onUpdate: (
    id: string,
    updater: (current: ProactivityAlertClient) => ProactivityAlertClient,
  ) => void;
}) {
  return (
    <Card className={!alert.enabled ? "opacity-70" : undefined}>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-3">
        <div className="min-w-0 space-y-1">
          <CardTitle className="text-base leading-snug">
            {alert.definition.title}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {alert.definition.description}
          </p>
          <p className="font-mono text-[11px] text-muted-foreground">
            {alert.ruleKey}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Label htmlFor={`enabled-${alert.id}`} className="text-xs">
            Ativo
          </Label>
          <Switch
            id={`enabled-${alert.id}`}
            checked={alert.enabled}
            onCheckedChange={(checked) =>
              onUpdate(alert.id, (current) => ({
                ...current,
                enabled: checked,
              }))
            }
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {alert.definition.thresholdFields.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {alert.definition.thresholdFields.map((field) => (
              <div key={field.key} className="space-y-1.5">
                <Label htmlFor={`${alert.id}-${field.key}`}>{field.label}</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id={`${alert.id}-${field.key}`}
                    type="number"
                    min={field.min ?? 0}
                    step={field.step ?? 1}
                    value={
                      alert.thresholds[field.key] ??
                      alert.definition.defaultThresholds[field.key] ??
                      0
                    }
                    disabled={!alert.enabled}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      onUpdate(alert.id, (current) => ({
                        ...current,
                        thresholds: {
                          ...current.thresholds,
                          [field.key]: value,
                        },
                      }));
                    }}
                  />
                  {field.suffix ? (
                    <span className="w-10 shrink-0 text-xs text-muted-foreground">
                      {field.suffix}
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Sem limiares numéricos — apenas liga/desliga e canais.
          </p>
        )}

        <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
          <p className="text-xs font-medium text-foreground">
            Entrega (além do in-app)
          </p>
          {alert.audience === "client" ? (
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label htmlFor={`wa-${alert.id}`}>WhatsApp</Label>
                <p className="text-[11px] text-muted-foreground">
                  Envia ao cliente quando o sinal abre.
                </p>
              </div>
              <Switch
                id={`wa-${alert.id}`}
                checked={alert.deliverWhatsapp}
                disabled={!alert.enabled}
                onCheckedChange={(checked) =>
                  onUpdate(alert.id, (current) => ({
                    ...current,
                    deliverWhatsapp: checked,
                  }))
                }
              />
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label htmlFor={`slack-${alert.id}`}>Slack</Label>
                <p className="text-[11px] text-muted-foreground">
                  Posta no canal do time quando o insight abre.
                </p>
              </div>
              <Switch
                id={`slack-${alert.id}`}
                checked={alert.deliverSlack}
                disabled={!alert.enabled}
                onCheckedChange={(checked) =>
                  onUpdate(alert.id, (current) => ({
                    ...current,
                    deliverSlack: checked,
                  }))
                }
              />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
