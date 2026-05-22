"use client";

import { useEffect } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import type { PageIdentity } from "./use-pages";

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

/**
 * Facebook Page selector (the ad "Identity") for the backoffice. The Instagram
 * account is derived from the chosen page. Auto-selects the first page when
 * none is chosen. Controlled: the page list comes from `usePages`.
 */
export function PageSelector({
  pages,
  isLoading = false,
  selectedPageId,
  onSelectPage,
  disabled = false,
}: PageSelectorProps) {
  // Auto-select the first page once loaded if the current selection is invalid.
  useEffect(() => {
    if (isLoading || pages.length === 0) return;
    if (!pages.some((page) => page.pageId === selectedPageId)) {
      onSelectPage(pages[0].pageId);
    }
  }, [isLoading, pages, selectedPageId, onSelectPage]);

  const selectedPage = pages.find((page) => page.pageId === selectedPageId);

  const placeholder = isLoading
    ? "Carregando páginas..."
    : pages.length === 0
      ? "Nenhuma página com Instagram conectado"
      : "Selecione uma página";

  return (
    <Select
      value={selectedPageId ?? undefined}
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
            {selectedPage.instagramUsername ? (
              <span className="truncate text-xs text-muted-foreground">
                @{selectedPage.instagramUsername}
              </span>
            ) : null}
          </div>
        ) : (
          <span className="text-muted-foreground">{placeholder}</span>
        )}
      </SelectTrigger>
      <SelectContent>
        {pages.map((page) => (
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
                {page.instagramUsername ? (
                  <span className="truncate text-xs text-muted-foreground">
                    @{page.instagramUsername}
                  </span>
                ) : null}
              </div>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
