"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Tags } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DEFAULT_CRM_TAGS,
  crmTagInput,
  crmTagTextColor,
  type CrmTag,
} from "@/lib/backoffice/crm-tags";

const queryKey = ["crm", "tags"] as const;
type TagSettings = { tags: CrmTag[]; canEdit: boolean };
const TagsContext = createContext<TagSettings>({
  tags: DEFAULT_CRM_TAGS,
  canEdit: false,
});

export function CrmTagsProvider({ children }: { children: ReactNode }) {
  const { data, isError, refetch } = useQuery<TagSettings>({
    queryKey,
    queryFn: async () => {
      const response = await fetch("/api/crm/tags");
      if (!response.ok) throw new Error("Não foi possível carregar as tags.");
      return response.json();
    },
  });
  return (
    <TagsContext.Provider
      value={data ?? { tags: DEFAULT_CRM_TAGS, canEdit: false }}
    >
      {isError && (
        <div
          role="alert"
          className="mb-3 flex items-center gap-3 text-sm text-destructive"
        >
          Não foi possível carregar as configurações das tags.
          <Button size="sm" variant="outline" onClick={() => void refetch()}>
            Tentar novamente
          </Button>
        </div>
      )}
      {children}
    </TagsContext.Provider>
  );
}
export const useCrmTags = () => useContext(TagsContext);

export function CrmTagBadge({ tag }: { tag: CrmTag }) {
  return (
    <Badge
      title={tag.name}
      className="max-w-full truncate"
      style={{
        backgroundColor: tag.color,
        borderColor: tag.color,
        color: crmTagTextColor(tag.color),
      }}
    >
      {tag.name}
    </Badge>
  );
}

function TagEditor({ tag }: { tag: CrmTag }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(tag.name);
  const [color, setColor] = useState(tag.color);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const changed = name !== tag.name || color.toUpperCase() !== tag.color;
  return (
    <form
      className="space-y-3 border-b pb-5 last:border-0 last:pb-0"
      onSubmit={async (e) => {
        e.preventDefault();
        const parsed = crmTagInput.safeParse({ key: tag.key, name, color });
        if (!parsed.success) {
          setError(parsed.error.issues[0].message);
          return;
        }
        setSaving(true);
        setError(null);
        setSaved(false);
        try {
          const response = await fetch("/api/crm/tags", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(parsed.data),
          });
          const result = await response.json();
          if (!response.ok)
            throw new Error(result.error ?? "Não foi possível salvar a tag.");
          queryClient.setQueryData(queryKey, result);
          setName(parsed.data.name);
          setColor(parsed.data.color);
          setSaved(true);
        } catch (cause) {
          setError(
            cause instanceof Error ? cause.message : "Não foi possível salvar.",
          );
        } finally {
          setSaving(false);
        }
      }}
    >
      <div className="text-xs text-muted-foreground">
        {tag.key.startsWith("source:") ? "Campanha" : "Perfil"} ·{" "}
        {DEFAULT_CRM_TAGS.find((t) => t.key === tag.key)?.name}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
        <div className="space-y-2">
          <Label htmlFor={`${tag.key}-name`}>Nome da tag</Label>
          <Input
            id={`${tag.key}-name`}
            value={name}
            required
            maxLength={60}
            disabled={saving}
            onChange={(e) => {
              setName(e.target.value);
              setSaved(false);
            }}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${tag.key}-color`}>Cor</Label>
          <Input
            id={`${tag.key}-color`}
            type="color"
            className="w-14 cursor-pointer p-1"
            value={color}
            disabled={saving}
            onInput={(e) => {
              setColor(e.currentTarget.value);
              setSaved(false);
            }}
            onChange={(e) => {
              setColor(e.target.value);
              setSaved(false);
            }}
          />
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <CrmTagBadge tag={{ ...tag, name: name.trim() || tag.name, color }} />
        </div>
        <Button
          className="shrink-0"
          type="submit"
          size="sm"
          disabled={saving || !changed}
        >
          {saving ? "Salvando…" : "Salvar tag"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="text-xs text-muted-foreground">
          Tag atualizada em todo o CRM.
        </p>
      )}
    </form>
  );
}

export function CrmTagSettings() {
  const { tags, canEdit } = useCrmTags();
  if (!canEdit) return null;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Tags className="size-4" />
          Configurar tags
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Tags do CRM</DialogTitle>
          <DialogDescription>
            Edite o nome e a cor para toda a equipe. As alterações valem para
            contatos atuais, novos contatos e filtros, sem mudar a campanha ou o
            perfil de origem.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          {tags.map((tag) => (
            <TagEditor key={tag.key} tag={tag} />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
