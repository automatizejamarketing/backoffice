"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DemographicLimits } from "@/lib/meta-business/marketing/ai-creation/demographic-limits";

type Props = {
  value: DemographicLimits | undefined;
  onChange: (value: DemographicLimits | undefined) => void;
  disabled?: boolean;
};

function genderLabel(genders: number[] | null | undefined): string {
  if (genders == null) return "Herdado da campanha/base";
  if (genders.length === 2) return "Feminino e masculino (aplicado)";
  return genders[0] === 1
    ? "Feminino (aplicado)"
    : genders[0] === 2
      ? "Masculino (aplicado)"
      : "Sem gênero aplicado";
}

export function AiDemographicLimitsEditor({ value, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [ageEnabled, setAgeEnabled] = useState(value?.age != null);
  const [ageMin, setAgeMin] = useState(value?.age ? String(value.age.min) : "");
  const [ageMax, setAgeMax] = useState(value?.age ? String(value.age.max) : "");
  const [female, setFemale] = useState(value?.genders?.includes(1) ?? false);
  const [male, setMale] = useState(value?.genders?.includes(2) ?? false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAgeEnabled(value?.age != null);
    setAgeMin(value?.age ? String(value.age.min) : "");
    setAgeMax(value?.age ? String(value.age.max) : "");
    setFemale(value?.genders?.includes(1) ?? false);
    setMale(value?.genders?.includes(2) ?? false);
  }, [value]);

  function cancel() {
    setOpen(false);
    setError(null);
    setAgeEnabled(value?.age != null);
    setAgeMin(value?.age ? String(value.age.min) : "");
    setAgeMax(value?.age ? String(value.age.max) : "");
    setFemale(value?.genders?.includes(1) ?? false);
    setMale(value?.genders?.includes(2) ?? false);
  }

  function apply() {
    const next: DemographicLimits = { age: null, genders: null };
    if (ageEnabled) {
      const min = Number(ageMin);
      const max = Number(ageMax);
      if (!Number.isInteger(min) || !Number.isInteger(max) || min < 13 || max > 65 || min > max) {
        setError("Informe uma faixa inteira entre 13 e 65 anos, com o mínimo antes do máximo.");
        return;
      }
      next.age = { min, max };
    }
    const genders = [female ? 1 : null, male ? 2 : null].filter(
      (gender): gender is 1 | 2 => gender != null,
    );
    if (genders.length > 0) next.genders = genders;
    onChange(next);
    setError(null);
    setOpen(false);
  }

  function restore() {
    onChange({ age: null, genders: null });
    setAgeEnabled(false);
    setAgeMin("");
    setAgeMax("");
    setFemale(false);
    setMale(false);
    setError(null);
    setOpen(false);
  }

  const hasAppliedLimit = value?.age != null || value?.genders != null;
  return (
    <div className="space-y-3 rounded-md border border-dashed p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Label>Limites demográficos avançados</Label>
          <p className="mt-1 text-xs text-muted-foreground">Opcional. Sem aplicação, cada conjunto mantém sua base e a expansão permanece como foi derivada.</p>
        </div>
        {!open ? <Button disabled={disabled} onClick={() => setOpen(true)} type="button" variant="outline">{hasAppliedLimit ? "Editar limites" : "Configurar"}</Button> : null}
      </div>
      {!open ? (
        <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-3">
          <span>Idade: {value?.age ? `${value.age.min}–${value.age.max} (aplicada)` : "Herdada da campanha/base"}</span>
          <span>Gênero: {genderLabel(value?.genders)}</span>
          <span>Expansão: {hasAppliedLimit ? "desativada para respeitar o limite" : "mantida pela base"}</span>
        </div>
      ) : (
        <div className="space-y-3 rounded border bg-muted/20 p-3">
          <label className="flex items-center gap-2 text-sm"><input checked={ageEnabled} disabled={disabled} onChange={(event) => setAgeEnabled(event.target.checked)} type="checkbox" />Aplicar faixa etária</label>
          {ageEnabled ? <div className="grid grid-cols-2 gap-3"><label className="space-y-1 text-xs">Mínimo<Input disabled={disabled} inputMode="numeric" min={13} max={65} onChange={(event) => setAgeMin(event.target.value)} type="number" value={ageMin} /></label><label className="space-y-1 text-xs">Máximo<Input disabled={disabled} inputMode="numeric" min={13} max={65} onChange={(event) => setAgeMax(event.target.value)} type="number" value={ageMax} /></label></div> : null}
          <div className="space-y-2"><p className="text-xs font-medium">Gênero (opcional)</p><div className="flex flex-wrap gap-4 text-sm"><label className="flex items-center gap-2"><input checked={female} disabled={disabled} onChange={(event) => setFemale(event.target.checked)} type="checkbox" />Feminino</label><label className="flex items-center gap-2"><input checked={male} disabled={disabled} onChange={(event) => setMale(event.target.checked)} type="checkbox" />Masculino</label></div></div>
          {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
          <div className="flex flex-wrap gap-2"><Button disabled={disabled} onClick={apply} type="button">Aplicar</Button><Button disabled={disabled} onClick={restore} type="button" variant="outline">Restaurar base</Button><Button disabled={disabled} onClick={cancel} type="button" variant="ghost">Cancelar</Button></div>
          <p className="text-xs text-muted-foreground">Abrir e cancelar não alteram a campanha. Aplicar atualiza a prévia e exige uma nova revisão antes da publicação.</p>
        </div>
      )}
    </div>
  );
}
