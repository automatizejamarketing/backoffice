"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import { ImageIcon, Info, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AudienceMultiSelect,
  type AudienceOption,
} from "./audience-multi-select";
import {
  InstagramPostPicker,
  type InstagramMediaItem,
} from "./instagram-post-picker";

const MAX_MEDIA_ITEMS = 5;

const SALES_OBJECTIVES = ["OUTCOME_SALES", "CONVERSIONS"];
const LEADS_OBJECTIVES = ["OUTCOME_LEADS", "LEAD_GENERATION"];
const TRAFFIC_OBJECTIVES = ["OUTCOME_TRAFFIC", "LINK_CLICKS"];

type AdSetCreateDialogProps = {
  campaignId: string;
  campaignName?: string;
  campaignObjective?: string;
  accountId: string;
  userId: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

export function AdSetCreateDialog({
  campaignId,
  campaignName,
  campaignObjective,
  accountId,
  userId,
  isOpen,
  onClose,
  onSuccess,
}: AdSetCreateDialogProps) {
  const [adsetName, setAdsetName] = useState("");
  const [dailyBudget, setDailyBudget] = useState("");
  const [ageMin, setAgeMin] = useState("18");
  const [ageMax, setAgeMax] = useState("65");
  const [gender, setGender] = useState<"all" | "male" | "female">("all");
  const [includedAudiences, setIncludedAudiences] = useState<AudienceOption[]>(
    [],
  );
  const [excludedAudiences, setExcludedAudiences] = useState<AudienceOption[]>(
    [],
  );
  const [availableAudiences, setAvailableAudiences] = useState<
    AudienceOption[]
  >([]);
  const [isLoadingAudiences, setIsLoadingAudiences] = useState(false);
  const [selectedPosts, setSelectedPosts] = useState<InstagramMediaItem[]>([]);
  const [isMediaPickerOpen, setIsMediaPickerOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");

  const isSalesCampaign = SALES_OBJECTIVES.includes(campaignObjective ?? "");
  const isLeadsCampaign = LEADS_OBJECTIVES.includes(campaignObjective ?? "");
  const isTrafficCampaign = TRAFFIC_OBJECTIVES.includes(
    campaignObjective ?? "",
  );

  const hasPosts = selectedPosts.length > 0;

  const fetchAudiences = useCallback(async () => {
    setIsLoadingAudiences(true);
    try {
      const response = await fetch(
        `/api/meta-marketing/${accountId}/audiences?userId=${userId}`,
      );
      if (response.ok) {
        const data = await response.json();
        setAvailableAudiences(data.audiences ?? []);
      }
    } catch {
      // Silently fail – audiences list is optional
    } finally {
      setIsLoadingAudiences(false);
    }
  }, [accountId, userId]);

  useEffect(() => {
    if (isOpen) {
      fetchAudiences();
    }
  }, [isOpen, fetchAudiences]);

  const resetForm = () => {
    setAdsetName("");
    setDailyBudget("");
    setAgeMin("18");
    setAgeMax("65");
    setGender("all");
    setIncludedAudiences([]);
    setExcludedAudiences([]);
    setSelectedPosts([]);
    setError(null);
    setUrl("");
  };

  const handleClose = () => {
    if (!isSubmitting) {
      resetForm();
      onClose();
    }
  };

  const removePost = (postId: string) => {
    setSelectedPosts((prev) => prev.filter((p) => p.id !== postId));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const budgetValue = Number.parseFloat(dailyBudget);
    const ageMinValue = Number.parseInt(ageMin);
    const ageMaxValue = Number.parseInt(ageMax);

    if (!adsetName.trim()) {
      setError("O nome do conjunto de anúncios é obrigatório");
      return;
    }

    if (Number.isNaN(budgetValue) || budgetValue < 1) {
      setError("Orçamento diário deve ser pelo menos R$ 1,00");
      return;
    }

    if (Number.isNaN(ageMinValue) || ageMinValue < 13 || ageMinValue > 65) {
      setError("Idade mínima deve estar entre 13 e 65");
      return;
    }

    if (Number.isNaN(ageMaxValue) || ageMaxValue < 13 || ageMaxValue > 65) {
      setError("Idade máxima deve estar entre 13 e 65");
      return;
    }

    if (ageMinValue > ageMaxValue) {
      setError("Idade mínima não pode ser maior que a idade máxima");
      return;
    }

    if (isSalesCampaign && hasPosts && !url.trim()) {
      setError(
        "Campanhas de vendas requerem uma URL de destino para o anúncio",
      );
      return;
    }

    if (url.trim() && !url.trim().startsWith("https://")) {
      setError("A URL deve começar com https://");
      return;
    }

    setIsSubmitting(true);

    try {
      const genders = gender === "male" ? [1] : gender === "female" ? [2] : [];

      const body: Record<string, unknown> = {
        userId,
        campaignId,
        campaignObjective,
        adsetName: adsetName.trim(),
        dailyBudget: budgetValue,
        targeting: {
          age_min: ageMinValue,
          age_max: ageMaxValue,
          ...(genders.length > 0 && { genders }),
          ...(includedAudiences.length > 0 && {
            custom_audiences: includedAudiences.map((a) => ({
              id: a.id,
              name: a.name,
            })),
          }),
          ...(excludedAudiences.length > 0 && {
            excluded_custom_audiences: excludedAudiences.map((a) => ({
              id: a.id,
              name: a.name,
            })),
          }),
        },
      };

      if (hasPosts) {
        body.creatives = selectedPosts.map((p) => ({
          instagramMediaId: p.id,
        }));
      }

      if (url.trim()) {
        body.url = url.trim();
      }

      const response = await fetch(`/api/meta-marketing/${accountId}/adsets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok && response.status !== 207) {
        throw new Error(data.message ?? "Falha ao criar conjunto de anúncios");
      }

      if (response.status === 207) {
        setError(
          data.message ??
            "Conjunto criado, mas algum anúncio não pôde ser adicionado automaticamente.",
        );
        onSuccess();
        return;
      }

      onSuccess();
      resetForm();
      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Erro ao criar conjunto de anúncios",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
        <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Novo Conjunto de Anúncios</DialogTitle>
            <DialogDescription>
              {campaignName
                ? `Criando em: ${campaignName}`
                : "Configure o novo conjunto de anúncios"}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="adsetName">
                Nome do Conjunto <span className="text-destructive">*</span>
              </Label>
              <Input
                id="adsetName"
                value={adsetName}
                onChange={(e) => setAdsetName(e.target.value)}
                placeholder="Ex: Conjunto de Anúncios 1"
                disabled={isSubmitting}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="dailyBudget">
                Orçamento Diário (R$){" "}
                <span className="text-destructive">*</span>
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                  R$
                </span>
                <Input
                  id="dailyBudget"
                  type="number"
                  step="0.01"
                  min="1"
                  value={dailyBudget}
                  onChange={(e) => setDailyBudget(e.target.value)}
                  placeholder="20.00"
                  className="pl-10"
                  disabled={isSubmitting}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="ageMin">Idade Mínima</Label>
                <Input
                  id="ageMin"
                  type="number"
                  min="13"
                  max="65"
                  value={ageMin}
                  onChange={(e) => setAgeMin(e.target.value)}
                  disabled={isSubmitting}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ageMax">Idade Máxima</Label>
                <Input
                  id="ageMax"
                  type="number"
                  min="13"
                  max="65"
                  value={ageMax}
                  onChange={(e) => setAgeMax(e.target.value)}
                  disabled={isSubmitting}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Gênero</Label>
              <div className="flex gap-2">
                {(
                  [
                    { value: "all", label: "Todos" },
                    { value: "male", label: "Masculino" },
                    { value: "female", label: "Feminino" },
                  ] as const
                ).map((option) => (
                  <Button
                    key={option.value}
                    type="button"
                    size="sm"
                    variant={gender === option.value ? "default" : "outline"}
                    onClick={() => setGender(option.value)}
                    disabled={isSubmitting}
                    className="flex-1"
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Incluir Públicos</Label>
              <AudienceMultiSelect
                label="Selecionar públicos para incluir..."
                audiences={availableAudiences}
                selected={includedAudiences}
                onChange={setIncludedAudiences}
                disabled={isSubmitting}
                isLoading={isLoadingAudiences}
              />
            </div>

            <div className="space-y-2">
              <Label>Excluir Públicos</Label>
              <AudienceMultiSelect
                label="Selecionar públicos para excluir..."
                audiences={availableAudiences}
                selected={excludedAudiences}
                onChange={setExcludedAudiences}
                disabled={isSubmitting}
                isLoading={isLoadingAudiences}
              />
            </div>

            {isSalesCampaign && (
              <div className="space-y-2">
                <Label htmlFor="url">
                  URL de Destino{" "}
                  {hasPosts && <span className="text-destructive">*</span>}
                </Label>
                <Input
                  id="url"
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://www.exemplo.com/produto"
                  disabled={isSubmitting}
                />
                <p className="text-xs text-muted-foreground">
                  URL do produto ou página de destino para o botão &quot;Pedir
                  agora&quot;.
                </p>
              </div>
            )}

            {isLeadsCampaign && hasPosts && (
              <Alert>
                <Info className="size-4" />
                <AlertDescription>
                  Um formulário de captação de leads será criado automaticamente
                  com campos de Nome, E-mail e Telefone.
                </AlertDescription>
              </Alert>
            )}

            {isTrafficCampaign && hasPosts && (
              <Alert>
                <Info className="size-4" />
                <AlertDescription>
                  Os anúncios terão um botão &quot;Saiba mais&quot; que
                  direcionará para o perfil do Instagram.
                </AlertDescription>
              </Alert>
            )}

            {/* Criativos (Posts do Instagram) */}
            <div className="space-y-2">
              <Label>
                Criativos (Posts do Instagram){" "}
                <span className="text-xs text-muted-foreground font-normal">
                  {selectedPosts.length}/{MAX_MEDIA_ITEMS}
                </span>
              </Label>

              {selectedPosts.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {selectedPosts.map((post, index) => {
                    const isVideo =
                      post.media_type === "VIDEO" ||
                      post.media_type === "REELS";
                    const previewUrl = isVideo
                      ? (post.media_url ?? null)
                      : (post.thumbnail_url ?? post.media_url ?? null);

                    return (
                      <div key={post.id} className="relative group">
                        <div className="relative w-20 h-20 rounded-lg overflow-hidden border border-border bg-muted">
                          {previewUrl ? (
                            isVideo ? (
                              <video
                                src={previewUrl}
                                className="w-full h-full object-cover"
                                muted
                              />
                            ) : (
                              <Image
                                src={previewUrl}
                                alt={post.caption ?? "Post selecionado"}
                                width={80}
                                height={80}
                                className="w-full h-full object-cover"
                              />
                            )
                          ) : (
                            <div className="flex w-full h-full items-center justify-center">
                              <ImageIcon className="size-5 text-muted-foreground" />
                            </div>
                          )}

                          <div className="absolute left-1 top-1 flex size-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground shadow">
                            {index + 1}
                          </div>

                          <button
                            type="button"
                            onClick={() => removePost(post.id)}
                            disabled={isSubmitting}
                            className="absolute top-1 right-1 rounded-full bg-destructive p-0.5 text-destructive-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <X className="size-3" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsMediaPickerOpen(true)}
                  disabled={isSubmitting}
                  className="w-full sm:w-auto"
                >
                  <ImageIcon className="size-4 mr-2" />
                  {hasPosts
                    ? "Alterar seleção"
                    : "Selecionar posts do Instagram"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  Opcional. Selecione até {MAX_MEDIA_ITEMS} posts. Um anúncio
                  será criado para cada post selecionado.
                </p>
              </div>
            </div>

            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                disabled={isSubmitting}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                )}
                Criar Conjunto
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Media picker nested dialog */}
      <Dialog
        open={isMediaPickerOpen}
        onOpenChange={(open) => !open && setIsMediaPickerOpen(false)}
      >
        <DialogContent className="sm:max-w-[640px] max-h-[85vh] flex flex-col p-0">
          <DialogHeader className="px-6 pt-6 pb-0">
            <DialogTitle>Selecionar Posts do Instagram</DialogTitle>
            <DialogDescription>
              Escolha até {MAX_MEDIA_ITEMS} posts para usar como criativos dos
              anúncios
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-6 pb-6 pt-4">
            <InstagramPostPicker
              accountId={accountId}
              userId={userId}
              maxSelection={MAX_MEDIA_ITEMS}
              selectedPosts={selectedPosts}
              onSelectionChange={setSelectedPosts}
            />
          </div>
          <div className="flex items-center justify-between gap-2 px-6 pb-6">
            <p className="text-sm text-muted-foreground">
              {selectedPosts.length} de {MAX_MEDIA_ITEMS} selecionado
              {selectedPosts.length !== 1 ? "s" : ""}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setIsMediaPickerOpen(false)}
              >
                Cancelar
              </Button>
              <Button onClick={() => setIsMediaPickerOpen(false)}>
                Confirmar seleção
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
