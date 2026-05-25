"use client";

import { useState } from "react";
import { Gauge, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  PERFORMANCE_OPERATORS,
  SUPPORTED_METRICS,
} from "@/lib/marketing/performance-rules";

const ENDPOINT = "/api/backoffice/marketing-performance-rules";

const SELECT_CLASS =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring";

type RuleState = {
  id: string;
  name: string;
  enabled: boolean;
  metric: string;
  operator: string;
  threshold: number;
  description: string | null;
  updatedByEmail: string | null;
  createdAt: string;
  updatedAt: string;
};

type NewRuleState = {
  name: string;
  metric: string;
  operator: string;
  threshold: string;
  enabled: boolean;
  description: string;
};

const DEFAULT_NEW_RULE: NewRuleState = {
  name: "",
  metric: "roas",
  operator: "gt",
  threshold: "2",
  enabled: true,
  description: "",
};

function MetricSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <select
      className={SELECT_CLASS}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {Object.entries(SUPPORTED_METRICS).map(([key, label]) => (
        <option key={key} value={key}>
          {label}
        </option>
      ))}
    </select>
  );
}

function OperatorSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <select
      className={SELECT_CLASS}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {Object.entries(PERFORMANCE_OPERATORS).map(([key, label]) => (
        <option key={key} value={key}>
          {label}
        </option>
      ))}
    </select>
  );
}

export function MarketingPerformanceRulesPageClient({
  initialRules,
}: {
  initialRules: RuleState[];
}) {
  const [rules, setRules] = useState(initialRules);
  const [newRule, setNewRule] = useState<NewRuleState>(DEFAULT_NEW_RULE);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  function patchLocal(id: string, patch: Partial<RuleState>) {
    setRules((current) =>
      current.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)),
    );
  }

  async function saveRule(rule: RuleState) {
    setSavingId(rule.id);
    try {
      const response = await fetch(ENDPOINT, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: rule.id,
          name: rule.name,
          metric: rule.metric,
          operator: rule.operator,
          threshold: rule.threshold,
          enabled: rule.enabled,
          description: rule.description,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Erro ao salvar regra");
      setRules(data.rules);
      toast.success("Regra atualizada");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Erro ao salvar regra",
      );
    } finally {
      setSavingId(null);
    }
  }

  async function removeRule(id: string) {
    setSavingId(id);
    try {
      const response = await fetch(`${ENDPOINT}?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Erro ao excluir regra");
      setRules(data.rules);
      toast.success("Regra removida");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Erro ao excluir regra",
      );
    } finally {
      setSavingId(null);
    }
  }

  async function createRule() {
    setIsCreating(true);
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newRule.name,
          metric: newRule.metric,
          operator: newRule.operator,
          threshold: Number(newRule.threshold),
          enabled: newRule.enabled,
          description: newRule.description,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Erro ao criar regra");
      setRules(data.rules);
      setNewRule(DEFAULT_NEW_RULE);
      toast.success("Regra criada");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Erro ao criar regra",
      );
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <div className="min-w-0 space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
          <Gauge className="size-6" />
          Regras de performance (banner de marketing)
        </h1>
        <p className="text-sm text-muted-foreground">
          Critérios que definem quando uma campanha [AM] está “performando bem”.
          As regras ativas são combinadas com E (todas precisam passar). O banner
          mostra o faturamento somado das campanhas que passam.
        </p>
      </div>

      <div className="space-y-4">
        {rules.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-sm text-muted-foreground">
              Nenhuma regra cadastrada. Sem regras ativas, o banner não é
              exibido para ninguém.
            </CardContent>
          </Card>
        ) : (
          rules.map((rule) => (
            <Card key={rule.id}>
              <CardContent className="space-y-4 pt-6">
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <div className="space-y-1.5">
                    <Label>Nome</Label>
                    <Input
                      value={rule.name}
                      onChange={(event) =>
                        patchLocal(rule.id, { name: event.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Métrica</Label>
                    <MetricSelect
                      value={rule.metric}
                      onChange={(value) => patchLocal(rule.id, { metric: value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Operador</Label>
                    <OperatorSelect
                      value={rule.operator}
                      onChange={(value) =>
                        patchLocal(rule.id, { operator: value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Limite</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={rule.threshold}
                      onChange={(event) =>
                        patchLocal(rule.id, {
                          threshold: Number(event.target.value),
                        })
                      }
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>Descrição (opcional)</Label>
                  <Input
                    value={rule.description ?? ""}
                    onChange={(event) =>
                      patchLocal(rule.id, { description: event.target.value })
                    }
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={rule.enabled}
                      onCheckedChange={(checked) =>
                        patchLocal(rule.id, { enabled: checked })
                      }
                    />
                    <Label>Ativa</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => removeRule(rule.id)}
                      disabled={savingId === rule.id}
                    >
                      <Trash2 className="size-4" />
                      Excluir
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => saveRule(rule)}
                      disabled={savingId === rule.id}
                    >
                      <Save className="size-4" />
                      Salvar
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Plus className="size-5" />
            Adicionar regra
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="new-name">Nome</Label>
              <Input
                id="new-name"
                placeholder="ex.: ROAS mínimo"
                value={newRule.name}
                onChange={(event) =>
                  setNewRule((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Métrica</Label>
              <MetricSelect
                value={newRule.metric}
                onChange={(value) =>
                  setNewRule((current) => ({ ...current, metric: value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Operador</Label>
              <OperatorSelect
                value={newRule.operator}
                onChange={(value) =>
                  setNewRule((current) => ({ ...current, operator: value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-threshold">Limite</Label>
              <Input
                id="new-threshold"
                type="number"
                step="0.01"
                value={newRule.threshold}
                onChange={(event) =>
                  setNewRule((current) => ({
                    ...current,
                    threshold: event.target.value,
                  }))
                }
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new-description">Descrição (opcional)</Label>
            <Input
              id="new-description"
              value={newRule.description}
              onChange={(event) =>
                setNewRule((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Switch
                checked={newRule.enabled}
                onCheckedChange={(checked) =>
                  setNewRule((current) => ({ ...current, enabled: checked }))
                }
              />
              <Label>Ativa</Label>
            </div>
            <Button onClick={createRule} disabled={isCreating || !newRule.name}>
              <Plus className="size-4" />
              Adicionar
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
