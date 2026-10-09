"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { BarChart3, FileText, Settings2, Sparkles } from "lucide-react";
import { toast } from "sonner";
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
import type {
  AdAccountWithSelection,
  AdAccountsErrorResponse,
} from "@/app/api/users/[id]/ad-accounts/route";
import type { SanitizedMetaBusinessAccount } from "@/lib/meta-business/sanitize";
import { DatePreset, type Campaign } from "@/lib/meta-business/types";
import {
  type CampaignObjectiveFilter,
  OBJECTIVE_GROUP_LABELS,
  OBJECTIVE_GROUP_ORDER,
} from "@/lib/meta-business/campaign-objectives";
import {
  type SortOrder,
} from "@/lib/meta-business/campaign-sort";
import type { CampaignMetricId } from "../utils/campaign-metrics";
import { AdAccountSelector } from "./ad-account-selector";
import { AdAccountMoneyPanel } from "./ad-account-money-panel";
import { MetaAssetsCard } from "./meta-assets-card";
import { MetaTokenIssue } from "./meta-token-issue";
import { PartnerAccessPanel } from "./partner-access-panel";
import { PublishHoldAlert } from "./publish-hold-alert";
import { CampaignDetail } from "./campaign-detail";
import { CampaignsTable } from "./campaigns-table";
import { DateFilter } from "./date-filter";
import { MarketingUsersPicker } from "./marketing-users-picker";
import { MarketingAccountStatus } from "./marketing-account-status";
import { MetricColumnsSelector } from "./metric-columns-selector";
import { MarketingSortPopover } from "./marketing-sort-popover";
import { PlaybookInsightsPanel } from "./playbook-insights-panel";
import { ClientReportPanel } from "./client-report-panel";
import { PerformanceReportSection } from "./performance-report/performance-report-section";
import { useMetricColumnPreferences } from "../hooks/use-metric-column-preferences";
import type { CampaignReportFact } from "@/lib/performance-report/types";
import {
  accountDigits,
  matchAdAccountId,
  parseMarketingDeepLink,
  MARKETING_METRICS_ANCHOR,
} from "../utils/marketing-deep-link";
import { MARKETING_TABLE_METRIC_OPTIONS } from "../utils/campaign-metrics";
import { getMetricLabel } from "../utils/metric-formatters";
import { buildAudienceLibraryHref } from "../audiences/audience-account-selection";

export type MarketingWorkspaceUser = {
  id: string;
  email: string;
  image_url: string | null;
};

type MarketingWorkspaceProps = {
  initialUser?: MarketingWorkspaceUser | null;
  showHeader?: boolean;
  showUserPicker?: boolean;
  /**
   * Rendered inside the client drawer's iframe (`/embed/users/[id]`). Navigations must stay under
   * `/embed`, or the whole admin shell renders inside the drawer.
   */
  embedded?: boolean;
};

function userFromSearchParams(
  searchParams: { get: (key: string) => string | null },
): MarketingWorkspaceUser | null {
  const userId = searchParams.get("userId");
  if (!userId) return null;
  return {
    id: userId,
    email: searchParams.get("email") ?? "",
    image_url: null,
  };
}

