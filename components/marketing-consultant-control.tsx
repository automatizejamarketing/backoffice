"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Consultant = {
  id: string;
  email: string;
  name: string | null;
};

type MarketingConsultantControlProps = {
  userId: string;
  consultants: Consultant[];
  assignedConsultantId: string | null;
};

export function MarketingConsultantControl({
  userId,
  consultants,
  assignedConsultantId,
}: MarketingConsultantControlProps) {
  const [value, setValue] = useState(assignedConsultantId ?? "none");
  const [isSaving, setIsSaving] = useState(false);

  async function updateConsultant(nextValue: string) {
    const previousValue = value;
    setValue(nextValue);
    setIsSaving(true);
    try {
      const response = await fetch(`/api/users/${userId}/marketing-consultant`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consultantId: nextValue }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Erro ao atualizar consultor");
      }
      setValue(data.assignment?.consultantId ?? "none");
      toast.success("Consultor de conta atualizado");
    } catch (error) {
      setValue(previousValue);
      toast.error(
        error instanceof Error ? error.message : "Erro ao atualizar consultor",
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          Consultor de conta
          {isSaving && <Loader2 className="size-3.5 animate-spin" />}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Select value={value} onValueChange={updateConsultant} disabled={isSaving}>
          <SelectTrigger>
            <SelectValue placeholder="Selecionar consultor" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Sem consultor</SelectItem>
            {consultants.map((consultant) => (
              <SelectItem key={consultant.id} value={consultant.id}>
                {consultant.name
                  ? `${consultant.name} (${consultant.email})`
                  : consultant.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {consultants.length === 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Cadastre consultores na página Equipe para atribuir esta conta.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
