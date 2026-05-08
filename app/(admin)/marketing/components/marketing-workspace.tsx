"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { FacebookAdAccountBasicInfo } from "@/lib/meta-business/get-user-with-ad-accounts";
import type { SanitizedMetaBusinessAccount } from "@/lib/meta-business/sanitize";
import type { Campaign } from "@/lib/meta-business/types";
import { AdAccountSelector } from "./ad-account-selector";
import { CampaignDetail } from "./campaign-detail";
import { CampaignsTable } from "./campaigns-table";
import { MarketingUsersPicker } from "./marketing-users-picker";

export type MarketingWorkspaceUser = {
  id: string;
  email: string;
  image_url: string | null;
};

type MarketingWorkspaceProps = {
  initialUser?: MarketingWorkspaceUser | null;
  showHeader?: boolean;
  showUserPicker?: boolean;
};

export function MarketingWorkspace({
  initialUser = null,
  showHeader = true,
  showUserPicker = true,
}: MarketingWorkspaceProps) {
  const searchParams = useSearchParams();
  const [selectedUser, setSelectedUser] =
    useState<MarketingWorkspaceUser | null>(initialUser);
  const [metaAccount, setMetaAccount] =
    useState<SanitizedMetaBusinessAccount | null>(null);
  const [isLoadingMeta, setIsLoadingMeta] = useState(false);
  const [adAccounts, setAdAccounts] = useState<FacebookAdAccountBasicInfo[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(
    null,
  );
  const [isLoadingAdAccounts, setIsLoadingAdAccounts] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(
    null,
  );
  const [isCampaignDetailOpen, setIsCampaignDetailOpen] = useState(false);
  const [campaignsRefreshKey, setCampaignsRefreshKey] = useState(0);

  useEffect(() => {
    setSelectedUser(initialUser);
  }, [initialUser]);

  useEffect(() => {
    if (initialUser || !showUserPicker) return;
    const userId = searchParams.get("userId");
    const email = searchParams.get("email");
    if (!userId || !email) return;
    setSelectedUser((prev) =>
      prev?.id === userId ? prev : { id: userId, email, image_url: null },
    );
  }, [initialUser, searchParams, showUserPicker]);

  useEffect(() => {
    setMetaAccount(null);
    setAdAccounts([]);
    setSelectedAccountId(null);
    setSelectedCampaign(null);
    setIsCampaignDetailOpen(false);

    if (!selectedUser) return;

    let cancelled = false;
    const timeoutId = setTimeout(() => {
      setIsLoadingMeta(true);
    }, 0);

    fetch(`/api/users/${selectedUser.id}/meta-account`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled) {
          setMetaAccount(data);
          setIsLoadingMeta(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMetaAccount(null);
          setIsLoadingMeta(false);
        }
      });

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [selectedUser]);

  useEffect(() => {
    if (!metaAccount || !selectedUser) {
      setAdAccounts([]);
      setSelectedAccountId(null);
      return;
    }

    let cancelled = false;
    const timeoutId = setTimeout(() => {
      setIsLoadingAdAccounts(true);
    }, 0);

    fetch(`/api/users/${selectedUser.id}/ad-accounts`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) {
          const accounts = data.data ?? [];
          setAdAccounts(accounts);
          setIsLoadingAdAccounts(false);
          setSelectedAccountId((prev) => {
            if (!prev && accounts.length > 0) {
              return accounts[0].account_id;
            }
            return prev;
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAdAccounts([]);
          setIsLoadingAdAccounts(false);
        }
      });

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [metaAccount, selectedUser]);

  const handleClearSelection = () => {
    setSelectedUser(null);
    setMetaAccount(null);
    setAdAccounts([]);
    setSelectedAccountId(null);
    setSelectedCampaign(null);
    setIsCampaignDetailOpen(false);
  };

  const handleCampaignClick = (campaign: Campaign) => {
    setSelectedCampaign(campaign);
    setIsCampaignDetailOpen(true);
  };

  const handleCampaignUpdated = (campaign: Campaign) => {
    setSelectedCampaign(campaign);
    setCampaignsRefreshKey((prev) => prev + 1);
  };

  return (
    <div className="space-y-8">
      {showHeader && (
        <div>
          <h1 className="text-2xl font-bold text-foreground">Marketing</h1>
          <p className="text-sm text-muted-foreground">
            Selecione um usuário com conta de marketing do Facebook conectada
            para visualizar suas campanhas
          </p>
        </div>
      )}

      {!selectedUser && showUserPicker && (
        <Card>
          <CardHeader>
            <CardTitle>Usuários com Conta de Marketing Conectada</CardTitle>
          </CardHeader>
          <CardContent>
            <MarketingUsersPicker onSelectUser={setSelectedUser} />
          </CardContent>
        </Card>
      )}

      {selectedUser && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>Detalhes do usuário</CardTitle>
              {showUserPicker && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleClearSelection}
                >
                  Buscar outro usuário
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              <div className="flex items-center gap-4">
                {selectedUser.image_url ? (
                  <Image
                    src={selectedUser.image_url}
                    alt={selectedUser.email}
                    width={64}
                    height={64}
                    className="h-16 w-16 rounded-full"
                  />
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-2xl font-medium text-muted-foreground">
                    {selectedUser.email.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <h2 className="truncate text-xl font-bold text-foreground">
                    {selectedUser.email}
                  </h2>
                  <p className="truncate text-sm text-muted-foreground">
                    ID: {selectedUser.id}
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-medium text-foreground">
                  Status da conta de marketing do Facebook
                </h3>
                {isLoadingMeta ? (
                  <p className="text-sm text-muted-foreground">
                    Verificando conexão...
                  </p>
                ) : metaAccount ? (
                  <div className="rounded-md border border-border bg-muted/30 p-4">
                    <div className="flex items-center gap-2">
                      <Badge variant="default">Conectado</Badge>
                      <p className="text-sm text-foreground">
                        Usuário conectado a conta de marketing do Facebook
                      </p>
                    </div>
                    {metaAccount.name && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Nome: {metaAccount.name}
                      </p>
                    )}
                    {metaAccount.facebookUserId && (
                      <p className="text-xs text-muted-foreground">
                        Facebook User ID: {metaAccount.facebookUserId}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="rounded-md border border-border bg-muted/30 p-4">
                    <p className="text-sm text-foreground">
                      Usuário não conectado a conta de marketing do Facebook
                    </p>
                  </div>
                )}
              </div>

              {metaAccount && (
                <div className="space-y-2">
                  <h3 className="text-sm font-medium text-foreground">
                    Conta de anúncios
                  </h3>
                  {isLoadingAdAccounts ? (
                    <p className="text-sm text-muted-foreground">
                      Carregando contas de anúncios...
                    </p>
                  ) : adAccounts.length > 0 ? (
                    <AdAccountSelector
                      accounts={adAccounts.map((acc) => ({
                        id: acc.id,
                        name: acc.name ?? `Conta ${acc.account_id}`,
                        accountId: acc.account_id,
                      }))}
                      selectedAccountId={selectedAccountId}
                      onSelectAccount={(accountId) => {
                        setSelectedAccountId(accountId);
                        setSelectedCampaign(null);
                        setIsCampaignDetailOpen(false);
                      }}
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Nenhuma conta de anúncios encontrada
                    </p>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {selectedAccountId && selectedUser && (
        <Card>
          <CardHeader>
            <CardTitle>Campanhas</CardTitle>
          </CardHeader>
          <CardContent>
            <CampaignsTable
              accountId={selectedAccountId}
              userId={selectedUser.id}
              onCampaignClick={handleCampaignClick}
              refreshKey={campaignsRefreshKey}
            />
          </CardContent>
        </Card>
      )}

      {selectedCampaign && selectedAccountId && selectedUser && (
        <CampaignDetail
          campaign={selectedCampaign}
          accountId={selectedAccountId}
          userId={selectedUser.id}
          isOpen={isCampaignDetailOpen}
          onClose={() => {
            setIsCampaignDetailOpen(false);
            setSelectedCampaign(null);
          }}
          onCampaignUpdated={handleCampaignUpdated}
        />
      )}
    </div>
  );
}
