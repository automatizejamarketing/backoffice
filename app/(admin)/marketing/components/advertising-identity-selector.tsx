"use client";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { identityInstagramAccounts, selectAdvertisingIdentity, type AdvertisingIdentitySelection } from "@/lib/meta-business/advertising-identity-selection";
import { PageSelector } from "./page-selector";
import type { PageIdentity } from "./use-pages";

export function AdvertisingIdentitySelector({ pages, value, onChange, disabled, isLoading, fixedPageId }: {
  pages: PageIdentity[]; value: AdvertisingIdentitySelection | null;
  onChange: (value: AdvertisingIdentitySelection) => void;
  disabled?: boolean; isLoading?: boolean; fixedPageId?: string;
}) {
  const accounts = identityInstagramAccounts(pages, value?.pageId ?? null);
  return <div className="grid gap-4 sm:grid-cols-2">
    <div className="space-y-2 min-w-0">
      <Label>Página do Facebook</Label>
      <PageSelector pages={fixedPageId ? pages.filter(p => p.pageId === fixedPageId) : pages} selectedPageId={value?.pageId ?? null}
        isLoading={isLoading} disabled={disabled || Boolean(fixedPageId)} onSelectPage={pageId => {
          const next = selectAdvertisingIdentity(pages, { pageId, instagramUserId: value?.instagramUserId }, true, pageId);
          if (next) onChange(next);
        }} />
    </div>
    <div className="space-y-2 min-w-0">
      <Label>Conta do Instagram</Label>
      <Select value={value?.instagramUserId ?? ""} disabled={disabled || isLoading || !accounts.length}
        onValueChange={instagramUserId => { if (value && accounts.some(a => a.id === instagramUserId)) onChange({ pageId: value.pageId, instagramUserId }); }}>
        <SelectTrigger className="w-full"><SelectValue placeholder="Selecione o Instagram" /></SelectTrigger>
        <SelectContent>{accounts.map(a => <SelectItem key={a.id} value={a.id}>
          <div className="flex min-w-0 items-center gap-2">
            <Avatar className="size-5"><AvatarImage src={a.profilePictureUrl} /><AvatarFallback>{(a.username ?? "?").charAt(0).toUpperCase()}</AvatarFallback></Avatar>
            <span className="truncate">{a.username ? `@${a.username}` : a.id}</span>
          </div>
        </SelectItem>)}</SelectContent>
      </Select>
    </div>
  </div>;
}
