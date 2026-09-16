"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUpdateMetaAssetLimits } from "../hooks/use-meta-assets";

type MetaAssetsLimitsFormProps = {
  userId: string;
  canEdit: boolean;
  adAccounts: number;
  identities: number;
};

export function MetaAssetsLimitsForm({
  userId,
  canEdit,
  adAccounts,
  identities,
}: MetaAssetsLimitsFormProps) {
  const updateLimits = useUpdateMetaAssetLimits(userId);
  const [adAccountLimit, setAdAccountLimit] = useState(String(adAccounts));
  const [identityLimit, setIdentityLimit] = useState(String(identities));

  if (!canEdit) {
    return (
      <p className="text-sm text-foreground">
        Limites: {adAccounts} contas de anúncios · {identities} Identidades
      </p>
    );
  }

  const handleSave = async () => {
    try {
      await updateLimits.mutateAsync({
        adAccountLimit: Number.parseInt(adAccountLimit, 10),
        identityLimit: Number.parseInt(identityLimit, 10),
      });
      toast.success("Limites salvos");
    } catch (error) {
      toast.error(
        error instanceof Error && error.message === "invalid_limits"
          ? "Cada limite precisa ser um inteiro de 1 a 50"
          : "Não foi possível salvar os limites",
      );
    }
  };

  return (
    <form
      className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
      onSubmit={(event) => {
        event.preventDefault();
        void handleSave();
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="meta-ad-account-limit">Limite de contas de anúncios</Label>
        <Input
          id="meta-ad-account-limit"
          type="number"
          min={1}
          max={50}
          value={adAccountLimit}
          onChange={(event) => setAdAccountLimit(event.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="meta-identity-limit">Limite de Identidades</Label>
        <Input
          id="meta-identity-limit"
          type="number"
          min={1}
          max={50}
          value={identityLimit}
          onChange={(event) => setIdentityLimit(event.target.value)}
        />
      </div>
      <Button type="submit" disabled={updateLimits.isPending}>
        {updateLimits.isPending ? "Salvando..." : "Salvar limites"}
      </Button>
    </form>
  );
}
