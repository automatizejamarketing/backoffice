"use client";

import type { ReactNode } from "react";
import { identityKey } from "@/lib/meta-business/advertising-identity-key";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import type { MetaAssetsResponse } from "@/lib/backoffice/meta-assets-types";

type MetaAssetsListsProps = {
  granted: MetaAssetsResponse["granted"];
  enabled: NonNullable<MetaAssetsResponse["enabled"]>;
  limits: MetaAssetsResponse["limits"];
};

export function MetaAssetsLists({ granted, enabled, limits }: MetaAssetsListsProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2 md:gap-6">
      <AssetGroup title="Contas de anúncios" count={enabled.adAccounts.length} limit={limits.adAccounts}>
        {enabled.adAccounts.length === 0 ? (
          <li className="py-2 text-sm text-muted-foreground">Nenhuma conta habilitada</li>
        ) : enabled.adAccounts.map((account) => {
          const status = granted?.adAccounts.find((item) => item.id === account.id)?.statusLabel;
          return (
            <li key={account.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 break-words text-sm" title={account.id}>
                {account.name ?? account.id}
              </span>
              <AssetBadges primary={account.primary} available={account.available} status={status} />
            </li>
          );
        })}
      </AssetGroup>
      <AssetGroup title="Identidades" count={enabled.identities.length} limit={limits.identities}>
        {enabled.identities.length === 0 ? (
          <li className="py-2 text-sm text-muted-foreground">Nenhuma identidade habilitada</li>
        ) : enabled.identities.map((identity) => {
          const grantedIdentity = granted?.identities.find((item) => identityKey(item) === identity.id);
          const name = identity.name ?? identity.id;
          return (
            <li key={identity.id} className="flex items-center justify-between gap-3 py-2">
              <div className="flex min-w-0 items-center gap-2" title={identity.id}>
                <Avatar className="size-6 shrink-0">
                  <AvatarImage src={grantedIdentity?.pagePictureUrl ?? undefined} alt={name} />
                  <AvatarFallback>{name.trim().charAt(0).toUpperCase() || "?"}</AvatarFallback>
                </Avatar>
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                  <span className="break-words text-sm">{name}</span>
                  {identity.instagramUsername ? (
                    <span className="break-all text-xs text-muted-foreground">@{identity.instagramUsername}</span>
                  ) : null}
                </div>
              </div>
              <AssetBadges primary={identity.primary} available={identity.available} />
            </li>
          );
        })}
      </AssetGroup>
    </div>
  );
}

function AssetGroup({ title, count, limit, children }: {
  title: string;
  count: number;
  limit: number;
  children: ReactNode;
}) {
  return (
    <section className="space-y-1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-medium">{title}</h3>
        <span className="text-xs text-muted-foreground">
          {`${count} ${count === 1 ? "habilitada" : "habilitadas"} / limite ${limit}`}
        </span>
      </div>
      <ul className="divide-y divide-border">{children}</ul>
    </section>
  );
}

function AssetBadges({ primary, available, status }: {
  primary: boolean;
  available: boolean;
  status?: string | null;
}) {
  return (
    <div className="flex shrink-0 flex-wrap justify-end gap-1">
      {primary ? <Badge>principal</Badge> : null}
      {!available ? <Badge variant="destructive">indisponível</Badge> : status ? <Badge variant="secondary">{status}</Badge> : null}
    </div>
  );
}
