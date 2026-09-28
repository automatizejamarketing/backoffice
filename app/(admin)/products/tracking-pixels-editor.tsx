"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  MAX_TRACKING_PIXELS,
  TRACKING_PIXEL_ID_PLACEHOLDERS,
  TRACKING_PIXEL_PROVIDER_LABELS,
  TRACKING_PIXEL_PROVIDERS,
  type TrackingPixel,
  type TrackingPixelProvider,
} from "@/lib/products/tracking-pixels";
import { TrackingPixelLogo } from "./tracking-pixel-logos";

export type TrackingPixelDraft = {
  key: string;
  provider: TrackingPixelProvider;
  pixelId: string;
  conversionLabel: string;
  purchaseOnPixGenerated: boolean;
  /** Token novo da API de Conversões (só Meta). Vazio mantém o salvo. */
  capiAccessToken: string;
  /** Remove o token salvo ao salvar. */
  capiRemove: boolean;
};

let nextDraftKey = 0;

function draftKey() {
  nextDraftKey += 1;
  return `pixel-${nextDraftKey}`;
}

export function toTrackingPixelDrafts(
  pixels: readonly TrackingPixel[],
): TrackingPixelDraft[] {
  return pixels.map((pixel) => ({
    key: draftKey(),
    provider: pixel.provider,
    pixelId: pixel.pixelId,
    conversionLabel: pixel.conversionLabel ?? "",
    purchaseOnPixGenerated: pixel.purchaseOnPixGenerated,
    capiAccessToken: "",
    capiRemove: false,
  }));
}

/** Linhas sem ID são descartadas; o servidor valida o resto. */
export function fromTrackingPixelDrafts(drafts: readonly TrackingPixelDraft[]) {
  return drafts
    .filter((draft) => draft.pixelId.trim().length > 0)
    .map((draft) => {
      const token = draft.capiAccessToken.trim();
      return {
        provider: draft.provider,
        pixelId: draft.pixelId,
        conversionLabel:
          draft.provider === "google_ads" ? draft.conversionLabel : null,
        purchaseOnPixGenerated: draft.purchaseOnPixGenerated,
        // O servidor guarda o token fora do pixel; `null` remove o salvo.
        ...(draft.provider !== "meta"
          ? {}
          : token
            ? { capiAccessToken: token }
            : draft.capiRemove
              ? { capiAccessToken: null }
              : {}),
      };
    });
}

