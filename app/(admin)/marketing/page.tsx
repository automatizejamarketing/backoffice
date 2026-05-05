"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AdAccountSelector } from "./components/ad-account-selector";
import { CampaignsTable } from "./components/campaigns-table";
import { CampaignDetail } from "./components/campaign-detail";
import { MarketingUsersPicker } from "./components/marketing-users-picker";
import type { Campaign } from "@/lib/meta-business/types";
import type { FacebookAdAccountBasicInfo } from "@/lib/meta-business/get-user-with-ad-accounts";

type User = {
  id: string;
  email: string;
  image_url: string | null;
};

type MetaBusinessAccount = {
  id: string;
  userId: string;
  facebookUserId: string;
  name: string | null;
  pictureUrl: string | null;
  accessToken: string;
  tokenExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
} | null;

export default function MarketingPage() {
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [metaAccount, setMetaAccount] = useState<MetaBusinessAccount>(null);
  const [isLoadingMeta, setIsLoadingMeta] = useState(false);
  const [adAccounts, setAdAccounts] = useState<FacebookAdAccountBasicInfo[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [isLoadingAdAccounts, setIsLoadingAdAccounts] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [isCampaignDetailOpen, setIsCampaignDetailOpen] = useState(false);
  const [campaignsRefreshKey, setCampaignsRefreshKey] = useState(0);

  // Fetch meta account when user is selected
  useEffect(() => {
    if (selectedUser) {
      let cancelled = false;
      // Use setTimeout to avoid synchronous setState in effect
      const timeoutId = setTimeout(() => {
        setIsLoadingMeta(true);
      }, 0);
      fetch(`/api/users/${selectedUser.id}/meta-account`)
        .then((res) => res.json())
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
    }
  }, [selectedUser]);

  // Fetch ad accounts when meta account is available
  useEffect(() => {
    if (!metaAccount || !selectedUser) {
      // Reset state when meta account or user is not available
      const timeoutId = setTimeout(() => {
        setAdAccounts([]);
        setSelectedAccountId(null);
      }, 0);
      return () => {
        clearTimeout(timeoutId);
      };
    }

    let cancelled = false;
    // Use setTimeout to avoid synchronous setState in effect
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
          // Auto-select first account if none is selected and accounts exist
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

  const handleUserSelect = (user: User) => {
    setSelectedUser(user);
  };

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

  const handleCloseCampaignDetail = () => {
    setIsCampaignDetailOpen(false);
    setSelectedCampaign(null);
  };

  const handleCampaignUpdated = (campaign: Campaign) => {
    setSelectedCampaign(campaign);
    setCampaignsRefreshKey((prev) => prev + 1);
  };


  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Marketing</h1>
        <p className="text-sm text-muted-foreground">
          Selecione um usuário com conta de marketing do Facebook conectada
          para visualizar suas campanhas
        </p>
      </div>

      {/* Users List - Only show when no user is selected */}
      {!selectedUser && (
        <Card>
          <CardHeader>
            <CardTitle>Usuários com Conta de Marketing Conectada</CardTitle>
          </CardHeader>
          <CardContent>
            <MarketingUsersPicker onSelectUser={handleUserSelect} />
          </CardContent>
        </Card>
      )}

      {/* Selected User Details */}
      {selectedUser && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Detalhes do Usuário</CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={handleClearSelection}
              >
                Buscar Outro Usuário
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {/* User Info */}
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
                <div>
                  <h2 className="text-xl font-bold text-foreground">
                    {selectedUser.email}
                  </h2>
                  <p className="text-sm text-muted-foreground">ID: {selectedUser.id}</p>
                </div>
              </div>

              {/* Meta Account Status */}
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-foreground">
                  Status da Conta de Marketing do Facebook
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

              {/* Ad Account Selector */}
              {metaAccount && (
                <div className="space-y-2">
                  <h3 className="text-sm font-medium text-foreground">
                    Conta de Anúncios
                  </h3>
                  {isLoadingAdAccounts ? (
                    <p className="text-sm text-muted-foreground">
                      Carregando contas de anúncios...
                    </p>
                  ) : adAccounts.length > 0 ? (
                    <div className="space-y-4">
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
                    </div>
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

      {/* Campaigns Table */}
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

      {/* Campaign Detail Sheet */}
      {selectedCampaign && selectedAccountId && selectedUser && (
        <CampaignDetail
          campaign={selectedCampaign}
          accountId={selectedAccountId}
          userId={selectedUser.id}
          isOpen={isCampaignDetailOpen}
          onClose={handleCloseCampaignDetail}
          onCampaignUpdated={handleCampaignUpdated}
        />
      )}
    </div>
  );
}
