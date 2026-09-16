"use client";

import type { ReactNode } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import type { MetaAssetsResponse } from "@/lib/backoffice/meta-assets-types";

type MetaAssetsListsProps = {
  granted: NonNullable<MetaAssetsResponse["granted"]>;
  enabled: NonNullable<MetaAssetsResponse["enabled"]>;
};

function initial(value: string): string {
  const trimmed = value.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : "?";
}

export function MetaAssetsLists({ granted, enabled }: MetaAssetsListsProps) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="space-y-3">
        <h3 className="text-sm font-medium text-foreground">Concedidos</h3>
        <AssetGroup title="Contas de anúncios">
          {granted.adAccounts.length === 0 ? (
            <Empty>Nenhuma conta concedida</Empty>
          ) : (
            granted.adAccounts.map((account) => (
              <li
                key={account.id}
                className="flex items-start justify-between gap-3 rounded-md border border-border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{account.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {account.id}
                    {account.statusLabel ? ` · ${account.statusLabel}` : ""}
                  </p>
                </div>
                <Badges enabled={account.enabled} primary={account.primary} />
              </li>
            ))
          )}
        </AssetGroup>
        <AssetGroup title="Identidades">
          {granted.identities.length === 0 ? (
            <Empty>Nenhuma Identidade concedida</Empty>
          ) : (
            granted.identities.map((identity) => (
              <li
                key={identity.pageId}
                className="flex items-start justify-between gap-3 rounded-md border border-border px-3 py-2"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Avatar className="size-8 shrink-0">
                    <AvatarImage
                      src={identity.pagePictureUrl ?? undefined}
                      alt={identity.pageName}
                    />
                    <AvatarFallback>{initial(identity.pageName)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {identity.pageName}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {identity.instagramUsername
                        ? `@${identity.instagramUsername}`
                        : identity.pageId}
                    </p>
                  </div>
                </div>
                <Badges enabled={identity.enabled} primary={identity.primary} />
              </li>
            ))
          )}
        </AssetGroup>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium text-foreground">Habilitados</h3>
        <AssetGroup title="Contas de anúncios">
          {enabled.adAccounts.length === 0 ? (
            <Empty>Nenhuma conta habilitada</Empty>
          ) : (
            enabled.adAccounts.map((account) => (
              <li
                key={account.id}
                className="flex items-start justify-between gap-3 rounded-md border border-border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {account.name ?? account.id}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {account.id}
                  </p>
                </div>
                <Availability primary={account.primary} available={account.available} />
              </li>
            ))
          )}
        </AssetGroup>
        <AssetGroup title="Identidades">
          {enabled.identities.length === 0 ? (
            <Empty>Nenhuma Identidade habilitada</Empty>
          ) : (
            enabled.identities.map((identity) => (
              <li
                key={identity.id}
                className="flex items-start justify-between gap-3 rounded-md border border-border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {identity.name ?? identity.id}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {identity.instagramUsername
                      ? `@${identity.instagramUsername}`
                      : identity.id}
                  </p>
                </div>
                <Availability
                  primary={identity.primary}
                  available={identity.available}
                />
              </li>
            ))
          )}
        </AssetGroup>
      </section>
    </div>
  );
}

function AssetGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase text-muted-foreground">
        {title}
      </p>
      <ul className="space-y-2">{children}</ul>
    </div>
  );
}

function Empty({ children }: { children: string }) {
  return <li className="text-sm text-muted-foreground">{children}</li>;
}

function Badges({ enabled, primary }: { enabled: boolean; primary: boolean }) {
  return (
    <div className="flex shrink-0 flex-wrap justify-end gap-1">
      {enabled ? <Badge variant="secondary">habilitado</Badge> : null}
      {primary ? <Badge>principal</Badge> : null}
    </div>
  );
}

function Availability({
  primary,
  available,
}: {
  primary: boolean;
  available: boolean;
}) {
  return (
    <div className="flex shrink-0 flex-wrap justify-end gap-1">
      {primary ? <Badge>principal</Badge> : null}
      <Badge variant={available ? "secondary" : "destructive"}>
        {available ? "disponível" : "indisponível"}
      </Badge>
    </div>
  );
}