export function TrackingPixelsEditor({
  idPrefix,
  value,
  onChange,
  disabled = false,
  capiPixelIds = [],
}: {
  idPrefix: string;
  value: TrackingPixelDraft[];
  onChange: (next: TrackingPixelDraft[]) => void;
  disabled?: boolean;
  /** Pixels Meta que já têm token da API de Conversões salvo. */
  capiPixelIds?: readonly string[];
}) {
  function update(key: string, patch: Partial<TrackingPixelDraft>) {
    onChange(
      value.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)),
    );
  }

  return (
    <div className="space-y-3">
      {value.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
          Nenhum pixel cadastrado.
        </p>
      ) : null}
      {value.map((draft) => {
        const rowId = `${idPrefix}-${draft.key}`;
        const providerLabel = TRACKING_PIXEL_PROVIDER_LABELS[draft.provider];
        return (
          <div key={draft.key} className="space-y-3 rounded-md border p-3">
            <div className="grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)] sm:items-start">
              <div className="flex flex-col gap-2">
                <Label htmlFor={`${rowId}-provider`}>Plataforma</Label>
                <Select
                  value={draft.provider}
                  disabled={disabled}
                  onValueChange={(provider) =>
                    update(draft.key, {
                      provider: provider as TrackingPixelProvider,
                    })
                  }
                >
                  <SelectTrigger id={`${rowId}-provider`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRACKING_PIXEL_PROVIDERS.map((provider) => (
                      <SelectItem key={provider} value={provider}>
                        <span className="flex items-center gap-2">
                          <TrackingPixelLogo provider={provider} />
                          {TRACKING_PIXEL_PROVIDER_LABELS[provider]}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor={`${rowId}-id`}>
                  {draft.provider === "google_ads" ? "ID da conta" : "ID do pixel"}
                </Label>
                {/* O botão estica até a altura do input: os dois design systems
                    têm input e botão de ícone de alturas diferentes. */}
                <div className="flex gap-2">
                  <Input
                    id={`${rowId}-id`}
                    value={draft.pixelId}
                    disabled={disabled}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={TRACKING_PIXEL_ID_PLACEHOLDERS[draft.provider]}
                    onChange={(event) =>
                      update(draft.key, { pixelId: event.target.value })
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={disabled}
                    className="h-auto shrink-0 self-stretch text-muted-foreground hover:text-destructive"
                    aria-label={`Remover pixel ${providerLabel}`}
                    onClick={() =>
                      onChange(value.filter((item) => item.key !== draft.key))
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            </div>
            {draft.provider === "google_ads" ? (
              <div className="space-y-2">
                <Label htmlFor={`${rowId}-label`}>
                  Rótulo da conversão de compra
                </Label>
                <Input
                  id={`${rowId}-label`}
                  value={draft.conversionLabel}
                  disabled={disabled}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Ex.: AbC-D_efG"
                  onChange={(event) =>
                    update(draft.key, { conversionLabel: event.target.value })
                  }
                />
              </div>
            ) : null}
            {draft.provider === "meta" ? (
              <div className="space-y-2">
                <Label htmlFor={`${rowId}-capi`}>
                  Token da API de Conversões (opcional)
                </Label>
                <Input
                  id={`${rowId}-capi`}
                  type="password"
                  value={draft.capiAccessToken}
                  disabled={disabled}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={
                    capiPixelIds.includes(draft.pixelId.trim())
                      ? "Token salvo. Cole outro para trocar."
                      : "Gerado no Gerenciador de Eventos da Meta"
                  }
                  onChange={(event) =>
                    update(draft.key, {
                      capiAccessToken: event.target.value,
                      capiRemove: false,
                    })
                  }
                />
                {capiPixelIds.includes(draft.pixelId.trim()) ? (
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>
                      {draft.capiRemove
                        ? "O token será removido ao salvar."
                        : "API de Conversões ativa: a compra também sai pelo servidor."}
                    </span>
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-xs"
                      disabled={disabled}
                      onClick={() =>
                        update(draft.key, {
                          capiRemove: !draft.capiRemove,
                          capiAccessToken: "",
                        })
                      }
                    >
                      {draft.capiRemove ? "Desfazer" : "Remover token"}
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs leading-5 text-muted-foreground">
                    Com o token, a compra também é enviada pelo servidor,
                    inclusive o Pix pago com o checkout fechado. Vale para
                    todos os produtos do mesmo dono com este pixel.
                  </p>
                )}
              </div>
            ) : null}
            <div className="flex items-center gap-3">
              <Switch
                id={`${rowId}-pix`}
                checked={draft.purchaseOnPixGenerated}
                disabled={disabled}
                onCheckedChange={(checked) =>
                  update(draft.key, { purchaseOnPixGenerated: checked })
                }
              />
              <Label
                htmlFor={`${rowId}-pix`}
                className="text-sm font-light text-muted-foreground"
              >
                Disparar a compra ao gerar o Pix, antes da confirmação do pagamento
              </Label>
            </div>
          </div>
        );
      })}
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || value.length >= MAX_TRACKING_PIXELS}
          onClick={() =>
            onChange([
              ...value,
              {
                key: draftKey(),
                provider: "meta",
                pixelId: "",
                conversionLabel: "",
                purchaseOnPixGenerated: false,
                capiAccessToken: "",
                capiRemove: false,
              },
            ])
          }
        >
          <Plus className="size-4" /> Adicionar pixel
        </Button>
        <span className="text-xs tabular-nums text-muted-foreground">
          {value.length}/{MAX_TRACKING_PIXELS}
        </span>
      </div>
    </div>
  );
}
