"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { ArrowDown, ArrowDownUp, ArrowUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FacebookAdAccountBasicInfo } from "@/lib/meta-business/get-user-with-ad-accounts";
import type { AdAccountsErrorResponse } from "@/app/api/users/[id]/ad-accounts/route";
import type { SanitizedMetaBusinessAccount } from "@/lib/meta-business/sanitize";
import { DatePreset, type Campaign } from "@/lib/meta-business/types";
import {
  type CampaignObjectiveFilter,
  OBJECTIVE_GROUP_LABELS,
  OBJECTIVE_GROUP_ORDER,
} from "@/lib/meta-business/campaign-objectives";
import {
  type CampaignSortMetric,
  type SortOrder,
  CAMPAIGN_SORT_OPTIONS,
} from "@/lib/meta-business/campaign-sort";
import { AdAccountSelector } from "./ad-account-selector";
import { MetaTokenIssue } from "./meta-token-issue";
import { CampaignDetail } from "./campaign-detail";
import { CampaignsTable } from "./campaigns-table";
import { DateFilter } from "./date-filter";
import { MarketingUsersPicker } from "./marketing-users-picker";
import { MetricColumnsSelector } from "./metric-columns-selector";
import { useMetricColumnPreferences } from "../hooks/use-metric-column-preferences";
import { MARKETING_TABLE_METRIC_OPTIONS } from "../utils/campaign-metrics";
import { getMetricLabel } from "../utils/metric-formatters";

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
  const [adAccountsError, setAdAccountsError] =
    useState<AdAccountsErrorResponse | null>(null);
  const [adAccountsRefreshKey, setAdAccountsRefreshKey] = useState(0);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(
    null,
  );
  const [isCampaignDetailOpen, setIsCampaignDetailOpen] = useState(false);
  const [campaignsRefreshKey, setCampaignsRefreshKey] = useState(0);

  // Date filter for the campaigns list (mirrors the in-sheet filter). Default
  // to TODAY so the metric columns show today's numbers at first paint.
  const [datePreset, setDatePreset] = useState<DatePreset | null>(
    DatePreset.TODAY,
  );
  const [customRange, setCustomRange] = useState<{
    since: string;
    until: string;
  } | null>(null);

  // Campaign list filter/sort controls (rendered next to the date filter).
  const [objectiveFilter, setObjectiveFilter] =
    useState<CampaignObjectiveFilter>("all");
  const [sortMetric, setSortMetric] = useState<CampaignSortMetric | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const { selectedMetricIds, setSelectedMetricIds } =
    useMetricColumnPreferences();

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
    setAdAccountsError(null);
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
      setAdAccountsError(null);
      setSelectedAccountId(null);
      return;
    }

    let cancelled = false;
    setAdAccountsError(null);
    const timeoutId = setTimeout(() => {
      setIsLoadingAdAccounts(true);
    }, 0);

    fetch(`/api/users/${selectedUser.id}/ad-accounts`)
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (cancelled) return;

        if (res.ok) {
          const accounts = (body?.data ?? []) as FacebookAdAccountBasicInfo[];
          setAdAccounts(accounts);
          setAdAccountsError(null);
          setIsLoadingAdAccounts(false);
          setSelectedAccountId((prev) => {
            if (!prev && accounts.length > 0) {
              return accounts[0].account_id;
            }
            return prev;
          });
        } else {
          setAdAccounts([]);
          setSelectedAccountId(null);
          setAdAccountsError(
            (body as AdAccountsErrorResponse | null) ?? {
              error: "Erro",
              message: "Não foi possível carregar as contas de anúncios.",
              solution: "Tente novamente em alguns instantes.",
            },
          );
          setIsLoadingAdAccounts(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAdAccounts([]);
          setSelectedAccountId(null);
          setAdAccountsError({
            error: "Erro de conexão",
            message: "Não foi possível contatar o servidor.",
            solution: "Verifique a conexão e tente novamente.",
          });
          setIsLoadingAdAccounts(false);
        }
      });

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [metaAccount, selectedUser, adAccountsRefreshKey]);

  const handleClearSelection = () => {
    setSelectedUser(null);
    setMetaAccount(null);
    setAdAccounts([]);
    setAdAccountsError(null);
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
                  ) : adAccountsError ? (
                    <MetaTokenIssue
                      userId={selectedUser.id}
                      error={adAccountsError}
                      onRetried={() =>
                        setAdAccountsRefreshKey((k) => k + 1)
                      }
                    />
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
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
            <CardTitle>Campanhas</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={objectiveFilter}
                onValueChange={(value) =>
                  setObjectiveFilter(value as CampaignObjectiveFilter)
                }
              >
                <SelectTrigger className="w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OBJECTIVE_GROUP_ORDER.map((group) => (
                    <SelectItem key={group} value={group}>
                      {OBJECTIVE_GROUP_LABELS[group]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={sortMetric ?? "status"}
                onValueChange={(value) =>
                  setSortMetric(
                    value === "status" ? null : (value as CampaignSortMetric),
                  )
                }
              >
                <SelectTrigger className="w-[170px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="status">Status (padrão)</SelectItem>
                  {CAMPAIGN_SORT_OPTIONS.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                variant="outline"
                size="icon"
                disabled={!sortMetric}
                onClick={() =>
                  setSortOrder((prev) => (prev === "desc" ? "asc" : "desc"))
                }
                title={
                  !sortMetric
                    ? "Selecione uma métrica para ordenar"
                    : sortOrder === "desc"
                      ? "Maior para menor"
                      : "Menor para maior"
                }
                aria-label="Inverter ordenação"
              >
                {!sortMetric ? (
                  <ArrowDownUp className="size-4" />
                ) : sortOrder === "desc" ? (
                  <ArrowDown className="size-4" />
                ) : (
                  <ArrowUp className="size-4" />
                )}
              </Button>

              <MetricColumnsSelector
                selectedMetricIds={selectedMetricIds}
                onChange={setSelectedMetricIds}
                options={MARKETING_TABLE_METRIC_OPTIONS}
                getLabel={getMetricLabel}
              />

              <DateFilter
                datePreset={datePreset}
                onDatePresetChange={(preset) => {
                  setDatePreset(preset);
                  setCustomRange(null);
                }}
                customRange={customRange}
                onCustomRangeChange={(range) => {
                  setCustomRange(range);
                  setDatePreset(null);
                }}
              />
            </div>
          </CardHeader>
          <CardContent>
            <CampaignsTable
              accountId={selectedAccountId}
              userId={selectedUser.id}
              onCampaignClick={handleCampaignClick}
              refreshKey={campaignsRefreshKey}
              datePreset={datePreset}
              customRange={customRange}
              objectiveFilter={objectiveFilter}
              sortMetric={sortMetric}
              sortOrder={sortOrder}
              selectedMetricIds={selectedMetricIds}
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
          selectedMetricIds={selectedMetricIds}
        />
      )}
    </div>
  );
}
