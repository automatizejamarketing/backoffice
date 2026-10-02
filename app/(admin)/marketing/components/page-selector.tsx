"use client";

import { distinctIdentityPages } from "@/lib/meta-business/advertising-identity-selection";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import type { PageIdentity } from "./use-pages";
import { MetaAssetSelectionBadges } from "./meta-asset-selection-badges";

export type { PageIdentity };

type PageSelectorProps = {
  pages: PageIdentity[];
  isLoading?: boolean;
  selectedPageId: string | null;
  /** Should be a stable setter (e.g. a useState dispatcher). */
  onSelectPage: (pageId: string) => void;
  disabled?: boolean;
};

function getInitial(value?: string): string {
  if (!value || value.trim().length === 0) return "?";
  return value.trim().charAt(0).toUpperCase();
}

/** Each available Facebook Page appears once; Instagram is chosen separately. */
export function PageSelector({
  pages,
  isLoading = false,
  selectedPageId,
  onSelectPage,
  disabled = false,
}: PageSelectorProps) {
  const distinctPages = distinctIdentityPages(pages);

  const selectedPage = distinctPages.find((page) => page.pageId === selectedPageId);

  const placeholder = isLoading
    ? "Carregando páginas..."
    : pages.length === 0
      ? "Nenhuma identidade disponível"
      : "Selecione uma página";

  return (
    <Select
      value={selectedPageId ?? ""}
      onValueChange={(value) => {
        if (value) onSelectPage(value);
      }}
      disabled={disabled || isLoading || pages.length === 0}
    >
      <SelectTrigger className="w-full">
        {selectedPage ? (
          <div className="flex min-w-0 items-center gap-2">
            <Avatar className="size-5 shrink-0">
              <AvatarImage
                src={selectedPage.pagePictureUrl}
                alt={selectedPage.pageName ?? ""}
              />
              <AvatarFallback className="text-xs">
                {getInitial(selectedPage.pageName)}
              </AvatarFallback>
            </Avatar>
            <span className="truncate text-sm">
              {selectedPage.pageName ?? selectedPage.pageId}
            </span>
            <MetaAssetSelectionBadges
              enabled={selectedPage.enabled}
              primary={selectedPage.primary}
            />
          </div>
        ) : (
          <span className="text-muted-foreground">{placeholder}</span>
        )}
      </SelectTrigger>
      <SelectContent>
        {distinctPages.map((page) => (
          <SelectItem key={page.pageId} value={page.pageId}>
            <div className="flex w-full items-center gap-2">
              <Avatar className="size-5 shrink-0">
                <AvatarImage
                  src={page.pagePictureUrl}
                  alt={page.pageName ?? ""}
                />
                <AvatarFallback className="text-xs">
                  {getInitial(page.pageName)}
                </AvatarFallback>
              </Avatar>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm">
                  {page.pageName ?? page.pageId}
                </span>
              </div>
              <MetaAssetSelectionBadges
                enabled={page.enabled}
                primary={page.primary}
              />
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
