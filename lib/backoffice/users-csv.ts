import type { UserWithUsage } from "@/lib/db/admin-queries";
import {
  UNCLASSIFIED_FINANCE_PROVIDER_LABEL,
  isKnownBillingProvider,
} from "@/lib/backoffice/finance-provider";
import type { BillingProvider } from "@/lib/db/schema";
import { formatCalendarDayInSaoPaulo } from "@/lib/backoffice/datetime-format";
import { formatBrazilianPhone } from "@/lib/phone";
import {
  formatPlanLabel,
  getStatusBadgeProps,
} from "@/lib/subscriptions/derive";

const PROVIDER_LABELS: Record<BillingProvider, string> = {
  stripe: "Cartão",
  mercadopago: "Pix",
  manual: "Manual",
};

const CSV_COLUMNS = [
  "Email",
  "Nome",
  "Empresa",
  "Onboarding",
  "Telefone",
  "Plano",
  "Provedor",
  "Status",
  "Expiração",
  "Campanha",
  "Performance 7d",
  "Meta",
  "Conta Meta",
  "Consultor",
  "Email consultor",
  "Posts",
  "Requisições IA",
  "Tokens",
  "Custo (USD)",
  "Créditos",
  "Cadastro",
] as const;

export function escapeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function formatCampaignStatus(user: UserWithUsage): string {
  if (user.hasActiveManagedCampaign) return "Campanha ativa";
  if (user.managedCampaignCheckedAt) return "Sem campanha ativa";
  return "Não verificado";
}

function formatPerformanceStatus(user: UserWithUsage): string {
  if (user.performanceDrop.hasDrop) {
    return user.performanceDrop.highestSeverity === "critical"
      ? "Queda crítica"
      : "Queda 7d";
  }
  if (user.performanceDrop.checkFailed) return "Erro na checagem";
  if (user.performanceDrop.wasChecked) return "Sem queda";
  return "Não verificado";
}

function formatMetaStatus(user: UserWithUsage): string {
  return user.hasMetaBusinessAccount ? "Meta conectado" : "Sem Meta";
}

function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "";
  return formatCalendarDayInSaoPaulo(value);
}

function formatCurrency(value: number): string {
  return value.toFixed(4);
}

export function buildUsersCsv(users: UserWithUsage[]): string {
  const header = CSV_COLUMNS.map((column) => escapeCsvCell(column)).join(",");
  const rows = users.map((user) => {
    const sub = user.activeSubscription;
    const badge = getStatusBadgeProps(
      sub?.status ?? null,
      user.expirationDate,
      sub?.cancelAtPeriodEnd ?? false,
      sub?.currentPeriodEnd ?? null,
    );
    const providerLabel = sub?.provider
      ? (isKnownBillingProvider(sub.provider)
          ? PROVIDER_LABELS[sub.provider]
          : UNCLASSIFIED_FINANCE_PROVIDER_LABEL)
      : "";

    return [
      user.email,
      user.name,
      user.companyName,
      user.onboardingCompleted ? "Integrado" : "Não integrado",
      formatBrazilianPhone(user.phone) ?? user.phone,
      sub ? formatPlanLabel(sub.planType) : "",
      providerLabel,
      badge.hint ? `${badge.label} (${badge.hint})` : badge.label,
      formatDate(user.expirationDate),
      formatCampaignStatus(user),
      formatPerformanceStatus(user),
      formatMetaStatus(user),
      user.metaAccountName,
      user.assignedConsultantName,
      user.assignedConsultantEmail,
      user.postCount,
      user.requestCount,
      user.totalTokens,
      formatCurrency(user.totalCost),
      user.credits,
      formatDate(user.createdAt),
    ]
      .map((value) => escapeCsvCell(value))
      .join(",");
  });

  return `\uFEFF${[header, ...rows].join("\r\n")}`;
}

export function buildUsersExportFilename(total: number): string {
  const date = new Date().toISOString().slice(0, 10);
  return `usuarios-${date}-${total}.csv`;
}
