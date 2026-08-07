import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  getAllUsersWithUsage,
  getUserExpirationDayCounts,
} from "@/lib/db/admin-queries";
import { listConsultantsForFilter } from "@/lib/db/backoffice-rbac-queries";
import { Button } from "@/components/ui/button";
import { DEFAULT_PAGE_SIZE } from "./constants";
import { UsersTableToolbar } from "./users-table-toolbar";
import { UsersTable } from "./users-table";
import { normalizeUsersFilterParams } from "@/lib/backoffice/users-filters";
import { requirePagePermission } from "@/lib/auth/rbac";
import { hasBackofficePermission } from "@/lib/auth/rbac-core";
import {
  UsersFetchingIndicator,
  UsersNavigationProvider,
} from "./users-navigation-feedback";

// Force dynamic rendering to prevent build timeouts on Vercel
// This page queries all users with usage stats, which can be slow
export const dynamic = "force-dynamic";

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    pageSize?: string;
    q?: string;
    subscriptionStatus?: string;
    planPeriod?: string;
    metaStatus?: string;
    activationStatus?: string;
    campaignStatus?: string;
    performanceStatus?: string;
    accessExpiration?: string;
    accountStatus?: string;
    filterField?: string;
    filterOperator?: string;
    filterValue?: string;
    renewalWithin?: string;
    sort?: string;
    consultantId?: string;
    signupWithin?: string;
    signupFrom?: string;
    signupTo?: string;
  }>;
}) {
  const actor = await requirePagePermission("users:manage");
  const canManageBilling = hasBackofficePermission(actor, "billing:manage");

  const sp = await searchParams;
  const filters = normalizeUsersFilterParams(sp);
  const { page, pageSize, search } = filters;

  const [
    { users, total, pageSize: appliedPageSize },
    consultants,
    expirationDayCounts,
  ] =
    await Promise.all([
      getAllUsersWithUsage({
        page,
        pageSize,
        search,
        filters,
      }),
      listConsultantsForFilter(),
      getUserExpirationDayCounts(),
    ]);
  const totalPages = Math.max(1, Math.ceil(total / appliedPageSize));
  const currentPage = Math.min(page, totalPages);
  const hasPrevious = currentPage > 1;
  const hasNext = currentPage < totalPages;

  // Preserve `pageSize` and `q` when building pagination links so navigating
  // between pages keeps the active filter and chosen page size.
  function buildPageHref(targetPage: number): string {
    const params = new URLSearchParams();
    params.set("page", String(targetPage));
    if (pageSize !== DEFAULT_PAGE_SIZE) {
      params.set("pageSize", String(pageSize));
    }
    if (search) {
      params.set("q", search);
    }
    if (filters.subscriptionStatus !== "all") {
      params.set("subscriptionStatus", filters.subscriptionStatus);
    }
    if (filters.planPeriod !== "all") {
      params.set("planPeriod", filters.planPeriod);
    }
    if (filters.metaStatus !== "all") {
      params.set("metaStatus", filters.metaStatus);
    }
    if (filters.activationStatus !== "all") {
      params.set("activationStatus", filters.activationStatus);
    }
    if (filters.campaignStatus !== "all") {
      params.set("campaignStatus", filters.campaignStatus);
    }
    if (filters.performanceStatus !== "all") {
      params.set("performanceStatus", filters.performanceStatus);
    }
    if (filters.accessExpiration !== "all") {
      params.set("accessExpiration", filters.accessExpiration);
    }
    if (filters.accountStatus !== "all") {
      params.set("accountStatus", filters.accountStatus);
    }
    if (filters.fieldFilter) {
      params.set("filterField", filters.fieldFilter.field);
      params.set("filterOperator", filters.fieldFilter.operator);
      params.set("filterValue", filters.fieldFilter.value);
    }
    if (filters.sort !== "default") {
      params.set("sort", filters.sort);
    }
    if (filters.consultantId !== "all") {
      params.set("consultantId", filters.consultantId);
    }
    if (filters.signupWithin !== "all") {
      params.set("signupWithin", filters.signupWithin);
      if (
        filters.signupWithin === "custom" &&
        filters.signupFrom &&
        filters.signupTo
      ) {
        params.set("signupFrom", filters.signupFrom);
        params.set("signupTo", filters.signupTo);
      }
    }
    return `/users?${params.toString()}`;
  }

  const formatNumber = (value: number) => {
    return new Intl.NumberFormat("pt-BR").format(value);
  };

  return (
    <UsersNavigationProvider>
      <div className="space-y-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-foreground">Usuários</h1>
            <UsersFetchingIndicator />
          </div>
          <p className="text-sm text-muted-foreground">
            Todos os usuários cadastrados e suas estatísticas de uso
          </p>
        </div>

        <UsersTableToolbar
          initialSearch={search}
          pageSize={pageSize}
          filters={{
            subscriptionStatus: filters.subscriptionStatus,
            planPeriod: filters.planPeriod,
            metaStatus: filters.metaStatus,
            activationStatus: filters.activationStatus,
            campaignStatus: filters.campaignStatus,
            performanceStatus: filters.performanceStatus,
            accessExpiration: filters.accessExpiration,
            accountStatus: filters.accountStatus,
            fieldFilter: filters.fieldFilter,
            sort: filters.sort,
            consultantId: filters.consultantId,
            signupWithin: filters.signupWithin,
            signupFrom: filters.signupFrom,
            signupTo: filters.signupTo,
          }}
          consultants={consultants}
          expirationDayCounts={expirationDayCounts}
        />

        <UsersTable
          users={users}
          search={search}
          canManageBilling={canManageBilling}
        />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            Página {currentPage} de {totalPages} · {formatNumber(total)} usuários
            {search ? " encontrados" : " no total"}
          </p>
          <div className="flex items-center gap-1.5">
            {hasPrevious ? (
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="h-8 px-3 text-xs gap-1"
              >
                <Link href={buildPageHref(currentPage - 1)}>
                  <ChevronLeft className="size-3.5" />
                  Anterior
                </Link>
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                disabled
                className="h-8 px-3 text-xs gap-1"
              >
                <ChevronLeft className="size-3.5" />
                Anterior
              </Button>
            )}
            {hasNext ? (
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="h-8 px-3 text-xs gap-1"
              >
                <Link href={buildPageHref(currentPage + 1)}>
                  Próxima
                  <ChevronRight className="size-3.5" />
                </Link>
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                disabled
                className="h-8 px-3 text-xs gap-1"
              >
                Próxima
                <ChevronRight className="size-3.5" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </UsersNavigationProvider>
  );
}
