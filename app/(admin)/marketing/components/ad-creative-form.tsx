"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const MAX_TITLES = 5;
export const MAX_TEXTS = 5;

export type AdCreativeFormValue = {
  titles: string[];
  texts: string[];
  ctaType: string;
  linkUrl: string;
  status: "ACTIVE" | "PAUSED";
};

export const DEFAULT_AD_CREATIVE_FORM: AdCreativeFormValue = {
  titles: [""],
  texts: [""],
  ctaType: "ORDER_NOW",
  linkUrl: "",
  status: "PAUSED",
};

const CTA_OPTIONS: { value: string; label: string }[] = [
  { value: "ORDER_NOW", label: "Pedir agora" },
  { value: "SHOP_NOW", label: "Comprar agora" },
  { value: "LEARN_MORE", label: "Saiba mais" },
  { value: "SIGN_UP", label: "Cadastre-se" },
  { value: "SUBSCRIBE", label: "Assinar" },
  { value: "GET_OFFER", label: "Ver oferta" },
  { value: "CONTACT_US", label: "Fale conosco" },
  { value: "BOOK_TRAVEL", label: "Reservar" },
  { value: "DOWNLOAD", label: "Baixar" },
  { value: "SEND_MESSAGE", label: "Enviar mensagem" },
];

export function isValidHttpsUrl(value: string): boolean {
  return /^https:\/\/.+/i.test(value.trim());
}

export function hasValidDynamicText(value: AdCreativeFormValue): boolean {
  const titles = value.titles.map((t) => t.trim()).filter(Boolean);
  const texts = value.texts.map((t) => t.trim()).filter(Boolean);
  return (
    titles.length >= 1 &&
    titles.length <= MAX_TITLES &&
    texts.length >= 1 &&
    texts.length <= MAX_TEXTS
  );
}

type AdCreativeFormProps = {
  value: AdCreativeFormValue;
  onChange: (value: AdCreativeFormValue) => void;
  /** Instagram media preserves its own caption — hide titles/texts. */
  hideText?: boolean;
  showStatus?: boolean;
  disabled?: boolean;
};

export function AdCreativeForm({
  value,
  onChange,
  hideText = false,
  showStatus = true,
  disabled = false,
}: AdCreativeFormProps) {
  const set = <K extends keyof AdCreativeFormValue>(
    key: K,
    v: AdCreativeFormValue[K],
  ) => onChange({ ...value, [key]: v });

  const updateList = (
    key: "titles" | "texts",
    index: number,
    v: string,
  ) => {
    const next = [...value[key]];
    next[index] = v;
    set(key, next);
  };

  const addToList = (key: "titles" | "texts", max: number) => {
    if (value[key].length < max) set(key, [...value[key], ""]);
  };

  const removeFromList = (key: "titles" | "texts", index: number) => {
    const next = value[key].filter((_, i) => i !== index);
    set(key, next.length > 0 ? next : [""]);
  };

  const linkInvalid =
    value.linkUrl.length > 0 && !isValidHttpsUrl(value.linkUrl);

  return (
    <div className="flex flex-col gap-5">
      {!hideText && (
        <>
          <div className="space-y-2.5">
            <div className="flex items-center gap-2">
              <Label className="text-sm font-medium">Títulos</Label>
              <span className="text-xs tabular-nums text-muted-foreground">
                {value.titles.length}/{MAX_TITLES}
              </span>
            </div>
            <div className="space-y-2">
              {value.titles.map((title, index) => (
                <div key={index} className="flex gap-2">
                  <Input
                    placeholder={`Título ${index + 1}`}
                    value={title}
                    disabled={disabled}
                    onChange={(e) =>
                      updateList("titles", index, e.target.value)
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={disabled}
                    onClick={() => removeFromList("titles", index)}
                    className="size-9 shrink-0 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
            {value.titles.length < MAX_TITLES && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => addToList("titles", MAX_TITLES)}
                className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <Plus className="size-3.5" />
                Adicionar título
              </Button>
            )}
          </div>

          <div className="space-y-2.5">
            <div className="flex items-center gap-2">
              <Label className="text-sm font-medium">Textos principais</Label>
              <span className="text-xs tabular-nums text-muted-foreground">
                {value.texts.length}/{MAX_TEXTS}
              </span>
            </div>
            <div className="space-y-2">
              {value.texts.map((text, index) => (
                <div key={index} className="flex gap-2">
                  <Textarea
                    rows={3}
                    placeholder={`Texto principal ${index + 1}`}
                    value={text}
                    disabled={disabled}
                    onChange={(e) =>
                      updateList("texts", index, e.target.value)
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={disabled}
                    onClick={() => removeFromList("texts", index)}
                    className="size-9 shrink-0 self-start text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
            {value.texts.length < MAX_TEXTS && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => addToList("texts", MAX_TEXTS)}
                className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <Plus className="size-3.5" />
                Adicionar texto principal
              </Button>
            )}
          </div>
        </>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="ad-cta">Botão (CTA)</Label>
          <Select
            value={value.ctaType}
            onValueChange={(v) => set("ctaType", v)}
            disabled={disabled}
          >
            <SelectTrigger id="ad-cta">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CTA_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {showStatus && (
          <div className="space-y-1.5">
            <Label htmlFor="ad-status">Status do anúncio</Label>
            <Select
              value={value.status}
              onValueChange={(v) =>
                set("status", v === "ACTIVE" ? "ACTIVE" : "PAUSED")
              }
              disabled={disabled}
            >
              <SelectTrigger id="ad-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PAUSED">Pausado</SelectItem>
                <SelectItem value="ACTIVE">Ativo</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="ad-link">URL de destino</Label>
        <Input
          id="ad-link"
          disabled={disabled}
          placeholder="https://..."
          value={value.linkUrl}
          onChange={(e) => set("linkUrl", e.target.value)}
          aria-invalid={linkInvalid}
        />
        {linkInvalid && (
          <p className="text-xs text-destructive">
            Informe uma URL válida começando com https://
          </p>
        )}
      </div>
    </div>
  );
}