export function MarketingWorkspace({
  initialUser = null,
  showHeader = true,
  showUserPicker = true,
  embedded = false,
}: MarketingWorkspaceProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const deepLink = parseMarketingDeepLink(searchParams);
  const [selectedUser, setSelectedUser] =
    useState<MarketingWorkspaceUser | null>(
      () => initialUser ?? userFromSearchParams(searchParams),
    );
  const [metaAccount, setMetaAccount] =
    useState<SanitizedMetaBusinessAccount | null>(null);
  const [isLoadingMeta, setIsLoadingMeta] = useState(
    () => Boolean(initialUser ?? userFromSearchParams(searchParams)),
  );
  const [adAccounts, setAdAccounts] = useState<AdAccountWithSelection[]>([]);
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
  // Slack/report links hydrate last_30d or the explicit window instead.
  const [datePreset, setDatePreset] = useState<DatePreset | null>(() => {
    if (deepLink.since && deepLink.until) return null;
    if (deepLink.datePreset) return deepLink.datePreset;
    if (deepLink.view === "report") return DatePreset.LAST_30D;
    return DatePreset.TODAY;
  });
  const [customRange, setCustomRange] = useState<{
    since: string;
    until: string;
  } | null>(() =>
    deepLink.since && deepLink.until
      ? { since: deepLink.since, until: deepLink.until }
      : null,
  );
  const [focusCampaignId, setFocusCampaignId] = useState<string | null>(
    deepLink.campaignId,
  );
  const openReportFromSlack = deepLink.view === "report";

  // Campaign list filter/sort controls (rendered next to the date filter).
  const [objectiveFilter, setObjectiveFilter] =
    useState<CampaignObjectiveFilter>("all");
  const [sortMetric, setSortMetric] = useState<CampaignMetricId | null>("purchaseRoas");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const { selectedMetricIds, setSelectedMetricIds } =
    useMetricColumnPreferences();
  const reconnectToastKey = useRef<string | null>(null);
  const lastMetaUserId = useRef<string | null>(null);
  const selectedUserId = selectedUser?.id ?? null;
  const metricsSectionRef = useRef<HTMLDivElement | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const metricsAnchorInterrupted = useRef(false);
  const metricsAnchorUserId = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedAccountId || !selectedUserId || !workspaceRef.current) return;
    if (window.location.hash !== `#${MARKETING_METRICS_ANCHOR}`) return;
    if (metricsAnchorUserId.current !== selectedUserId) {
      metricsAnchorUserId.current = selectedUserId;
      metricsAnchorInterrupted.current = false;
    }
    if (metricsAnchorInterrupted.current) return;
    let frame = 0;
    let stopped = false;
    const align = () => {
      if (stopped) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        metricsSectionRef.current?.scrollIntoView({ block: "start" });
      });
    };
    // Other account panels can finish after the metrics. Keep the anchor
    // aligned across these layout changes, only until the user interacts.
    const observer = new ResizeObserver(align);
    observer.observe(workspaceRef.current);
    const dispose = () => {
      stopped = true;
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
    const stop = () => {
      metricsAnchorInterrupted.current = true;
      dispose();
    };
    const events = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    for (const event of events) window.addEventListener(event, stop, { passive: true });
    return () => {
      dispose();
      for (const event of events) window.removeEventListener(event, stop);
    };
  }, [selectedAccountId, selectedUserId]);

  const scrollToMetrics = useCallback(() => {
    if (metricsAnchorInterrupted.current) return;
    if (!selectedAccountId || !selectedUserId) return;
    if (window.location.hash !== `#${MARKETING_METRICS_ANCHOR}`) return;
    // Wait for the metrics rows: scrolling while the skeleton is mounted can
    // hit the page's current bottom and leave the table below the viewport.
    requestAnimationFrame(() => {
      if (metricsAnchorInterrupted.current || window.location.hash !== `#${MARKETING_METRICS_ANCHOR}`) return;
      metricsSectionRef.current?.scrollIntoView({ block: "start" });
      metricsSectionRef.current?.focus({ preventScroll: true });
    });
  }, [selectedAccountId, selectedUserId]);

  useEffect(() => {
    if (initialUser) setSelectedUser(initialUser);
  }, [initialUser]);

  useEffect(() => {
    const result = searchParams.get("admin_reconnect");
    if (!result) return;
    const toastKey = `${result}:${searchParams.get("userId") ?? ""}`;
    if (reconnectToastKey.current !== toastKey) {
      reconnectToastKey.current = toastKey;
      if (result === "success") {
        toast.success("Reconexão administrativa concluída.");
      } else if (result === "asset_mismatch") {
        toast.error(
          "Os ativos retornados pela Meta não coincidem com os deste cliente.",
        );
      } else if (result === "denied") {
        toast.error("A autorização na Meta foi recusada.");
      } else if (result === "expired_state") {
        toast.error(
          "A sessão de reconexão expirou. Inicie de novo e conclua o seletor da Meta sem pausar.",
        );
      } else if (result === "invalid_state") {
        toast.error(
          "Não foi possível validar esta reconexão. Inicie o fluxo de novo.",
        );
      } else if (result === "validation_failed") {
        toast.error(
          "A Meta não devolveu um token válido. Tente a reconexão de novo.",
        );
      } else {
        toast.error("A reconexão administrativa não foi concluída.");
      }
    }
    const next = new URLSearchParams(searchParams.toString());
    next.delete("admin_reconnect");
    const query = next.toString();
    const nextUrl = query ? `/marketing?${query}` : "/marketing";
    window.history.replaceState(null, "", nextUrl);
  }, [searchParams]);

  useEffect(() => {
    if (initialUser || !showUserPicker) return;
    const userId = searchParams.get("userId");
    const email = searchParams.get("email");
    if (!userId) return;
    setSelectedUser((prev) =>
      prev?.id === userId
        ? prev
        : { id: userId, email: email ?? "", image_url: null },
    );
  }, [initialUser, searchParams, showUserPicker]);

  useEffect(() => {
    if (!selectedUserId) {
      lastMetaUserId.current = null;
      setMetaAccount(null);
      setAdAccounts([]);
      setAdAccountsError(null);
      setSelectedAccountId(null);
      setSelectedCampaign(null);
      setIsCampaignDetailOpen(false);
      setIsLoadingMeta(false);
      return;
    }

    if (lastMetaUserId.current !== selectedUserId) {
      lastMetaUserId.current = selectedUserId;
      setMetaAccount(null);
      setAdAccounts([]);
      setAdAccountsError(null);
      setSelectedAccountId(null);
      setSelectedCampaign(null);
      setIsCampaignDetailOpen(false);
    }

    let cancelled = false;
    setIsLoadingMeta(true);

    fetch(`/api/users/${selectedUserId}/meta-account`)
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
    };
  }, [selectedUserId]);

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
          const accounts = (body?.data ?? []) as AdAccountWithSelection[];
          setAdAccounts(accounts);
          setAdAccountsError(null);
          setIsLoadingAdAccounts(false);
          setSelectedAccountId((prev) => {
            if (prev) return prev;
            const fromLink = matchAdAccountId(accounts, deepLink.accountId);
            if (fromLink) return fromLink;
            if (accounts.length > 0) {
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

  const handleCampaignClick = (campaign: Campaign) => {
    setSelectedCampaign(campaign);
    setIsCampaignDetailOpen(true);
  };

  const handleOpenReportCampaign = (campaign: CampaignReportFact) => {
    setSelectedAccountId(accountDigits(campaign.accountId));
    setFocusCampaignId(campaign.id);
  };

  const handleCampaignUpdated = (campaign: Campaign) => {
    setSelectedCampaign(campaign);
    setCampaignsRefreshKey((prev) => prev + 1);
  };

  const accountSelector = (
    <AdAccountSelector
      accounts={adAccounts.map((acc) => ({
        id: acc.id,
        name: acc.name ?? `Conta ${acc.account_id}`,
        accountId: acc.account_id,
        enabled: acc.enabled,
        primary: acc.primary,
      }))}
      selectedAccountId={selectedAccountId}
      onSelectAccount={(accountId) => {
        setSelectedAccountId(accountId);
        setSelectedCampaign(null);
        setIsCampaignDetailOpen(false);
      }}
    />
  );


  const reportSection = selectedUser ? (
    <section id="marketing-reports" aria-labelledby="marketing-reports-title" className="scroll-mt-28 space-y-4 border-t border-border pt-6 sm:scroll-mt-16">
      <div className="space-y-1">
        <h2 id="marketing-reports-title" className="text-lg font-semibold tracking-tight">Relatórios</h2>
        <p className="text-sm text-muted-foreground">Consulte os dados consolidados e os relatórios enviados ao cliente.</p>
      </div>
      <PerformanceReportSection
        userId={selectedUser.id}
        accountId={deepLink.accountId}
        campaignId={deepLink.campaignId}
        datePreset={customRange ? null : datePreset}
        since={customRange?.since}
        until={customRange?.until}
        defaultOpen={openReportFromSlack}
        onOpenCampaign={handleOpenReportCampaign}
      />
      <ClientReportPanel userId={selectedUser.id} />
    </section>
  ) : null;

  return (
    <div ref={workspaceRef} className="flex min-w-0 flex-col gap-6">
      {showHeader && (
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Marketing</h1>
          <p className="text-sm text-muted-foreground">
            {selectedUser
              ? "Acompanhe as campanhas, consulte relatórios e gerencie o acesso à Meta."
              : "Selecione um usuário para acompanhar suas campanhas e contas da Meta."}
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
        <>
          <section aria-label="Cliente selecionado" className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-5">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              {selectedUser.image_url ? (
                <Image
                  src={selectedUser.image_url}
                  alt={selectedUser.email}
                  width={40}
                  height={40}
                  className="size-10 shrink-0 rounded-full"
                />
              ) : (
                <div aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-lg font-medium text-muted-foreground">
                  {selectedUser.email.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="min-w-0 space-y-1">
                <h2 className="break-all text-lg font-semibold text-foreground">
                  {selectedUser.email || "Cliente selecionado"}
                </h2>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {isLoadingMeta ? (
                    <span>Verificando conexão...</span>
                  ) : metaAccount ? (
                    <>
                      <Badge variant="outline" className="gap-1.5">
                        <span className="size-1.5 rounded-full bg-success" aria-hidden />
                        Meta conectada
                      </Badge>
                      {metaAccount.name ? <span>{metaAccount.name}</span> : null}
                    </>
                  ) : (
                    <Badge variant="outline">Meta não conectada</Badge>
                  )}
                  <span className="break-all">ID: {selectedUser.id}</span>
                </div>
                <MarketingAccountStatus key={selectedUser.id} userId={selectedUser.id} />
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push(buildAudienceLibraryHref({ userId: selectedUser.id, accountId: selectedAccountId, embedded }))}
            >
              Públicos
            </Button>
          </section>
          <nav aria-label="Seções do marketing" className="sticky top-0 z-20 flex flex-wrap items-center gap-1 border-b border-border bg-background py-2">
            {[
              { href: `#${MARKETING_METRICS_ANCHOR}`, label: "Campanhas", Icon: BarChart3 },
              { href: "#marketing-reports", label: "Relatórios", Icon: FileText },
              { href: "#marketing-settings", label: "Configurações Meta", Icon: Settings2 },
            ].map(({ href, label, Icon }) => (
              <a
                key={href}
                href={href}
                onClick={(event) => {
                  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  const section = document.getElementById(href.slice(1));
                  if (!section) return;
                  event.preventDefault();
                  if (window.location.hash !== href) {
                    window.history.pushState(null, "", href);
                  }
                  section.scrollIntoView({
                    block: "start",
                    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
                      ? "instant"
                      : "smooth",
                  });
                }}
                className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </a>
            ))}
          </nav>
          <div
            id={MARKETING_METRICS_ANCHOR}
            ref={metricsSectionRef}
            tabIndex={-1}
            className="scroll-mt-28 space-y-4 outline-none sm:scroll-mt-16"
          >
            <div className="space-y-1">
              <h2 className="text-lg font-semibold tracking-tight">Conta e campanhas</h2>
              <p className="text-sm text-muted-foreground">Selecione a conta de anúncios para consultar o saldo e o desempenho.</p>
            </div>
            {!isLoadingMeta && !metaAccount ? (
              <p className="rounded-md border border-border p-4 text-sm text-muted-foreground">
                Este usuário ainda não tem uma conta de marketing do Facebook conectada.
              </p>
            ) : null}
            {metaAccount && (
              <div className="space-y-2">
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
                  selectedAccountId ? (
                    <AdAccountMoneyPanel
                      userId={selectedUser.id}
                      accountId={selectedAccountId}
                      accountSelector={accountSelector}
                    />
                  ) : (
                    accountSelector
                  )
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Nenhuma conta de anúncios encontrada
                  </p>
                )}
              </div>
            )}
            <div className="rounded-lg border border-border bg-card px-4 py-1">
              <PlaybookInsightsPanel
                key={selectedUser.id}
                userId={selectedUser.id}
                accountId={selectedAccountId}
              />
            </div>
            {selectedAccountId && (
              <Card className="gap-0">
                <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
                  <div className="flex items-center gap-1.5">
                    <CardTitle className="text-base font-semibold">Campanhas</CardTitle>
                    <MarketingSortPopover
                      sortMetric={sortMetric}
                      sortOrder={sortOrder}
                      onSortMetricChange={setSortMetric}
                      onSortOrderChange={setSortOrder}
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      value={objectiveFilter}
                      onValueChange={(value) =>
                        setObjectiveFilter(value as CampaignObjectiveFilter)
                      }
                    >
                      <SelectTrigger aria-label="Objetivo da campanha" className="w-[160px]">
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
                    <Button
                      onClick={() =>
                        router.push(
                          `${embedded ? "/embed" : ""}/marketing/ai?userId=${selectedUser.id}&accountId=${selectedAccountId}`,
                        )
                      }
                      size="sm"
                    >
                      <Sparkles className="size-4" />
                      Criar campanha com IA
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="pt-4">
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
                    focusCampaignId={focusCampaignId}
                    onReady={scrollToMetrics}
                  />
                </CardContent>
              </Card>
            )}
          </div>

          {!openReportFromSlack ? reportSection : null}

          <section id="marketing-settings" aria-labelledby="marketing-settings-title" className="scroll-mt-28 space-y-4 border-t border-border pt-6 sm:scroll-mt-16">
            <div className="space-y-1">
              <h2 id="marketing-settings-title" className="text-lg font-semibold tracking-tight">Configurações Meta</h2>
              <p className="text-sm text-muted-foreground">Gerencie os ativos habilitados e os acessos usados para publicar.</p>
            </div>
            <MetaAssetsCard key={selectedUser.id} userId={selectedUser.id} />
            <div className="grid items-start gap-4 xl:grid-cols-2">
              <PublishHoldAlert userId={selectedUser.id} />
              {metaAccount ? (
                <PartnerAccessPanel
                  userId={selectedUser.id}
                  metaAccount={metaAccount}
                  onRetried={() => setAdAccountsRefreshKey((key) => key + 1)}
                />
              ) : null}
            </div>
            {metaAccount?.facebookUserId ? (
              <p className="break-all text-xs text-muted-foreground">Facebook User ID: {metaAccount.facebookUserId}</p>
            ) : null}
          </section>
        </>
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
          parentDatePreset={datePreset}
          parentCustomRange={customRange}
          focusAdSetId={deepLink.adsetId}
          focusAdId={deepLink.adId}
        />
      )}
    </div>
  );
}
