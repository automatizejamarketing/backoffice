"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  BookOpen,
  Check,
  ChevronsUpDown,
  CircleCheck,
  Copy,
  ImageIcon,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Receipt,
  RefreshCcw,
  ShoppingCart,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import {
  ExpertImageCropDialog,
  ProductCoverCropDialog,
} from "@/components/expert-image-crop-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RecoveryPixPanel } from "./recovery-pix-panel";
import {
  formatBrazilianPhone,
  formatBrazilianPhoneInput,
} from "@/lib/phone";
import {
  getProductOwnerSelectionValue,
  parseProductOwnerSelection,
} from "@/lib/products/owner-selection";
import {
  formatBrlCurrencyFromCentavos,
  formatBrlCurrencyInput,
  parseBrlCurrencyToCentavos,
} from "@/lib/products/currency-input";
import {
  formatPercentageInput,
  formatProductParticipationInput,
  parseOptionalPercentageInput,
  parsePercentageInput,
} from "@/lib/products/percentage-input";
import {
  formatExpertMarketplaceFee,
  formatExpertPlatformFee,
  formatExpertPlatformFeePreview,
} from "@/lib/products/expert-fee-display";
import {
  formatDateInSaoPaulo,
  formatShortDateTimeInSaoPaulo,
} from "@/lib/backoffice/datetime-format";
import { buildProductCheckoutUrl } from "@/lib/products/checkout-url";
import { buildProductAdminUpdatePayload } from "@/lib/products/admin-update-payload";
import { isProductOfferedForSale } from "@/lib/products/sale-gate";
import {
  formatGatewayFeeEstimateLabel,
  resolveProductOrderNetAmounts,
  type FinanceProductPaymentAmountRow,
} from "@/lib/backoffice/finance-payments";
import type { ProductFinancialModel, ProductOwnerType } from "@/lib/db/schema";
import { deriveExpertStripeAccountState } from "@/lib/stripe/connect/state";
import {
  expertCardUnavailableMessage,
  expertStripeAccountStateLabel,
} from "@/lib/stripe/connect/labels";
import type { ExpertStripeAccountState } from "@/lib/stripe/connect/state";
import type { ProductContentType } from "@/lib/db/schema";
import { cn } from "@/lib/utils";
import {
  PRODUCT_COVER_OUTPUT_HEIGHT,
  PRODUCT_COVER_OUTPUT_WIDTH,
} from "@/lib/products/product-cover-spec";

type Expert = {
  id: string;
  displayName: string;
  profileImageUrl: string | null;
  email: string;
  phone: string | null;
  pixKey: string;
  status: "active" | "inactive";
  platformFeeBasisPoints: number;
  platformFeeFixedCentavos: number;
  marketplaceFeeBasisPoints: number;
  stripeAccountId: string | null;
  stripeChargesEnabled: boolean;
  stripePayoutsEnabled: boolean;
  stripeDetailsSubmitted: boolean;
  stripeAccountUpdatedAt: string | null;
};

type MercadoPagoExpertPanel = {
  connected: boolean;
  environment: "sandbox" | "production";
  accountId?: string;
  pix: "available" | "unavailable" | "unknown";
  card: "available" | "unavailable" | "unknown";
  lastValidatedAt: string | null;
  validationError: string | null;
  switch: {
    state: "pending_authorization" | "authorized" | "resolving" | "activated" | "denied";
    nextMpUserId: string | null;
    authorizationReason: string | null;
    authorizedBy: string | null;
  } | null;
};

type Product = {
  id: string;
  ownerType: "automatize" | "expert";
  expertId: string | null;
  slug: string;
  title: string;
  description: string | null;
  coverUrl: string | null;
  priceCentavos: number;
  expertParticipationBps: number | null;
  ownerExpertShareBasisPoints: number;
  coproducerType: "automatize" | "expert" | null;
  coproducerExpertId: string | null;
  coproducerShareBasisPoints: number;
  minimumPlanTier: "starter" | "pro" | "premium" | null;
  visibility: "public" | "unlisted";
  status: "draft" | "published" | "archived";
  salesEnabled: boolean;
  termsVersion: string;
};

type Content = {
  id: string;
  productId: string;
  type: ProductContentType;
  title: string;
  description: string | null;
  sourceUrl: string | null;
  blobPathname: string | null;
  videoProvider: string | null;
  filename: string | null;
  mimeType: string | null;
  position: number;
  published: boolean;
};

type Order = {
  id: string;
  productId: string;
  productTitle: string;
  buyerName: string;
  buyerEmail: string;
  priceCentavos: number;
  status: string;
  createdAt: string;
  approvedAt: string | null;
  provider: string | null;
  providerPaymentId: string | null;
  stripeAccountId: string | null;
  paymentStatus: string | null;
  paymentMethodId: string | null;
  paymentTypeId: string | null;
  grossAmountCentavos: number | null;
  netAmountCentavos: number | null;
  feeAmountCentavos: number | null;
  checkoutChannel: "direct" | "marketplace";
  marketplaceFeeBasisPoints: number;
  platformFeeGrossCentavos: number | null;
  platformFeeBasisPoints: number | null;
  platformFeeFixedCentavos: number | null;
  platformGatewayNetRevenueCentavos: number | null;
  ownerExpertReceivableCentavos: number | null;
  coproducerExpertReceivableCentavos: number | null;
  automatizeCoproductionRevenueCentavos: number | null;
  automatizeProductRevenueCentavos: number | null;
  automatizeTotalNetRevenueCentavos: number | null;
  expertAvailableAt: string | null;
  expertLedgerAmountCentavos: number | null;
  financialModel: ProductFinancialModel | null;
  ownerType: ProductOwnerType;
  ownerExpertShareBasisPoints: number;
  coproducerShareBasisPoints: number;
  coproducerTypeSnapshot: ProductOwnerType | null;
  expertSettlement: "gateway" | "ledger" | null;
  gatewayFeeEstimateBps: number | null;
  gatewayFeeEstimateFixedCentavos: number | null;
  checkoutRootOrderId: string;
  checkoutOrderIds: string[];
  checkoutItems: Array<{
    orderId: string;
    title: string;
    amountCentavos: number;
  }>;
  checkoutTotalCentavos: number;
  checkoutProvider: string | null;
  refundOperationStatus: "issuing" | "confirmed" | "failed" | "external_partial" | null;
  refundOperationAmountCentavos: number | null;
  refundOperationReason: string | null;
  refundOperationOperatorEmail: string | null;
  refundBalanceCaseId: string | null;
  refundBalanceStatus: "pending" | "resolved" | null;
  refundBalanceResponsible: "expert" | "automatize" | null;
  refundBalanceFirstFailedAt: string | null;
  refundBalanceLastFailedAt: string | null;
  refundBalanceDueAt: string | null;
  refundBalanceAttemptCount: number | null;
  refundBalanceNextRetryAt: string | null;
  refundBalanceNoticeSentAt: string | null;
  refundBalanceLastFailureCode: string | null;
  refundBalanceLastFailureMessage: string | null;
};

type Payout = {
  id: string;
  expertName: string;
  amountCentavos: number;
  pixKeySnapshot: string;
  status: string;
  dueAt: string;
  proofUrl: string | null;
};

type Defence = {
  disputeId: string;
  provider: string;
  providerDisputeId: string;
  caseStatus: string;
  openedAt: string;
  defenceId: string | null;
  deadlineAt: string | null;
  originalProviderAccountId: string | null;
  submissionState: "draft" | "unknown" | "submitted" | null;
  reviewedAt: string | null;
  reviewedByEmail: string | null;
  submittedAt: string | null;
  providerResult: string | null;
  expertNote: string | null;
  operatorNote: string | null;
  lastProviderCheckedAt: string | null;
  lastProviderError: string | null;
  productTitle: string;
  files: Array<{
    source: "proposed" | "expert" | "operator";
    fileName: string;
    contentType: string;
    sizeBytes: number;
  }>;
};

type PixFraudCase = {
  id: string;
  orderId: string;
  productTitle: string;
  buyerEmail: string;
  provider: string;
  providerCaseId: string;
  providerPaymentId: string;
  providerAccountId: string | null;
  status: "under_review" | "closed_valid" | "payment_invalidated_by_fraud";
  cause: string | null;
  responsible: "expert" | "automatize";
  recoveredAmountCentavos: number | null;
  financialPending: boolean;
  observedAt: string;
  resolvedAt: string | null;
  responseDueAt: string | null;
  events: Array<{
    providerEventId: string;
    eventType: string;
    occurredAt: string;
  }>;
};

type ReconciliationCase = {
  id: string;
  orderId: string;
  productTitle: string;
  provider: string;
  providerAccountId: string | null;
  kind: string;
  responsible: "operations" | "automatize_finance" | "expert";
  status: "open" | "monitoring" | "resolved";
  attributionProven: boolean;
  effectiveAmountCentavos: number | null;
  evidence: Record<string, string | number | null>;
  nextReviewAt: string;
  createdAt: string;
};

type ProductPaymentAttempt = {
  id: string;
  orderId: string;
  productTitle: string;
  attemptKey: string;
  paymentMethod: "pix" | "card";
  amountCentavos: number;
  providerPaymentId: string | null;
  collectorId: string | null;
  status: "prepared" | "issuing" | "pending" | "unknown";
  failureCode: string | null;
  createdAt: string;
  updatedAt: string;
  lastCheckedAt: string | null;
};

type PostSaleCostCase = {
  id: string;
  productTitle: string;
  paymentId: string;
  provider: string;
  providerAccountId: string | null;
  providerCaseId: string | null;
  reversal: "integral_refund" | "lost_full_chargeback" | "external_partial" | "pix_med";
  status: "open" | "exception" | "settled";
  responsible: "expert" | "automatize";
  evidence: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  movements: Array<{ providerMovementId: string; kind: "cost" | "credit"; amountCentavos: number; supportedBy: "expert" | "automatize"; orderId: string | null }>;
  calculation:
    | { kind: "ready"; items: Array<{ orderId: string; remainingCostCentavos: number; expertResponsibilityCentavos: number; automatizeResponsibilityCentavos: number; expertSupportedCentavos: number; automatizeSupportedCentavos: number }>; transfer: { debtor: "expert" | "automatize"; creditor: "expert" | "automatize"; amountCentavos: number } | null }
    | { kind: "exception"; reason: string };
  settlement: { debtor: "expert" | "automatize"; creditor: "expert" | "automatize"; amountCentavos: number; proofUrl: string; proofKey: string; operatorEmail: string | null; confirmedAt: string | null } | null;
};

type ProductFormState = {
  ownerType: "automatize" | "expert";
  expertId: string;
  title: string;
  slug: string;
  description: string;
  coverUrl: string;
  priceReais: string;
  expertParticipationPercent: string;
  hasCoproduction: boolean;
  coproducerType: "automatize";
  coproducerExpertId: string;
  coproducerSharePercent: string;
  minimumPlanTier: string;
  visibility: "public" | "unlisted";
  status: Product["status"];
  salesEnabled: boolean;
  termsVersion: string;
};

type ExpertFormState = {
  displayName: string;
  profileImageUrl: string | null;
  phone: string;
  pixKey: string;
  platformFeePercent: string;
  platformFeeFixedReais: string;
  marketplaceFeePercent: string;
  status: Expert["status"];
};

const emptyExpert: ExpertFormState = {
  displayName: "",
  profileImageUrl: null,
  phone: "",
  pixKey: "",
  platformFeePercent: "5,49%",
  platformFeeFixedReais: "R$ 0,39",
  marketplaceFeePercent: "3%",
  status: "active",
};

const emptyProduct: ProductFormState = {
  ownerType: "automatize",
  expertId: "",
  title: "",
  slug: "",
  description: "",
  coverUrl: "",
  priceReais: "",
  expertParticipationPercent: "",
  hasCoproduction: false,
  coproducerType: "automatize",
  coproducerExpertId: "",
  coproducerSharePercent: "",
  minimumPlanTier: "",
  visibility: "unlisted" as const,
  status: "draft" as const,
  salesEnabled: true,
  termsVersion: "v1",
};

function orderFinanceRow(order: Order): FinanceProductPaymentAmountRow {
  return {
    grossAmountCentavos: order.grossAmountCentavos,
    netAmountCentavos: order.netAmountCentavos,
    feeAmountCentavos: order.feeAmountCentavos,
    priceCentavos: order.priceCentavos,
    ownerType: order.ownerType,
    financialModel: order.financialModel ?? "legacy_net_split",
    platformFeeBasisPoints: order.platformFeeBasisPoints,
    platformFeeFixedCentavos: order.platformFeeFixedCentavos,
    platformFeeGrossCentavos: order.platformFeeGrossCentavos,
    automatizeCoproductionRevenueCentavos:
      order.automatizeCoproductionRevenueCentavos,
    automatizeProductRevenueCentavos: order.automatizeProductRevenueCentavos,
    automatizeTotalNetRevenueCentavos: order.automatizeTotalNetRevenueCentavos,
    expertShareBasisPoints: order.ownerExpertShareBasisPoints,
    coproducerShareBasisPoints: order.coproducerShareBasisPoints,
    coproducerTypeSnapshot: order.coproducerTypeSnapshot,
    expertSettlement: order.expertSettlement,
    ownerExpertReceivableCentavos: order.ownerExpertReceivableCentavos,
    gatewayFeeEstimateBps: order.gatewayFeeEstimateBps,
    gatewayFeeEstimateFixedCentavos: order.gatewayFeeEstimateFixedCentavos,
    provider: order.provider ?? "mercadopago",
    expertRevenueCentavos:
      order.expertLedgerAmountCentavos !== null &&
      order.expertLedgerAmountCentavos > 0
        ? order.expertLedgerAmountCentavos
        : null,
  };
}

function financialModelLabel(financialModel: ProductFinancialModel | null) {
  return financialModel ?? "legacy_net_split";
}

function paymentReference(order: Order) {
  if (order.provider === "stripe" && order.providerPaymentId) {
    return `Stripe ${order.providerPaymentId}`;
  }
  if (order.provider === "mercadopago" && order.providerPaymentId) {
    return `MP ${order.providerPaymentId}`;
  }
  return order.providerPaymentId ?? "—";
}

function contentSourceLabel(type: Content["type"]) {
  if (type === "video") return "URL / ID do vídeo";
  if (type === "pdf") return "Link do Google Drive";
  if (type === "scheduling") return "Link para agendamento";
  return "URL externa";
}

function contentSourcePlaceholder(type: Content["type"]) {
  if (type === "pdf") return "https://drive.google.com/file/d/.../view";
  if (type === "scheduling") {
    return "https://calendly.com/seu-usuario/consulta";
  }
  return undefined;
}

const emptyContent = {
  type: "video" as Content["type"],
  title: "",
  description: "",
  sourceUrl: "",
  blobPathname: null as string | null,
  videoProvider: "youtube",
  filename: null as string | null,
  mimeType: null as string | null,
  position: "1",
  published: true,
};

const productStatusLabel: Record<Product["status"], string> = {
  draft: "Rascunho",
  published: "Publicado",
  archived: "Arquivado",
};

function getProductStatusBadgeProps(status: Product["status"]) {
  switch (status) {
    case "published":
      return {
        variant: "outline" as const,
        className:
          "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-300",
      };
    case "draft":
      return {
        variant: "outline" as const,
        className:
          "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-300",
      };
    case "archived":
      return {
        variant: "outline" as const,
        className:
          "border-border bg-muted/50 text-muted-foreground dark:bg-muted/30",
      };
  }
}

const orderStatusLabel: Record<string, string> = {
  pending: "Pendente",
  approved: "Aprovado",
  failed: "Falhou",
  refunded: "Reembolsado",
  canceled: "Cancelado",
};

const paymentStatusLabel: Record<string, string> = {
  pending: "Pendente",
  approved: "Aprovado",
  failed: "Falhou",
  refunded: "Reembolsado",
  charged_back: "Chargeback",
};

function money(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value / 100);
}

function dateTime(value: string) {
  return formatShortDateTimeInSaoPaulo(value);
}

function getExpertStripeAccountDisplay(
  expert: Pick<
    Expert,
    "stripeAccountId" | "stripeChargesEnabled" | "stripeAccountUpdatedAt"
  >,
) {
  const state = deriveExpertStripeAccountState({
    stripeAccountId: expert.stripeAccountId,
    stripeChargesEnabled: expert.stripeChargesEnabled,
  });
  return {
    state,
    label: expertStripeAccountStateLabel[state.status],
    updatedAt: expert.stripeAccountUpdatedAt,
  };
}

function getExpertStripeBadgeProps(state: ExpertStripeAccountState["status"]) {
  switch (state) {
    case "enabled":
      return {
        variant: "outline" as const,
        className:
          "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-300",
      };
    case "connected_without_charges":
      return {
        variant: "outline" as const,
        className:
          "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-300",
      };
    case "not_connected":
      return {
        variant: "outline" as const,
        className:
          "border-border bg-muted/50 text-muted-foreground dark:bg-muted/30",
      };
  }
}

function paymentMethod(order: Order) {
  if (
    order.paymentMethodId?.toLowerCase() === "pix" ||
    order.paymentTypeId?.toLowerCase() === "bank_transfer"
  ) {
    return "Pix";
  }
  if (order.paymentTypeId === "credit_card") return "Cartão";
  return order.paymentMethodId ?? "—";
}

function ExpertAvatar({
  name,
  src,
  size = "sm",
}: {
  name: string;
  src: string | null;
  size?: "xs" | "sm" | "lg";
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const sizeClass =
    size === "lg"
      ? "size-20 text-xl"
      : size === "xs"
        ? "size-8 text-xs"
        : "size-10 text-sm";
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  const imageSrc = src && failedSrc !== src ? src : null;

  return (
    <div
      className={`${sizeClass} shrink-0 overflow-hidden rounded-full border bg-muted`}
      aria-label={imageSrc ? undefined : `Sem foto para ${name}`}
    >
      {imageSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageSrc}
          alt={`Foto de ${name}`}
          className="size-full object-cover"
          onError={() => setFailedSrc(imageSrc)}
        />
      ) : (
        <span className="flex size-full items-center justify-center font-semibold text-muted-foreground">
          {initials || "EX"}
        </span>
      )}
    </div>
  );
}

function AutomatizeAvatar() {
  return (
    <div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-white p-1.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo/1.png"
        alt="Logo do Automatize"
        className="size-full object-contain"
      />
    </div>
  );
}

function getProductOwnerTextValue(
  ownerType: "automatize" | "expert",
  expert?: Expert | null,
) {
  if (ownerType === "automatize") return "Automatize";
  if (!expert) return "Selecione o expert";
  return expert.status === "inactive"
    ? `${expert.displayName} (inativo)`
    : expert.displayName;
}

function ProductOwnerTriggerAvatar({
  ownerType,
  expert,
}: {
  ownerType: "automatize" | "expert";
  expert?: Expert | null;
}) {
  if (ownerType === "automatize") {
    return <AutomatizeAvatar />;
  }
  if (!expert) return null;
  return (
    <ExpertAvatar
      name={expert.displayName}
      src={expert.profileImageUrl}
      size="xs"
    />
  );
}

function ProductOwnerPicker({
  ownerType,
  expertId,
  experts,
  onSelect,
}: {
  ownerType: "automatize" | "expert";
  expertId: string;
  experts: Expert[];
  onSelect: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedExpert =
    ownerType === "expert"
      ? experts.find((expert) => expert.id === expertId) ?? null
      : null;
  const selectedValue = getProductOwnerSelectionValue(ownerType, expertId);
  const selectedLabel = getProductOwnerTextValue(ownerType, selectedExpert);

  function pick(value: string) {
    onSelect(value);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-10 w-full justify-between px-3 font-normal"
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <span className="flex min-w-0 items-center gap-2">
            <ProductOwnerTriggerAvatar
              ownerType={ownerType}
              expert={selectedExpert}
            />
            <span className="truncate">{selectedLabel}</span>
          </span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-1"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className="flex flex-col gap-0.5">
          <button
            type="button"
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent",
              selectedValue === "automatize" && "bg-accent",
            )}
            onClick={() => pick("automatize")}
          >
            <AutomatizeAvatar />
            <span className="min-w-0 flex-1 truncate">Automatize</span>
            {selectedValue === "automatize" ? (
              <Check className="size-4 shrink-0 opacity-70" aria-hidden="true" />
            ) : null}
          </button>
          {experts.map((expert) => {
            const value = `expert:${expert.id}`;
            const label = getProductOwnerTextValue("expert", expert);
            return (
              <button
                key={expert.id}
                type="button"
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent",
                  selectedValue === value && "bg-accent",
                )}
                onClick={() => pick(value)}
              >
                <ExpertAvatar
                  name={expert.displayName}
                  src={expert.profileImageUrl}
                  size="xs"
                />
                <span className="min-w-0 flex-1 truncate">{label}</span>
                {selectedValue === value ? (
                  <Check className="size-4 shrink-0 opacity-70" aria-hidden="true" />
                ) : null}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ProductCoverThumbnail({
  title,
  src,
}: {
  title: string;
  src: string | null;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  return (
    <div className="flex h-11 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted text-muted-foreground">
      {src && failedSrc !== src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={`Capa de ${title}`}
          className="size-full object-cover"
          onError={() => setFailedSrc(src)}
        />
      ) : (
        <ImageIcon className="size-4" aria-hidden="true" />
      )}
    </div>
  );
}

async function readError(response: Response) {
  const payload = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  return payload?.error ?? "Operação não concluída.";
}

async function uploadProductAsset(
  file: File,
  input:
    | { kind: "cover"; productId?: never }
    | { kind: "expert-avatar"; productId?: never }
    | { kind: "content"; productId: string },
) {
  const contentType = file.type || "application/octet-stream";
  const prepareResponse = await fetch("/api/products/admin/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...input,
      filename: file.name,
      contentType,
      size: file.size,
    }),
  });
  if (!prepareResponse.ok) throw new Error(await readError(prepareResponse));

  const prepared = (await prepareResponse.json()) as {
    uploadUrl: string;
    objectKey: string;
    assetUrl: string | null;
    headers: Record<string, string>;
  };
  const uploadResponse = await fetch("/api/products/admin/uploads/complete", {
    method: "POST",
    headers: {
      "Content-Type": contentType,
      "X-Object-Key": prepared.objectKey,
      "X-Cache-Control": prepared.headers["cache-control"] ?? "private, no-store",
    },
    body: file,
  });
  if (!uploadResponse.ok) {
    throw new Error(await readError(uploadResponse));
  }
  return prepared;
}

export function ProductsAdminWorkspace({
  frontendAppUrl,
}: {
  frontendAppUrl: string;
}) {
  const [products, setProducts] = useState<Array<{
    product: Product;
    expertName: string | null;
    grossRevenueCentavos: number;
    automatizeNetRevenueCentavos: number;
  }>>([]);
  const [experts, setExperts] = useState<Expert[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [defences, setDefences] = useState<Defence[]>([]);
  const [pixFraudCases, setPixFraudCases] = useState<PixFraudCase[]>([]);
  const [reconciliationCases, setReconciliationCases] = useState<ReconciliationCase[]>([]);
  const [paymentAttempts, setPaymentAttempts] = useState<ProductPaymentAttempt[]>([]);
  const [postSaleCostCases, setPostSaleCostCases] = useState<PostSaleCostCase[]>([]);
  const [content, setContent] = useState<Content[]>([]);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [productForm, setProductForm] = useState(emptyProduct);
  const [contentForm, setContentForm] = useState(emptyContent);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [productDialogOpen, setProductDialogOpen] = useState(false);
  const [contentDialogOpen, setContentDialogOpen] = useState(false);
  const [editingContentId, setEditingContentId] = useState<string | null>(null);
  const [expertPhone, setExpertPhone] = useState("");
  const [editingExpertId, setEditingExpertId] = useState<string | null>(null);
  const [expertDialogOpen, setExpertDialogOpen] = useState(false);
  const [refundTarget, setRefundTarget] = useState<Order | null>(null);
  const [orderDetailTarget, setOrderDetailTarget] = useState<Order | null>(null);
  const [refunding, setRefunding] = useState(false);
  const [releasingBalance, setReleasingBalance] = useState(false);
  const [expertForm, setExpertForm] = useState<ExpertFormState>(emptyExpert);
  const [expertImageFile, setExpertImageFile] = useState<File | null>(null);
  const [expertImagePreviewUrl, setExpertImagePreviewUrl] = useState<string | null>(null);
  const [expertImageInputKey, setExpertImageInputKey] = useState(0);
  const [newExpertImageFile, setNewExpertImageFile] = useState<File | null>(null);
  const [newExpertImagePreviewUrl, setNewExpertImagePreviewUrl] = useState<string | null>(null);
  const [newExpertImageInputKey, setNewExpertImageInputKey] = useState(0);
  const [pendingExpertImageFile, setPendingExpertImageFile] = useState<File | null>(null);
  const [expertImageCropTarget, setExpertImageCropTarget] = useState<"create" | "edit" | null>(null);
  const [expertImageCropOpen, setExpertImageCropOpen] = useState(false);
  const [creatingExpert, setCreatingExpert] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(null);
  const [pendingCoverFile, setPendingCoverFile] = useState<File | null>(null);
  const [coverCropOpen, setCoverCropOpen] = useState(false);
  const [coverInputKey, setCoverInputKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [publishingProductId, setPublishingProductId] = useState<string | null>(null);
  const [enablingSalesProductId, setEnablingSalesProductId] = useState<
    string | null
  >(null);
  const [paymentsDialogProduct, setPaymentsDialogProduct] = useState<Product | null>(
    null,
  );
  const [stripeActionExpertId, setStripeActionExpertId] = useState<string | null>(
    null,
  );
  const [mercadoPagoExpertPanel, setMercadoPagoExpertPanel] =
    useState<MercadoPagoExpertPanel | null>(null);
  const [mercadoPagoActionExpertId, setMercadoPagoActionExpertId] =
    useState<string | null>(null);
  const [mercadoPagoSwitchReason, setMercadoPagoSwitchReason] = useState("");
  const [onboardingLinkUrl, setOnboardingLinkUrl] = useState<string | null>(null);
  const [onboardingLinkDialogOpen, setOnboardingLinkDialogOpen] = useState(false);

  const selectedProduct = useMemo(
    () => products.find((row) => row.product.id === selectedProductId)?.product,
    [products, selectedProductId],
  );
  const expertsById = useMemo(
    () => new Map(experts.map((expert) => [expert.id, expert])),
    [experts],
  );
  const productPayments = useMemo(() => {
    if (!paymentsDialogProduct) return [];
    return orders.filter((order) => order.productId === paymentsDialogProduct.id);
  }, [orders, paymentsDialogProduct]);
  function changeProductOwner(value: string) {
    const owner = parseProductOwnerSelection(value);
    setProductForm((current) => ({
      ...current,
      ...owner,
      hasCoproduction:
        owner.ownerType === "expert" ? current.hasCoproduction : false,
      coproducerType:
        owner.ownerType === "expert" ? current.coproducerType : "automatize",
      coproducerExpertId:
        owner.ownerType === "expert" &&
        current.coproducerExpertId !== owner.expertId
          ? current.coproducerExpertId
          : "",
      coproducerSharePercent:
        owner.ownerType === "expert" ? current.coproducerSharePercent : "",
    }));
  }

  const loadAll = useCallback(async () => {
    setLoading(true);
    setIsLoadingList(true);
    try {
      const [productsResponse, expertsResponse, ordersResponse, payoutsResponse, defencesResponse, pixFraudResponse, reconciliationResponse, postSaleCostsResponse] =
        await Promise.all([
          fetch("/api/products/admin", { cache: "no-store" }),
          fetch("/api/products/admin/experts", { cache: "no-store" }),
          fetch("/api/products/admin/orders", { cache: "no-store" }),
          fetch("/api/products/admin/payouts", { cache: "no-store" }),
          fetch("/api/products/admin/dispute-defences", { cache: "no-store" }),
          fetch("/api/products/admin/pix-fraud", { cache: "no-store" }),
          fetch("/api/products/admin/reconciliation-cases", { cache: "no-store" }),
          fetch("/api/products/admin/post-sale-costs", { cache: "no-store" }),
        ]);
      if (![productsResponse, expertsResponse, ordersResponse, payoutsResponse, defencesResponse, pixFraudResponse, reconciliationResponse, postSaleCostsResponse].every((r) => r.ok)) {
        throw new Error("Não foi possível carregar o módulo.");
      }
      const [nextProducts, nextExperts, nextOrders, nextPayouts, nextDefences, nextPixFraud, nextReconciliation, nextPostSaleCosts] =
        await Promise.all([
          productsResponse.json(),
          expertsResponse.json(),
          ordersResponse.json(),
          payoutsResponse.json(),
          defencesResponse.json(),
          pixFraudResponse.json(),
          reconciliationResponse.json(),
          postSaleCostsResponse.json(),
        ]);
      setProducts(nextProducts);
      setExperts(nextExperts);
      setOrders(nextOrders);
      setPayouts(nextPayouts);
      setDefences(nextDefences.defences ?? []);
      setPixFraudCases(nextPixFraud.cases ?? []);
      setReconciliationCases(nextReconciliation.cases ?? []);
      setPaymentAttempts(nextReconciliation.attempts ?? []);
      setPostSaleCostCases(nextPostSaleCosts.cases ?? []);
      setSelectedProductId(
        (current) => current || nextProducts[0]?.product.id || "",
      );
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setLoading(false);
      setIsLoadingList(false);
    }
  }, []);

  async function refreshDefences() {
    const response = await fetch("/api/products/admin/dispute-defences", { cache: "no-store" });
    if (!response.ok) throw new Error(await readError(response));
    const body = (await response.json()) as { defences?: Defence[] };
    setDefences(body.defences ?? []);
  }

  async function defenceAction(disputeId: string, action: "review" | "submit") {
    const response = await fetch(`/api/products/admin/dispute-defences/${disputeId}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!response.ok) throw new Error(await readError(response));
    const result = (await response.json()) as { state?: string; reason?: string };
    toast.success(action === "review" ? "Defesa revisada." : result.state === "unknown" ? "Envio inconclusivo; o caso exige recuperação." : "Defesa enviada.");
    await refreshDefences();
  }

  async function settlePostSaleCost(caseId: string) {
    const proofUrl = window.prompt("URL do comprovante da transferência manual");
    if (!proofUrl) return;
    const proofKey = window.prompt("Identificador imutável do comprovante");
    if (!proofKey) return;
    const response = await fetch(`/api/products/admin/post-sale-costs/${caseId}/settle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proofUrl, proofKey }),
    });
    if (!response.ok) throw new Error(await readError(response));
    toast.success("Acerto manual confirmado com comprovante.");
    await loadAll();
  }

  async function reconcileProductCase(orderId: string) {
    const response = await fetch(`/api/products/admin/reconciliation-cases/${orderId}/reconcile`, { method: "POST" });
    if (!response.ok) throw new Error(await readError(response));
    toast.success("Conciliação manual executada pela conta original.");
    await loadAll();
  }

  async function resolvePaymentAttempt(attemptId: string) {
    const reason = window.prompt("Motivo do encerramento sem cobrança")?.trim();
    if (!reason) return;
    const providerFact = window.prompt(
      "Fato confirmado pelo Mercado Pago (ex.: busca pela referência sem resultado)",
    )?.trim();
    if (!providerFact) return;
    const response = await fetch(`/api/products/admin/payment-attempts/${attemptId}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reason,
        providerFact: { summary: providerFact, source: "operator_input" },
      }),
    });
    if (!response.ok) throw new Error(await readError(response));
    toast.success("Tentativa encerrada com auditoria.");
    await loadAll();
  }

  async function uploadDefenceFiles(disputeId: string, selectedFiles: FileList | null) {
    if (!selectedFiles?.length) return;
    try {
      for (const file of Array.from(selectedFiles)) {
        const prepare = await fetch(`/api/products/admin/dispute-defences/${disputeId}/files/upload`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: file.name, contentType: file.type, sizeBytes: file.size }),
        });
        if (!prepare.ok) throw new Error(await readError(prepare));
        const prepared = (await prepare.json()) as {
          uploadUrl: string;
          grantId: string;
          objectKey: string;
          headers: Record<string, string>;
        };
        const localUpload = prepared.uploadUrl === "/api/products/admin/uploads/complete";
        const upload = await fetch(prepared.uploadUrl, {
          method: localUpload ? "POST" : "PUT",
          headers: localUpload
            ? { "Content-Type": file.type, "X-Object-Key": prepared.objectKey, "X-Cache-Control": "private, no-store" }
            : prepared.headers,
          body: file,
        });
        if (!upload.ok) throw new Error(await readError(upload));
        const metadata = await fetch(`/api/products/admin/dispute-defences/${disputeId}/files`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source: "operator", grantId: prepared.grantId }),
        });
        if (!metadata.ok) throw new Error(await readError(metadata));
      }
      toast.success("Evidência anexada.");
      await refreshDefences();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível anexar a evidência.");
    }
  }

  async function loadContent(productId: string) {
    if (!productId) return setContent([]);
    const response = await fetch(
      `/api/products/admin/content?productId=${encodeURIComponent(productId)}`,
      { cache: "no-store" },
    );
    if (response.ok) {
      const rows = (await response.json()) as Content[];
      setContent(rows);
      setContentForm((current) => ({
        ...current,
        position: String((rows.at(-1)?.position ?? 0) + 1),
      }));
    }
  }

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    void loadContent(selectedProductId);
  }, [selectedProductId]);

  async function saveProduct(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    try {
      let coverUrl = productForm.coverUrl;
      if (coverFile) {
        const uploadedCover = await uploadProductAsset(coverFile, {
          kind: "cover",
        });
        coverUrl = uploadedCover.assetUrl ?? "";
      }
      const payload = {
        ...productForm,
        coverUrl,
        expertId: productForm.expertId || null,
        priceCentavos: parseBrlCurrencyToCentavos(productForm.priceReais),
        coproducerExpertId: productForm.coproducerExpertId || null,
        coproducerSharePercent: parsePercentageInput(
          productForm.coproducerSharePercent,
        ),
        expertParticipationPercent: parseOptionalPercentageInput(
          productForm.expertParticipationPercent,
        ),
        minimumPlanTier: productForm.minimumPlanTier || null,
      };
      const response = await fetch(
        editingProductId
          ? `/api/products/admin/${editingProductId}`
          : "/api/products/admin",
        {
          method: editingProductId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!response.ok) throw new Error(await readError(response));
      toast.success(editingProductId ? "Produto atualizado." : "Produto criado.");
      closeProductDialog();
      await loadAll();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Não foi possível salvar o produto.",
      );
    } finally {
      setLoading(false);
    }
  }

  function closeProductDialog() {
    setProductDialogOpen(false);
    setEditingProductId(null);
    setProductForm(emptyProduct);
    setCoverFile(null);
    if (coverPreviewUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(coverPreviewUrl);
    }
    setCoverPreviewUrl(null);
    setPendingCoverFile(null);
    setCoverCropOpen(false);
    setCoverInputKey((current) => current + 1);
  }

  function createProduct() {
    setEditingProductId(null);
    setProductForm(emptyProduct);
    setCoverFile(null);
    if (coverPreviewUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(coverPreviewUrl);
    }
    setCoverPreviewUrl(null);
    setCoverInputKey((current) => current + 1);
    setProductDialogOpen(true);
  }

  function editProduct(row: Product) {
    setEditingProductId(row.id);
    setCoverFile(null);
    if (coverPreviewUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(coverPreviewUrl);
    }
    setCoverPreviewUrl(row.coverUrl);
    setCoverInputKey((current) => current + 1);
    setProductForm({
      ownerType: row.ownerType,
      expertId: row.expertId ?? "",
      title: row.title,
      slug: row.slug,
      description: row.description ?? "",
      coverUrl: row.coverUrl ?? "",
      priceReais: formatBrlCurrencyFromCentavos(row.priceCentavos),
      expertParticipationPercent:
        row.expertParticipationBps === null
          ? ""
          : formatProductParticipationInput(
              String(row.expertParticipationBps / 100).replace(".", ","),
            ),
      hasCoproduction: row.coproducerType === "automatize",
      coproducerType: "automatize",
      coproducerExpertId: "",
      coproducerSharePercent:
        row.coproducerType === null
          ? ""
          : formatPercentageInput(
              String(row.coproducerShareBasisPoints / 100).replace(".", ","),
            ),
      minimumPlanTier: row.minimumPlanTier ?? "",
      visibility: row.visibility,
      status: row.status,
      salesEnabled: row.salesEnabled,
      termsVersion: row.termsVersion,
    });
    setProductDialogOpen(true);
  }

  function manageContent(productId: string) {
    setSelectedProductId(productId);
    setEditingContentId(null);
    setContentForm(emptyContent);
    setFile(null);
    setFileInputKey((current) => current + 1);
    setContentDialogOpen(true);
  }

  function closeContentDialog() {
    setContentDialogOpen(false);
    setEditingContentId(null);
    setContentForm(emptyContent);
    setFile(null);
    setFileInputKey((current) => current + 1);
  }

  function changeContentType(type: Content["type"]) {
    setContentForm({ ...contentForm, type });
    if (!["pdf", "file"].includes(type)) {
      setFile(null);
      setFileInputKey((current) => current + 1);
    }
  }

  function changeContentSourceUrl(sourceUrl: string) {
    setContentForm({ ...contentForm, sourceUrl });
    if (sourceUrl) {
      setFile(null);
      setFileInputKey((current) => current + 1);
    }
  }

  function changeContentFile(selectedFile: File | null) {
    setFile(selectedFile);
    if (selectedFile) {
      setContentForm({ ...contentForm, sourceUrl: "" });
    }
  }

  async function archiveProduct(id: string) {
    const response = await fetch(`/api/products/admin/${id}`, { method: "DELETE" });
    if (!response.ok) return toast.error(await readError(response));
    toast.success("Produto arquivado.");
    await loadAll();
  }

  async function copyCheckoutLink(row: Product) {
    if (row.status !== "published") {
      toast.error("Publique o produto antes de copiar o link de checkout.");
      return;
    }

    const url = buildProductCheckoutUrl(frontendAppUrl, row.slug);
    try {
      await navigator.clipboard.writeText(url);
      if (!row.salesEnabled) {
        toast.warning(
          "Link copiado. Vendas desabilitadas — a página abre, mas a compra fica bloqueada.",
        );
      } else {
        toast.success(`Link copiado: ${url}`);
      }
    } catch {
      toast.error("Não foi possível copiar o link de checkout.");
    }
  }

  async function publishProduct(row: Product) {
    setPublishingProductId(row.id);
    try {
      const response = await fetch(`/api/products/admin/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildProductAdminUpdatePayload(row, { status: "published" }),
        ),
      });
      if (!response.ok) return toast.error(await readError(response));
      toast.success("Produto publicado.");
      await loadAll();
    } finally {
      setPublishingProductId(null);
    }
  }

  async function enableProductSales(row: Product) {
    setEnablingSalesProductId(row.id);
    try {
      const response = await fetch(`/api/products/admin/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildProductAdminUpdatePayload(row, { salesEnabled: true }),
        ),
      });
      if (!response.ok) return toast.error(await readError(response));
      toast.success("Aquisição habilitada.");
      await loadAll();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível habilitar a aquisição.",
      );
    } finally {
      setEnablingSalesProductId(null);
    }
  }

  async function saveContent(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedProductId) return;
    setLoading(true);
    let uploaded:
      | { pathname: string; filename: string; mimeType: string }
      | undefined;
    if (file) {
      try {
        const uploadedFile = await uploadProductAsset(file, {
          kind: "content",
          productId: selectedProductId,
        });
        uploaded = {
          pathname: uploadedFile.objectKey,
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
        };
      } catch (error) {
        setLoading(false);
        return toast.error(
          error instanceof Error
            ? error.message
            : "Não foi possível enviar o arquivo.",
        );
      }
    }
    const usesSourceUrl = !uploaded && contentForm.sourceUrl.trim().length > 0;
    const payload = {
      productId: selectedProductId,
      ...contentForm,
      sourceUrl: uploaded ? null : contentForm.sourceUrl || null,
      blobPathname:
        uploaded?.pathname ??
        (usesSourceUrl ? null : contentForm.blobPathname),
      filename:
        uploaded?.filename ?? (usesSourceUrl ? null : contentForm.filename),
      mimeType:
        uploaded?.mimeType ?? (usesSourceUrl ? null : contentForm.mimeType),
      videoProvider: contentForm.type === "video" ? contentForm.videoProvider : null,
      position: Number(contentForm.position),
    };
    const response = await fetch(
      editingContentId
        ? `/api/products/admin/content/${editingContentId}`
        : "/api/products/admin/content",
      {
        method: editingContentId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    setLoading(false);
    if (!response.ok) return toast.error(await readError(response));
    toast.success(editingContentId ? "Conteúdo atualizado." : "Conteúdo adicionado.");
    setEditingContentId(null);
    setContentForm(emptyContent);
    setFile(null);
    await loadContent(selectedProductId);
  }

  function editContent(item: Content) {
    setEditingContentId(item.id);
    setFile(null);
    setContentForm({
      type: item.type,
      title: item.title,
      description: item.description ?? "",
      sourceUrl: item.sourceUrl ?? "",
      blobPathname: item.blobPathname,
      videoProvider: item.videoProvider ?? "youtube",
      filename: item.filename,
      mimeType: item.mimeType,
      position: String(item.position),
      published: item.published,
    });
  }

  async function removeContent(id: string) {
    const response = await fetch(`/api/products/admin/content/${id}`, {
      method: "DELETE",
    });
    if (!response.ok) return toast.error(await readError(response));
    await loadContent(selectedProductId);
  }

  async function createExpert(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setCreatingExpert(true);
    try {
      const payload = Object.fromEntries(form);
      const profileImageUrl =
        newExpertImageFile
          ? (
              await uploadProductAsset(newExpertImageFile, {
                kind: "expert-avatar",
              })
            ).assetUrl
          : null;
      const response = await fetch("/api/products/admin/experts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          platformFeePercent: parsePercentageInput(
            String(payload.platformFeePercent ?? ""),
          ),
          platformFeeFixedCentavos: parseBrlCurrencyToCentavos(
            String(payload.platformFeeFixedReais ?? ""),
          ),
          marketplaceFeePercent: parsePercentageInput(
            String(payload.marketplaceFeePercent ?? ""),
          ),
          platformFeeFixedReais: undefined,
          profileImageUrl,
        }),
      });
      if (!response.ok) return toast.error(await readError(response));
      formElement.reset();
      setExpertPhone("");
      setNewExpertImageFile(null);
      if (newExpertImagePreviewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(newExpertImagePreviewUrl);
      }
      setNewExpertImagePreviewUrl(null);
      setNewExpertImageInputKey((current) => current + 1);
      toast.success("Expert vinculado.");
      await loadAll();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível vincular o expert.",
      );
    } finally {
      setCreatingExpert(false);
    }
  }

  function editExpert(expert: Expert) {
    setEditingExpertId(expert.id);
    setExpertImageFile(null);
    setExpertImagePreviewUrl(expert.profileImageUrl);
    setExpertImageInputKey((current) => current + 1);
    setExpertForm({
      displayName: expert.displayName,
      profileImageUrl: expert.profileImageUrl,
      phone: formatBrazilianPhoneInput(expert.phone),
      pixKey: expert.pixKey,
      platformFeePercent: formatPercentageInput(
        String(expert.platformFeeBasisPoints / 100).replace(".", ","),
      ),
      platformFeeFixedReais: formatBrlCurrencyFromCentavos(
        expert.platformFeeFixedCentavos,
      ),
      marketplaceFeePercent: formatPercentageInput(
        String(expert.marketplaceFeeBasisPoints / 100).replace(".", ","),
      ),
      status: expert.status,
    });
    setMercadoPagoExpertPanel(null);
    setMercadoPagoSwitchReason("");
    void loadMercadoPagoExpertPanel(expert.id);
    setExpertDialogOpen(true);
  }

  function closeExpertDialog() {
    setExpertDialogOpen(false);
    setEditingExpertId(null);
    setExpertForm(emptyExpert);
    setMercadoPagoExpertPanel(null);
    setMercadoPagoSwitchReason("");
    setExpertImageFile(null);
    if (expertImagePreviewUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(expertImagePreviewUrl);
    }
    setExpertImagePreviewUrl(null);
    setExpertImageInputKey((current) => current + 1);
  }

  function selectExpertImage(file: File | null) {
    if (!file) return;
    setPendingExpertImageFile(file);
    setExpertImageCropTarget("edit");
    setExpertImageCropOpen(true);
  }

  function selectNewExpertImage(file: File | null) {
    if (!file) return;
    setPendingExpertImageFile(file);
    setExpertImageCropTarget("create");
    setExpertImageCropOpen(true);
  }

  function cancelExpertImageCrop() {
    setExpertImageCropOpen(false);
    setPendingExpertImageFile(null);
    if (expertImageCropTarget === "create") {
      setNewExpertImageInputKey((current) => current + 1);
    } else if (expertImageCropTarget === "edit") {
      setExpertImageInputKey((current) => current + 1);
    }
    setExpertImageCropTarget(null);
  }

  function applyExpertImageCrop(file: File) {
    const previewUrl = URL.createObjectURL(file);
    if (expertImageCropTarget === "create") {
      if (newExpertImagePreviewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(newExpertImagePreviewUrl);
      }
      setNewExpertImageFile(file);
      setNewExpertImagePreviewUrl(previewUrl);
      setNewExpertImageInputKey((current) => current + 1);
    } else {
      if (expertImagePreviewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(expertImagePreviewUrl);
      }
      setExpertImageFile(file);
      setExpertImagePreviewUrl(previewUrl);
      setExpertImageInputKey((current) => current + 1);
    }
    setExpertImageCropOpen(false);
    setPendingExpertImageFile(null);
    setExpertImageCropTarget(null);
  }

  function removeExpertImage() {
    if (expertImagePreviewUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(expertImagePreviewUrl);
    }
    setExpertImageFile(null);
    setExpertImagePreviewUrl(null);
    setExpertImageInputKey((current) => current + 1);
    setExpertForm((current) => ({ ...current, profileImageUrl: null }));
  }

  function removeNewExpertImage() {
    if (newExpertImagePreviewUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(newExpertImagePreviewUrl);
    }
    setNewExpertImageFile(null);
    setNewExpertImagePreviewUrl(null);
    setNewExpertImageInputKey((current) => current + 1);
  }

  function selectCoverFile(file: File | null) {
    if (!file) return;
    setPendingCoverFile(file);
    setCoverCropOpen(true);
  }

  function cancelCoverCrop() {
    setCoverCropOpen(false);
    setPendingCoverFile(null);
    setCoverInputKey((current) => current + 1);
  }

  function applyCoverCrop(file: File) {
    if (coverPreviewUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(coverPreviewUrl);
    }
    setCoverFile(file);
    setCoverPreviewUrl(URL.createObjectURL(file));
    setCoverInputKey((current) => current + 1);
    setCoverCropOpen(false);
    setPendingCoverFile(null);
  }

  function removeCoverImage() {
    if (coverPreviewUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(coverPreviewUrl);
    }
    setCoverFile(null);
    setCoverPreviewUrl(null);
    setCoverInputKey((current) => current + 1);
    setProductForm((current) => ({ ...current, coverUrl: "" }));
  }

  async function saveExpert(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingExpertId) return;

    setLoading(true);
    try {
      const profileImageUrl = expertImageFile
        ? (
            await uploadProductAsset(expertImageFile, {
              kind: "expert-avatar",
            })
          ).assetUrl
        : expertForm.profileImageUrl;
      const response = await fetch(
        `/api/products/admin/experts/${editingExpertId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            displayName: expertForm.displayName,
            phone: expertForm.phone,
            pixKey: expertForm.pixKey,
            status: expertForm.status,
            platformFeePercent: parsePercentageInput(
              expertForm.platformFeePercent,
            ),
            platformFeeFixedCentavos: parseBrlCurrencyToCentavos(
              expertForm.platformFeeFixedReais,
            ),
            marketplaceFeePercent: parsePercentageInput(
              expertForm.marketplaceFeePercent,
            ),
            profileImageUrl,
          }),
        },
      );
      if (!response.ok) return toast.error(await readError(response));

      toast.success("Expert atualizado.");
      closeExpertDialog();
      await loadAll();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível atualizar o expert.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function copyPixKey(pixKey: string) {
    try {
      await navigator.clipboard.writeText(pixKey);
      toast.success("Chave Pix copiada.");
    } catch {
      toast.error("Não foi possível copiar a chave Pix.");
    }
  }

  async function refreshExpertStripeAccount(expertId: string) {
    setStripeActionExpertId(expertId);
    try {
      const response = await fetch(
        `/api/products/admin/experts/${expertId}/stripe-account/refresh`,
        { method: "POST" },
      );
      if (!response.ok) throw new Error(await readError(response));
      toast.success("Estado da Conta Stripe do Expert atualizado.");
      await loadAll();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível atualizar a Conta Stripe do Expert.",
      );
    } finally {
      setStripeActionExpertId(null);
    }
  }

  async function loadMercadoPagoExpertPanel(expertId: string) {
    try {
      const response = await fetch(
        `/api/products/admin/experts/${expertId}/mercadopago`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error(await readError(response));
      setMercadoPagoExpertPanel(
        (await response.json()) as MercadoPagoExpertPanel,
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível consultar a Conta Mercado Pago do Expert.",
      );
    }
  }

  async function authorizeMercadoPagoReceiverSwitch(expertId: string) {
    setMercadoPagoActionExpertId(expertId);
    try {
      const response = await fetch(
        `/api/products/admin/experts/${expertId}/mercadopago`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reason: mercadoPagoSwitchReason,
            environment: mercadoPagoExpertPanel?.environment,
          }),
        },
      );
      if (!response.ok) throw new Error(await readError(response));
      toast.success("Troca de conta autorizada. O Expert precisa concluir o OAuth.");
      await loadMercadoPagoExpertPanel(expertId);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível autorizar a troca da conta.",
      );
    } finally {
      setMercadoPagoActionExpertId(null);
    }
  }

  async function resendExpertStripeOnboarding(expertId: string) {
    setStripeActionExpertId(expertId);
    try {
      const response = await fetch(
        `/api/products/admin/experts/${expertId}/stripe-account/onboarding-link`,
        { method: "POST" },
      );
      if (!response.ok) throw new Error(await readError(response));
      const payload = (await response.json()) as { onboardingUrl: string };
      setOnboardingLinkUrl(payload.onboardingUrl);
      setOnboardingLinkDialogOpen(true);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível gerar o link de onboarding.",
      );
    } finally {
      setStripeActionExpertId(null);
    }
  }

  async function copyOnboardingLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link de onboarding copiado.");
    } catch {
      toast.error("Não foi possível copiar o link.");
    }
  }

  const editingExpertStripe = editingExpertId
    ? experts.find((expert) => expert.id === editingExpertId) ?? null
    : null;
  const editingExpertStripeDisplay = editingExpertStripe
    ? getExpertStripeAccountDisplay(editingExpertStripe)
    : null;
  const selectedOwnerExpert =
    productForm.ownerType === "expert" && productForm.expertId
      ? expertsById.get(productForm.expertId) ?? null
      : null;
  const selectedOwnerStripeDisplay = selectedOwnerExpert
    ? getExpertStripeAccountDisplay(selectedOwnerExpert)
    : null;

  const isMercadoPagoRefund =
    (refundTarget?.checkoutProvider ?? refundTarget?.provider) === "mercadopago";

  async function confirmRefund() {
    if (!refundTarget) return;
    const reason = window.prompt(
      "Informe o motivo do reembolso integral (obrigatório):",
    );
    if (!reason?.trim()) return;
    const viaMercadoPago = isMercadoPagoRefund;
    setRefunding(true);
    try {
      const response = await fetch(
        `/api/products/admin/orders/${refundTarget.id}/refund`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: reason.trim() }),
        },
      );
      if (!response.ok) return toast.error(await readError(response));
      const body = await response.json().catch(() => null);
      if (body?.status === "processing") {
        toast.info(
          "Reembolso enviado e ainda em confirmação no Mercado Pago. O acesso permanece ativo.",
        );
      } else if (body?.status === "balance_pending") {
        toast.info(
          "O Mercado Pago confirmou falta de saldo. O caso foi registrado para retentativa e nenhum acesso foi alterado.",
        );
      } else {
        toast.success(
          viaMercadoPago
            ? "Reembolso integral confirmado no Mercado Pago. Os acessos da cobrança foram revogados."
            : "Reembolso registrado.",
        );
      }
      setRefundTarget(null);
      await loadAll();
    } finally {
      setRefunding(false);
    }
  }

  async function releaseRefundBalanceCase(order: Order) {
    if (!order.refundBalanceCaseId) return;
    const reason = window.prompt(
      "Informe o motivo da liberação auditada das vendas do Expert:",
    );
    if (!reason?.trim()) return;
    setReleasingBalance(true);
    try {
      const response = await fetch(
        `/api/products/admin/refund-balance/${order.refundBalanceCaseId}/release`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: reason.trim() }),
        },
      );
      if (!response.ok) return toast.error(await readError(response));
      toast.success("Vendas do Expert liberadas e ação registrada no log.");
      await loadAll();
      setOrderDetailTarget(null);
    } finally {
      setReleasingBalance(false);
    }
  }

  async function updatePayout(id: string, status: "approved" | "paid" | "rejected") {
    const proofUrl =
      status === "paid"
        ? window.prompt("URL do comprovante de pagamento:") ?? ""
        : "";
    if (status === "paid" && !proofUrl) return;
    const response = await fetch("/api/products/admin/payouts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status, proofUrl }),
    });
    if (!response.ok) return toast.error(await readError(response));
    toast.success("Solicitação atualizada.");
    await loadAll();
  }

  return (
    <div className="space-y-7">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-primary">Produtos digitais</p>
          <h1 className="text-3xl font-semibold">Produtos e Experts</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Cadastre ofertas, conteúdos, vendas e repasses.
          </p>
        </div>
        <Button variant="outline" onClick={() => void loadAll()} disabled={loading}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCcw className="size-4" />}
          Atualizar
        </Button>
      </header>

      <Tabs defaultValue="products">
        <TabsList className="grid w-full grid-cols-9 lg:w-fit">
          <TabsTrigger value="products">Produtos</TabsTrigger>
          <TabsTrigger value="experts">Experts</TabsTrigger>
          <TabsTrigger value="orders">Vendas</TabsTrigger>
          <TabsTrigger value="recovery">Pix vencido</TabsTrigger>
          <TabsTrigger value="payouts">Repasses</TabsTrigger>
          <TabsTrigger value="defences">Defesas ({defences.length})</TabsTrigger>
          <TabsTrigger value="pix-fraud">Fraude Pix ({pixFraudCases.filter((item) => item.status === "under_review").length})</TabsTrigger>
          <TabsTrigger value="reconciliation">Conciliação ({reconciliationCases.length + paymentAttempts.length})</TabsTrigger>
          <TabsTrigger value="post-sale-costs">Custos pós-venda ({postSaleCostCases.filter((item) => item.status === "open").length})</TabsTrigger>
        </TabsList>

        <TabsContent value="products" className="space-y-6 pt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <CardTitle>Produtos</CardTitle>
              <Button size="sm" onClick={createProduct}>
                <Plus className="size-4" />
                Novo produto
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <Table className="min-w-[1180px]">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Produto</TableHead>
                    <TableHead>Proprietário</TableHead>
                    <TableHead className="text-right">Preço</TableHead>
                    <TableHead className="text-right">Faturamento bruto</TableHead>
                    <TableHead className="text-right">Líquido Automatize</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoadingList ? (
                    <TableRow>
                      <TableCell colSpan={7} className="h-28 text-center">
                        <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  ) : products.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="h-28 text-center text-muted-foreground">
                        Nenhum produto cadastrado.
                      </TableCell>
                    </TableRow>
                  ) : (
                    products.map(({ product: row, expertName, grossRevenueCentavos, automatizeNetRevenueCentavos }) => {
                      const ownerExpert = row.expertId
                        ? expertsById.get(row.expertId)
                        : null;
                      const ownerName = ownerExpert?.displayName ?? expertName ?? "Automatize";
                      const statusBadge = getProductStatusBadgeProps(row.status);
                      const offeredForSale = isProductOfferedForSale(row);

                      return (
                        <TableRow key={row.id}>
                          <TableCell className="max-w-[320px] font-medium">
                            <div className="flex min-w-0 items-center gap-3">
                              <ProductCoverThumbnail
                                title={row.title}
                                src={row.coverUrl}
                              />
                              <span className="min-w-0 truncate" title={row.title}>
                                {row.title}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            <div className="flex items-center gap-2 whitespace-nowrap">
                              {ownerExpert ? (
                                <ExpertAvatar
                                  name={ownerName}
                                  src={ownerExpert.profileImageUrl}
                                  size="xs"
                                />
                              ) : (
                                <AutomatizeAvatar />
                              )}
                              <div className="min-w-0">
                                <span>{ownerName}</span>
                                {ownerExpert ? (
                                  <div className="mt-1 flex flex-wrap items-center gap-1">
                                    {(() => {
                                      const stripeDisplay =
                                        getExpertStripeAccountDisplay(ownerExpert);
                                      const stripeBadge = getExpertStripeBadgeProps(
                                        stripeDisplay.state.status,
                                      );
                                      return (
                                        <>
                                          <Badge
                                            variant={stripeBadge.variant}
                                            className={`${stripeBadge.className} text-[10px]`}
                                          >
                                            {stripeDisplay.label}
                                          </Badge>
                                          {offeredForSale &&
                                          stripeDisplay.state.status !== "enabled" ? (
                                            <span className="text-[10px] text-muted-foreground">
                                              {expertCardUnavailableMessage}
                                            </span>
                                          ) : null}
                                        </>
                                      );
                                    })()}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </TableCell>
                        <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">{money(row.priceCentavos)}</TableCell>
                        <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">{money(grossRevenueCentavos)}</TableCell>
                        <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">{money(automatizeNetRevenueCentavos)}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge variant={statusBadge.variant} className={statusBadge.className}>
                              {productStatusLabel[row.status]}
                            </Badge>
                            {offeredForSale ? (
                              <Badge
                                variant="outline"
                                className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-300"
                              >
                                À venda
                              </Badge>
                            ) : !row.salesEnabled ? (
                              <Badge
                                variant="outline"
                                className="border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-300"
                              >
                                Aquisição desabilitada
                              </Badge>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                type="button"
                                size="icon"
                                variant="outline"
                                className="ml-auto"
                                aria-label={`Ações de ${row.title}`}
                                title="Ações"
                              >
                                <MoreHorizontal className="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-44">
                              {row.status === "draft" ? (
                                <DropdownMenuItem
                                  onSelect={() => void publishProduct(row)}
                                  disabled={publishingProductId === row.id}
                                >
                                  {publishingProductId === row.id ? <Loader2 className="animate-spin" /> : <CircleCheck />}
                                  {publishingProductId === row.id ? "Publicando..." : "Publicar"}
                                </DropdownMenuItem>
                              ) : null}
                              {!row.salesEnabled ? (
                                <DropdownMenuItem
                                  onSelect={() => void enableProductSales(row)}
                                  disabled={enablingSalesProductId === row.id}
                                >
                                  {enablingSalesProductId === row.id ? (
                                    <Loader2 className="animate-spin" />
                                  ) : (
                                    <ShoppingCart />
                                  )}
                                  {enablingSalesProductId === row.id
                                    ? "Habilitando..."
                                    : "Habilitar aquisição"}
                                </DropdownMenuItem>
                              ) : null}
                              <DropdownMenuItem onSelect={() => void copyCheckoutLink(row)}><Copy /> Copiar link de checkout</DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => setPaymentsDialogProduct(row)}><Receipt /> Ver pagamentos</DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => manageContent(row.id)}><BookOpen /> Conteúdos</DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => editProduct(row)}><Pencil /> Editar</DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => void archiveProduct(row.id)}><Archive /> Arquivar</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="experts" className="space-y-6 pt-4">
          <Card>
            <CardHeader><CardTitle>Vincular expert</CardTitle></CardHeader>
            <CardContent>
              <form onSubmit={createExpert} className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
                <Field label="E-mail do usuário"><Input name="email" type="email" required /></Field>
                <Field label="Nome público"><Input name="displayName" required /></Field>
                <Field label="WhatsApp"><Input name="phone" type="tel" inputMode="numeric" autoComplete="tel-national" maxLength={15} placeholder="(11) 99999-9999" value={expertPhone} onChange={(event) => setExpertPhone(formatBrazilianPhoneInput(event.target.value))} /></Field>
                <Field label="Chave Pix"><Input name="pixKey" required /></Field>
                <Field label="Taxa percentual">
                  <Input
                    name="platformFeePercent"
                    inputMode="decimal"
                    defaultValue="5,49%"
                    onChange={(event) => {
                      event.currentTarget.value = formatPercentageInput(event.currentTarget.value);
                    }}
                    required
                  />
                </Field>
                <Field label="Taxa fixa">
                  <Input
                    name="platformFeeFixedReais"
                    inputMode="numeric"
                    defaultValue="R$ 0,39"
                    onChange={(event) => {
                      event.currentTarget.value = formatBrlCurrencyInput(event.currentTarget.value);
                    }}
                    required
                  />
                </Field>
                <Field label="Taxa marketplace">
                  <Input
                    name="marketplaceFeePercent"
                    inputMode="decimal"
                    defaultValue="3%"
                    onChange={(event) => {
                      event.currentTarget.value = formatPercentageInput(event.currentTarget.value);
                    }}
                    required
                  />
                </Field>
                <Field label="Foto de perfil">
                  <Input
                    key={newExpertImageInputKey}
                    type="file"
                    accept="image/avif,image/gif,image/jpeg,image/png,image/webp"
                    onChange={(event) =>
                      selectNewExpertImage(event.target.files?.[0] ?? null)
                    }
                  />
                  {newExpertImagePreviewUrl ? (
                    <div className="flex items-center gap-2 rounded-md border bg-muted/20 p-2">
                      <ExpertAvatar
                        name="Novo expert"
                        src={newExpertImagePreviewUrl}
                        size="xs"
                      />
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                        Foto ajustada · 512 × 512 px
                      </span>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-7 text-destructive hover:text-destructive"
                        aria-label="Remover foto"
                        title="Remover foto"
                        onClick={removeNewExpertImage}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <p className="text-xs leading-5 text-muted-foreground">
                      Opcional · você poderá ajustar o enquadramento.
                    </p>
                  )}
                </Field>
                <div className="md:col-span-2 xl:col-span-6">
                  <Button type="submit" disabled={creatingExpert}>
                    {creatingExpert ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                    {creatingExpert ? "Vinculando..." : "Vincular expert"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Experts</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table className="min-w-[1240px]">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Expert</TableHead>
                    <TableHead className="w-[220px]">Conta Stripe do Expert</TableHead>
                    <TableHead className="w-[170px]">WhatsApp</TableHead>
                    <TableHead className="w-[280px]">Chave Pix</TableHead>
                    <TableHead className="w-[190px]">Taxa da plataforma</TableHead>
                    <TableHead className="w-[100px]">Status</TableHead>
                    <TableHead className="w-[110px] text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {experts.map((expert) => {
                    const stripeDisplay = getExpertStripeAccountDisplay(expert);
                    const stripeBadge = getExpertStripeBadgeProps(
                      stripeDisplay.state.status,
                    );

                    return (
                    <TableRow key={expert.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <ExpertAvatar name={expert.displayName} src={expert.profileImageUrl} />
                          <div className="min-w-0">
                            <p className="truncate font-medium">{expert.displayName}</p>
                            <p className="truncate text-sm text-muted-foreground">{expert.email}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <Badge variant={stripeBadge.variant} className={stripeBadge.className}>
                            {stripeDisplay.label}
                          </Badge>
                          <p className="text-xs text-muted-foreground">
                            {stripeDisplay.updatedAt
                              ? `Atualizado ${dateTime(stripeDisplay.updatedAt)}`
                              : "Sem sincronização"}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {formatBrazilianPhone(expert.phone) ?? "Sem WhatsApp"}
                      </TableCell>
                      <TableCell>
                        <div className="flex min-w-0 items-center gap-1">
                          <span className="truncate font-mono text-sm" title={expert.pixKey}>{expert.pixKey}</span>
                          <Button type="button" size="icon" variant="ghost" className="size-8 shrink-0" title="Copiar chave Pix" aria-label="Copiar chave Pix" onClick={() => void copyPixKey(expert.pixKey)}>
                            <Copy className="size-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-sm tabular-nums">
                        <div>
                          {formatExpertPlatformFee(
                            expert.platformFeeBasisPoints,
                            expert.platformFeeFixedCentavos,
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatExpertMarketplaceFee(
                            expert.marketplaceFeeBasisPoints,
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{expert.status === "active" ? "Ativo" : "Inativo"}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              size="icon"
                              variant="outline"
                              className="ml-auto"
                              aria-label={`Ações de ${expert.displayName}`}
                              title="Ações"
                            >
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56">
                            <DropdownMenuItem onSelect={() => editExpert(expert)}>
                              <Pencil /> Editar
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => void refreshExpertStripeAccount(expert.id)}
                              disabled={stripeActionExpertId === expert.id}
                            >
                              {stripeActionExpertId === expert.id ? (
                                <Loader2 className="animate-spin" />
                              ) : (
                                <RefreshCcw />
                              )}
                              Atualizar estado
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => void resendExpertStripeOnboarding(expert.id)}
                              disabled={stripeActionExpertId === expert.id}
                            >
                              {stripeActionExpertId === expert.id ? (
                                <Loader2 className="animate-spin" />
                              ) : (
                                <Copy />
                              )}
                              Reenviar onboarding
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

      <TabsContent value="orders" className="pt-4">
          <Card>
            <CardHeader>
              <CardTitle>Vendas</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table className="min-w-[1760px]">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Produto</TableHead>
                    <TableHead>Comprador</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead>Pagamento</TableHead>
                    <TableHead className="text-right">Bruto</TableHead>
                    <TableHead className="text-right">Tarifa real</TableHead>
                    <TableHead className="text-right">Líquido</TableHead>
                    <TableHead className="text-right">Parte do Expert</TableHead>
                    <TableHead className="text-right">Coprodução do Automatize</TableHead>
                    <TableHead>Trilho de repasse</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoadingList ? (
                    <TableRow>
                      <TableCell colSpan={12} className="h-28 text-center">
                        <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  ) : orders.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={12}
                        className="h-28 text-center text-muted-foreground"
                      >
                        Nenhuma venda registrada.
                      </TableCell>
                    </TableRow>
                  ) : (
                    orders.map((order) => {
                      const amounts = resolveProductOrderNetAmounts(
                        orderFinanceRow(order),
                      );

                      return (
                      <TableRow key={order.id}>
                        <TableCell className="font-medium">
                          {order.productTitle}
                        </TableCell>
                        <TableCell>
                          <p className="font-medium">{order.buyerName}</p>
                          <p className="text-xs text-muted-foreground">
                            {order.buyerEmail}
                          </p>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {dateTime(order.createdAt)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                          <p>{paymentMethod(order)}</p>
                          <p>{paymentReference(order)}</p>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">
                          {money(amounts.grossCentavos)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">
                          {amounts.feeCentavos !== null
                            ? money(amounts.feeCentavos)
                            : "—"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">
                          {money(amounts.netCentavos)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">
                          {money(amounts.expertRevenueCentavos)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">
                          {amounts.automatizeRevenueCentavos !== null
                            ? money(amounts.automatizeRevenueCentavos)
                            : "—"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {amounts.expertSettlementLabel ? (
                            <Badge variant="outline">
                              {amounts.expertSettlementLabel}
                            </Badge>
                          ) : order.expertAvailableAt ? (
                            <span className="text-xs text-muted-foreground">
                              {paymentMethod(order) === "Pix"
                                ? "Repasse Manual"
                                : dateTime(order.expertAvailableAt)}
                            </span>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {orderStatusLabel[order.status] ?? order.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                type="button"
                                size="icon"
                                variant="outline"
                                className="ml-auto"
                                aria-label={`Ações da venda de ${order.productTitle}`}
                                title="Ações"
                              >
                                <MoreHorizontal className="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-44">
                              <DropdownMenuItem
                                onSelect={() => setOrderDetailTarget(order)}
                              >
                                Ver detalhes
                              </DropdownMenuItem>
                              {order.status === "approved" ? (
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onSelect={() => setRefundTarget(order)}
                                >
                                  Reembolsar
                                </DropdownMenuItem>
                              ) : null}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
      </TabsContent>

      <TabsContent value="defences" className="pt-4">
        <Card>
          <CardHeader>
            <CardTitle>Defesas de contestação</CardTitle>
            <p className="text-sm text-muted-foreground">
              Preparação e envio são ações explícitas. Um timeout fica como inconclusivo até a recuperação consultar o Mercado Pago.
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <Table className="min-w-[1180px]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Produto / caso</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Prazo</TableHead>
                  <TableHead>Arquivos</TableHead>
                  <TableHead>Auditoria</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {defences.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">Nenhuma contestação registrada.</TableCell></TableRow>
                ) : defences.map((defence) => (
                  <TableRow key={defence.disputeId}>
                    <TableCell>
                      <p className="font-medium">{defence.productTitle}</p>
                      <p className="font-mono text-xs text-muted-foreground">{defence.provider} · {defence.providerDisputeId}</p>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <Badge variant="outline">caso: {defence.caseStatus}</Badge>
                        <Badge variant={defence.submissionState === "submitted" ? "default" : "secondary"}>
                          defesa: {defence.submissionState ?? "sem caso"}
                        </Badge>
                      </div>
                      {defence.providerResult ? <p className="mt-1 text-xs text-muted-foreground">{defence.providerResult}</p> : null}
                    </TableCell>
                    <TableCell className={defence.deadlineAt && new Date(defence.deadlineAt) <= new Date() ? "text-destructive" : ""}>
                      {defence.deadlineAt ? dateTime(defence.deadlineAt) : "Sem prazo"}
                    </TableCell>
                    <TableCell>
                      <p>{defence.files.length}/10</p>
                      <p className="max-w-[220px] truncate text-xs text-muted-foreground">{defence.files.map((file) => file.fileName).join(", ") || "Nenhum arquivo"}</p>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <p>{defence.reviewedAt ? `Revisada ${dateTime(defence.reviewedAt)}` : "Aguardando revisão"}</p>
                      {defence.reviewedByEmail ? <p>por {defence.reviewedByEmail}</p> : null}
                      {defence.submittedAt ? <p>Enviada {dateTime(defence.submittedAt)}</p> : null}
                      {defence.lastProviderError ? <p className="text-destructive">{defence.lastProviderError}</p> : null}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-wrap justify-end gap-2">
                        {defence.defenceId ? (
                          <>
                            <label className="inline-flex cursor-pointer items-center rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted">
                              <Upload className="mr-1 size-3" /> Anexar
                              <input type="file" accept="application/pdf,image/jpeg,image/png" multiple className="sr-only" onChange={(event) => { void uploadDefenceFiles(defence.disputeId, event.currentTarget.files); event.currentTarget.value = ""; }} />
                            </label>
                            <Button size="sm" variant="outline" disabled={defence.submissionState === "submitted"} onClick={() => { void defenceAction(defence.disputeId, "review").catch((error) => toast.error(error instanceof Error ? error.message : "Não foi possível revisar.")); }}>Revisar</Button>
                            <Button size="sm" disabled={defence.submissionState === "submitted"} onClick={() => { void defenceAction(defence.disputeId, "submit").catch((error) => toast.error(error instanceof Error ? error.message : "Não foi possível enviar.")); }}>Enviar</Button>
                          </>
                        ) : <span className="text-xs text-muted-foreground">Caso antigo sem rascunho</span>}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="pix-fraud" className="pt-4">
        <Card>
          <CardHeader>
            <CardTitle>Fraude Pix / MED</CardTitle>
            <p className="text-sm text-muted-foreground">
              Fatos confirmados pelo Mercado Pago. Esta fila acompanha acesso, prazo e recuperação efetiva; não transforma o caso em refund nem atribui autoria por inferência.
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <Table className="min-w-[1220px]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Produto / comprador</TableHead>
                  <TableHead>Caso / pagamento</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Prazo</TableHead>
                  <TableHead>Responsável</TableHead>
                  <TableHead className="text-right">Recuperado</TableHead>
                  <TableHead>Fatos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pixFraudCases.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">Nenhuma ocorrência de fraude Pix registrada.</TableCell></TableRow>
                ) : pixFraudCases.map((fraudCase) => (
                  <TableRow key={fraudCase.id}>
                    <TableCell>
                      <p className="font-medium">{fraudCase.productTitle}</p>
                      <p className="text-xs text-muted-foreground">{fraudCase.buyerEmail}</p>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      <p>{fraudCase.providerCaseId}</p>
                      <p>{fraudCase.providerPaymentId}</p>
                      <p>{fraudCase.providerAccountId ? `conta ${fraudCase.providerAccountId}` : "conta não informada"}</p>
                    </TableCell>
                    <TableCell>
                      <Badge variant={fraudCase.status === "payment_invalidated_by_fraud" ? "destructive" : fraudCase.status === "closed_valid" ? "secondary" : "outline"}>
                        {fraudCase.status === "under_review" ? "Em análise · acesso suspenso" : fraudCase.status === "closed_valid" ? "Encerrada · compra válida" : "Pagamento invalidado por fraude"}
                      </Badge>
                      <p className="mt-1 text-xs text-muted-foreground">{fraudCase.cause ?? "Causa não informada"}{fraudCase.financialPending ? " · pendência financeira" : ""}</p>
                    </TableCell>
                    <TableCell className={fraudCase.responseDueAt && new Date(fraudCase.responseDueAt) <= new Date() ? "text-destructive" : ""}>
                      {fraudCase.responseDueAt ? dateTime(fraudCase.responseDueAt) : "Sem prazo"}
                    </TableCell>
                    <TableCell>{fraudCase.responsible === "expert" ? "Expert" : "Equipe Automatize"}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {fraudCase.recoveredAmountCentavos === null ? "Não informado" : money(fraudCase.recoveredAmountCentavos)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <p>{fraudCase.events.length} evento(s)</p>
                      {fraudCase.events[0] ? <p>{fraudCase.events[0].eventType} · {dateTime(fraudCase.events[0].occurredAt)}</p> : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="reconciliation" className="pt-4">
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Tentativas de cobrança inconclusivas</CardTitle>
            <p className="text-sm text-muted-foreground">
              Tentativas sem fato terminal ficam bloqueadas contra uma nova cobrança. Com ID do provedor, concilie; sem ID, encerre somente após registrar o fato confirmado pelo Mercado Pago.
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <Table className="min-w-[1050px]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Produto / pedido</TableHead>
                  <TableHead>Método / estado</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Provedor</TableHead>
                  <TableHead>Atualizada</TableHead>
                  <TableHead className="text-right">Ação explícita</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paymentAttempts.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Nenhuma tentativa inconclusiva.</TableCell></TableRow>
                ) : paymentAttempts.map((attempt) => (
                  <TableRow key={attempt.id}>
                    <TableCell><p className="font-medium">{attempt.productTitle}</p><p className="font-mono text-xs text-muted-foreground">{attempt.orderId}</p><p className="font-mono text-[10px] text-muted-foreground">{attempt.attemptKey}</p></TableCell>
                    <TableCell><Badge variant={attempt.status === "unknown" ? "destructive" : "outline"}>{attempt.paymentMethod} · {attempt.status}</Badge><p className="mt-1 text-xs text-muted-foreground">{attempt.failureCode ?? "sem erro terminal"}</p></TableCell>
                    <TableCell className="tabular-nums">{money(attempt.amountCentavos)}</TableCell>
                    <TableCell className="font-mono text-xs">{attempt.providerPaymentId ?? "sem ID"}{attempt.collectorId ? <p>conta {attempt.collectorId}</p> : null}</TableCell>
                    <TableCell>{dateTime(attempt.updatedAt)}</TableCell>
                    <TableCell className="text-right">
                      {attempt.providerPaymentId ? (
                        <Button size="sm" variant="outline" onClick={() => { void reconcileProductCase(attempt.orderId).catch((error) => toast.error(error instanceof Error ? error.message : "Não foi possível conciliar.")); }}>Conciliar agora</Button>
                      ) : (
                        <Button size="sm" variant="destructive" onClick={() => { void resolvePaymentAttempt(attempt.id).catch((error) => toast.error(error instanceof Error ? error.message : "Não foi possível encerrar.")); }}>Encerrar sem cobrança</Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Fila de conciliação</CardTitle>
            <p className="text-sm text-muted-foreground">
              A fila preserva a conta original, evidência, responsável e próxima revisão. A ação de conciliação consulta o provedor pela credencial histórica e nunca emite uma nova cobrança.
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <Table className="min-w-[1160px]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Produto / pedido</TableHead>
                  <TableHead>Estado / responsável</TableHead>
                  <TableHead>Conta original</TableHead>
                  <TableHead>Valor efetivo</TableHead>
                  <TableHead>Evidência</TableHead>
                  <TableHead>Próxima revisão</TableHead>
                  <TableHead className="text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reconciliationCases.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">Nenhuma exceção de conciliação pendente.</TableCell></TableRow>
                ) : reconciliationCases.map((reconciliationCase) => (
                  <TableRow key={reconciliationCase.id}>
                    <TableCell><p className="font-medium">{reconciliationCase.productTitle}</p><p className="font-mono text-xs text-muted-foreground">{reconciliationCase.kind} · {reconciliationCase.orderId}</p></TableCell>
                    <TableCell><Badge variant={reconciliationCase.status === "open" ? "destructive" : "outline"}>{reconciliationCase.status}</Badge><p className="mt-1 text-xs text-muted-foreground">{reconciliationCase.responsible} · atribuição {reconciliationCase.attributionProven ? "comprovada" : "pendente"}</p></TableCell>
                    <TableCell className="font-mono text-xs">{reconciliationCase.provider} · {reconciliationCase.providerAccountId ?? "não informada"}</TableCell>
                    <TableCell className="tabular-nums">{reconciliationCase.effectiveAmountCentavos === null ? "Não informado" : money(reconciliationCase.effectiveAmountCentavos)}</TableCell>
                    <TableCell className="max-w-[250px] text-xs text-muted-foreground"><p>{Object.keys(reconciliationCase.evidence).length} campo(s)</p><p className="truncate">{Object.entries(reconciliationCase.evidence).map(([key, value]) => `${key}: ${String(value)}`).join(" · ")}</p></TableCell>
                    <TableCell>{dateTime(reconciliationCase.nextReviewAt)}</TableCell>
                    <TableCell className="text-right"><Button size="sm" variant="outline" onClick={() => { void reconcileProductCase(reconciliationCase.orderId).catch((error) => toast.error(error instanceof Error ? error.message : "Não foi possível conciliar.")); }}>Conciliar agora</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="post-sale-costs" className="pt-4">
        <Card>
          <CardHeader>
            <CardTitle>Custos pós-venda e acertos</CardTitle>
            <p className="text-sm text-muted-foreground">
              Só fatos confirmados de reembolso integral ou chargeback integral perdido geram cálculo liquidável. Parcial e MED permanecem exceções acompanhadas; confirmar aqui apenas uma transferência manual já executada e comprovada.
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <Table className="min-w-[1320px]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Produto / caso</TableHead>
                  <TableHead>Estado / responsável</TableHead>
                  <TableHead>Movimentos</TableHead>
                  <TableHead>Apuração</TableHead>
                  <TableHead>Evidência</TableHead>
                  <TableHead>Comprovante</TableHead>
                  <TableHead className="text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {postSaleCostCases.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">Nenhum custo pós-venda registrado.</TableCell></TableRow>
                ) : postSaleCostCases.map((costCase) => (
                  <TableRow key={costCase.id}>
                    <TableCell>
                      <p className="font-medium">{costCase.productTitle}</p>
                      <p className="font-mono text-xs text-muted-foreground">{costCase.reversal} · {costCase.providerCaseId ?? costCase.paymentId}</p>
                      <p className="text-xs text-muted-foreground">conta: {costCase.providerAccountId ?? "não informada"}</p>
                    </TableCell>
                    <TableCell>
                      <Badge variant={costCase.status === "exception" ? "destructive" : costCase.status === "settled" ? "secondary" : "outline"}>{costCase.status}</Badge>
                      <p className="mt-1 text-xs text-muted-foreground">Responsável: {costCase.responsible === "expert" ? "Expert" : "Automatize"}</p>
                    </TableCell>
                    <TableCell className="text-xs">
                      <p>{costCase.movements.length} fato(s)</p>
                      {costCase.movements.map((movement) => <p key={movement.providerMovementId} className="text-muted-foreground">{movement.kind} {money(movement.amountCentavos)} · {movement.supportedBy}</p>)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {costCase.calculation.kind === "exception" ? <Badge variant="destructive">Exceção: {costCase.calculation.reason}</Badge> : costCase.calculation.transfer ? <><p>Transferir {costCase.calculation.transfer.amountCentavos > 0 ? money(costCase.calculation.transfer.amountCentavos) : "R$ 0,00"}</p><p className="text-muted-foreground">{costCase.calculation.transfer.debtor} → {costCase.calculation.transfer.creditor}</p></> : <p>Saldo correto · sem transferência</p>}
                      {costCase.calculation.kind === "ready" ? <p className="mt-1 text-muted-foreground">{costCase.calculation.items.length} item(ns), cálculo acumulado</p> : null}
                    </TableCell>
                    <TableCell className="max-w-[190px] text-xs text-muted-foreground">
                      <p>{Object.keys(costCase.evidence).length} campo(s) preservado(s)</p>
                      <p className="truncate">{Object.keys(costCase.evidence).join(", ") || "Sem evidência"}</p>
                    </TableCell>
                    <TableCell className="text-xs">
                      {costCase.settlement ? <><a className="text-primary underline" href={costCase.settlement.proofUrl} target="_blank" rel="noreferrer">Abrir comprovante</a><p className="text-muted-foreground">{costCase.settlement.operatorEmail ?? "Operador registrado"}</p></> : "Não confirmado"}
                    </TableCell>
                    <TableCell className="text-right">
                      {costCase.status === "open" && costCase.calculation.kind === "ready" && costCase.calculation.transfer ? <Button size="sm" onClick={() => { void settlePostSaleCost(costCase.id).catch((error) => toast.error(error instanceof Error ? error.message : "Não foi possível confirmar o acerto.")); }}>Confirmar acerto</Button> : <span className="text-xs text-muted-foreground">Sem ação</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="payouts" className="pt-4">
          <Card>
            <CardHeader>
              <CardTitle>Repasses</CardTitle>
            </CardHeader>
            <CardContent className="divide-y p-0">
              {payouts.map((payout) => (
                <div
                  key={payout.id}
                  className="grid gap-3 px-5 py-4 lg:grid-cols-[1fr_auto_auto] lg:items-center"
                >
                  <div>
                    <p className="font-medium">
                      {payout.expertName} · {money(payout.amountCentavos)}
                    </p>
                    <p className="font-mono text-xs text-muted-foreground">
                      Pix: {payout.pixKeySnapshot}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Prazo: {formatDateInSaoPaulo(payout.dueAt)}
                    </p>
                  </div>
                  <Badge variant="outline">{payout.status}</Badge>
                  {payout.status === "requested" || payout.status === "approved" ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          className="ml-auto"
                          aria-label={`Ações do repasse de ${payout.expertName}`}
                          title="Ações"
                        >
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        {payout.status === "requested" ? (
                          <>
                            <DropdownMenuItem onSelect={() => void updatePayout(payout.id, "approved")}>
                              Aprovar
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onSelect={() => void updatePayout(payout.id, "rejected")}
                            >
                              Rejeitar
                            </DropdownMenuItem>
                          </>
                        ) : null}
                        {payout.status === "approved" ? (
                          <DropdownMenuItem onSelect={() => void updatePayout(payout.id, "paid")}>
                            Registrar pagamento
                          </DropdownMenuItem>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Painel próprio: ele busca a própria fila e se recarrega depois de cada
            geração, então não entra no `Promise.all` de carga deste workspace. */}
        <TabsContent value="recovery" className="pt-4">
          <RecoveryPixPanel />
        </TabsContent>
      </Tabs>

      <Dialog
        open={productDialogOpen}
        onOpenChange={(open) => {
          if (!open) closeProductDialog();
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editingProductId ? "Editar produto" : "Novo produto"}</DialogTitle>
            <DialogDescription>
              {editingProductId
                ? "Atualize os dados comerciais e de acesso deste produto."
                : "Cadastre os dados comerciais e defina quem terá acesso ao produto."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={saveProduct} className="grid gap-4 md:grid-cols-2">
            <Field label="Título"><Input value={productForm.title} onChange={(e) => setProductForm({ ...productForm, title: e.target.value })} required /></Field>
            <Field label="Slug"><Input value={productForm.slug} onChange={(e) => setProductForm({ ...productForm, slug: e.target.value })} placeholder="gerado pelo título" /></Field>
            <Field label="Preço (R$)"><Input inputMode="numeric" maxLength={18} placeholder="R$ 0,00" value={productForm.priceReais} onChange={(e) => setProductForm({ ...productForm, priceReais: formatBrlCurrencyInput(e.target.value) })} required /></Field>
            <Field label="Proprietário">
              <ProductOwnerPicker
                ownerType={productForm.ownerType}
                expertId={productForm.expertId}
                experts={experts}
                onSelect={changeProductOwner}
              />
            </Field>
            <Field label="Incluído a partir do plano">
              <Select
                value={productForm.minimumPlanTier || "none"}
                onValueChange={(minimumPlanTier) =>
                  setProductForm({
                    ...productForm,
                    minimumPlanTier: minimumPlanTier === "none" ? "" : minimumPlanTier,
                  })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="none">Não incluir</SelectItem>
                    <SelectItem value="starter">Starter</SelectItem>
                    <SelectItem value="pro">Pro</SelectItem>
                    <SelectItem value="premium">Premium</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Visibilidade">
              <Select
                value={productForm.visibility}
                onValueChange={(visibility) =>
                  setProductForm({
                    ...productForm,
                    visibility: visibility as Product["visibility"],
                  })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="unlisted">Não listado</SelectItem>
                    <SelectItem value="public">Público</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Status">
              <Select
                value={productForm.status}
                onValueChange={(status) =>
                  setProductForm({ ...productForm, status: status as Product["status"] })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="draft">Rascunho</SelectItem>
                    <SelectItem value="published">Publicado</SelectItem>
                    <SelectItem value="archived">Arquivado</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Imagem de capa">
              <Input
                key={coverInputKey}
                type="file"
                accept="image/avif,image/gif,image/jpeg,image/png,image/webp"
                onChange={(event) => selectCoverFile(event.target.files?.[0] ?? null)}
              />
              {coverPreviewUrl ? (
                <div className="flex items-center gap-2 rounded-md border bg-muted/20 p-2">
                  <div className="aspect-[16/9] w-36 shrink-0 overflow-hidden rounded-md border">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={coverPreviewUrl}
                      alt="Prévia da capa do produto"
                      className="size-full object-cover"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted-foreground">
                      Capa ajustada em 16:9 · {PRODUCT_COVER_OUTPUT_WIDTH} × {PRODUCT_COVER_OUTPUT_HEIGHT} px
                    </p>
                    {coverFile ? (
                      <p className="truncate text-xs font-medium">{coverFile.name}</p>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-7 shrink-0 text-destructive hover:text-destructive"
                    aria-label="Remover capa"
                    title="Remover capa"
                    onClick={removeCoverImage}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  JPG, PNG, WebP, GIF ou AVIF de até 10 MB. A capa será recortada em 16:9 para o checkout e a biblioteca.
                </p>
              )}
            </Field>
            <Field label="Descrição" className="md:col-span-2"><Input value={productForm.description} onChange={(e) => setProductForm({ ...productForm, description: e.target.value })} /></Field>
            {productForm.ownerType === "expert" ? (
              <>
                <div className="space-y-3 rounded-lg border bg-muted/20 p-4 md:col-span-2">
                  <Field label="Participação do Automatize (%)">
                    <Input
                      inputMode="decimal"
                      value={productForm.expertParticipationPercent}
                      onChange={(event) =>
                        setProductForm({
                          ...productForm,
                          expertParticipationPercent:
                            formatProductParticipationInput(event.target.value),
                        })
                      }
                      placeholder="0% a 99,99%"
                      aria-describedby="expert-participation-help"
                    />
                  </Field>
                  <p
                    id="expert-participation-help"
                    className="text-xs leading-5 text-muted-foreground"
                  >
                    Acordo explícito por produto. Rascunhos podem ficar sem valor;
                    publicar e habilitar vendas exige de 0% a 99,99%. O Expert
                    recebe o percentual complementar.
                  </p>
                  <p className="text-xs leading-5 text-muted-foreground">
                    A conta Mercado Pago elegível continua obrigatória, inclusive
                    quando a participação do Automatize é 0%.
                  </p>
                </div>
                {selectedOwnerStripeDisplay &&
                selectedOwnerStripeDisplay.state.status !== "enabled" ? (
                  <p className="text-xs text-muted-foreground md:col-span-2">
                    {expertCardUnavailableMessage}
                    {selectedOwnerStripeDisplay.updatedAt
                      ? ` Última sincronização: ${dateTime(selectedOwnerStripeDisplay.updatedAt)}.`
                      : ""}
                  </p>
                ) : null}
              </>
            ) : null}
            <label className="flex items-center gap-3 text-sm md:col-span-2"><input type="checkbox" checked={productForm.salesEnabled} onChange={(event) => setProductForm({ ...productForm, salesEnabled: event.target.checked })} /> Disponível para aquisição</label>
            <DialogFooter className="md:col-span-2">
              <Button type="button" variant="outline" onClick={closeProductDialog}>Cancelar</Button>
              <Button type="submit" disabled={loading}>
                {loading ? <Loader2 className="size-4 animate-spin" /> : editingProductId ? <Check className="size-4" /> : <Plus className="size-4" />}
                {loading ? "Salvando..." : editingProductId ? "Salvar alterações" : "Criar produto"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ExpertImageCropDialog
        file={pendingExpertImageFile}
        open={expertImageCropOpen}
        onCancel={cancelExpertImageCrop}
        onConfirm={applyExpertImageCrop}
      />

      <ProductCoverCropDialog
        file={pendingCoverFile}
        open={coverCropOpen}
        onCancel={cancelCoverCrop}
        onConfirm={applyCoverCrop}
      />

      <Dialog
        open={expertDialogOpen}
        onOpenChange={(open) => {
          if (!open) closeExpertDialog();
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Editar expert</DialogTitle>
            <DialogDescription>
              Atualize os dados de contato, recebimento e disponibilidade.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={saveExpert} className="grid gap-4">
            <div className="flex items-center gap-4 rounded-lg border p-4">
              <ExpertAvatar
                name={expertForm.displayName || "Expert"}
                src={expertImagePreviewUrl}
                size="lg"
              />
              <div className="min-w-0 flex-1 space-y-2">
                <Label htmlFor="expert-profile-image">Foto de perfil</Label>
                <Input
                  key={expertImageInputKey}
                  id="expert-profile-image"
                  type="file"
                  accept="image/avif,image/gif,image/jpeg,image/png,image/webp"
                  onChange={(event) => selectExpertImage(event.target.files?.[0] ?? null)}
                />
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    Selecione uma imagem para ajustar o enquadramento.
                  </p>
                  {expertImagePreviewUrl ? (
                    <Button type="button" size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={removeExpertImage}>
                      <Trash2 className="size-3.5" /> Remover foto
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
            <Field label="Nome público">
              <Input value={expertForm.displayName} onChange={(event) => setExpertForm({ ...expertForm, displayName: event.target.value })} required />
            </Field>
            <Field label="WhatsApp">
              <Input type="tel" inputMode="numeric" autoComplete="tel-national" maxLength={15} placeholder="(11) 99999-9999" value={expertForm.phone} onChange={(event) => setExpertForm({ ...expertForm, phone: formatBrazilianPhoneInput(event.target.value) })} />
            </Field>
            <Field label="Chave Pix">
              <Input value={expertForm.pixKey} onChange={(event) => setExpertForm({ ...expertForm, pixKey: event.target.value })} required />
            </Field>
            {editingExpertStripeDisplay ? (
              <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">Conta Stripe do Expert</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      Estado espelhado da Stripe. Cartão no checkout exige conta habilitada.
                    </p>
                  </div>
                  <Badge
                    variant={
                      getExpertStripeBadgeProps(editingExpertStripeDisplay.state.status)
                        .variant
                    }
                    className={
                      getExpertStripeBadgeProps(editingExpertStripeDisplay.state.status)
                        .className
                    }
                  >
                    {editingExpertStripeDisplay.label}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {editingExpertStripeDisplay.updatedAt
                    ? `Última sincronização: ${dateTime(editingExpertStripeDisplay.updatedAt)}`
                    : "Sem sincronização registrada"}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!editingExpertId || stripeActionExpertId === editingExpertId}
                    onClick={() =>
                      editingExpertId
                        ? void refreshExpertStripeAccount(editingExpertId)
                        : undefined
                    }
                  >
                    {stripeActionExpertId === editingExpertId ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <RefreshCcw className="size-4" />
                    )}
                    Atualizar estado
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!editingExpertId || stripeActionExpertId === editingExpertId}
                    onClick={() =>
                      editingExpertId
                        ? void resendExpertStripeOnboarding(editingExpertId)
                        : undefined
                    }
                  >
                    {stripeActionExpertId === editingExpertId ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Copy className="size-4" />
                    )}
                    Reenviar onboarding
                  </Button>
                </div>
              </div>
            ) : null}
            {editingExpertId ? (
              <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">Conta Mercado Pago do Expert</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      Consulta sanitizada por ambiente. A equipe autoriza a troca;
                      somente o Expert conclui o OAuth.
                    </p>
                  </div>
                  {mercadoPagoExpertPanel ? (
                    <Badge variant={mercadoPagoExpertPanel.connected ? "default" : "secondary"}>
                      {mercadoPagoExpertPanel.connected ? "Conectada" : "Reconexão necessária"}
                    </Badge>
                  ) : null}
                </div>
                {mercadoPagoExpertPanel ? (
                  <>
                    <div className="flex flex-wrap gap-2 text-xs">
                      <Badge variant="outline">Ambiente: {mercadoPagoExpertPanel.environment}</Badge>
                      <Badge variant={mercadoPagoExpertPanel.pix === "available" ? "default" : "secondary"}>
                        Pix: {mercadoPagoExpertPanel.pix}
                      </Badge>
                      <Badge variant={mercadoPagoExpertPanel.card === "available" ? "default" : "secondary"}>
                        Cartão: {mercadoPagoExpertPanel.card}
                      </Badge>
                      {mercadoPagoExpertPanel.accountId ? (
                        <Badge variant="outline">Conta: {mercadoPagoExpertPanel.accountId}</Badge>
                      ) : null}
                    </div>
                    {mercadoPagoExpertPanel.validationError ? (
                      <p className="text-xs text-destructive">
                        Validação: {mercadoPagoExpertPanel.validationError}
                      </p>
                    ) : null}
                    {mercadoPagoExpertPanel.switch &&
                    mercadoPagoExpertPanel.switch.state !== "activated" ? (
                      <p className="text-xs text-amber-700 dark:text-amber-300">
                        Troca: {mercadoPagoExpertPanel.switch.state}
                        {mercadoPagoExpertPanel.switch.nextMpUserId
                          ? ` · candidata ${mercadoPagoExpertPanel.switch.nextMpUserId}`
                          : ""}
                        {mercadoPagoExpertPanel.switch.authorizationReason
                          ? ` · motivo: ${mercadoPagoExpertPanel.switch.authorizationReason}`
                          : ""}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={mercadoPagoActionExpertId === editingExpertId}
                        onClick={() => void loadMercadoPagoExpertPanel(editingExpertId)}
                      >
                        <RefreshCcw className="size-4" /> Atualizar estado
                      </Button>
                      {mercadoPagoExpertPanel.connected ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={mercadoPagoActionExpertId === editingExpertId || !mercadoPagoSwitchReason.trim()}
                          onClick={() => void authorizeMercadoPagoReceiverSwitch(editingExpertId)}
                        >
                          {mercadoPagoActionExpertId === editingExpertId ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : null}
                          Autorizar troca de conta
                        </Button>
                      ) : null}
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="mercadopago-switch-reason">Motivo da autorização</Label>
                      <Input
                        id="mercadopago-switch-reason"
                        value={mercadoPagoSwitchReason}
                        maxLength={500}
                        placeholder="Ex.: conta anterior revogada pelo Expert"
                        onChange={(event) => setMercadoPagoSwitchReason(event.target.value)}
                      />
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">Consultando o estado…</p>
                )}
              </div>
            ) : null}
            <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
              <div>
                <p className="text-sm font-medium">Taxa da plataforma</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Aplicada somente às novas vendas de produtos deste expert.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Percentual">
                  <Input
                    inputMode="decimal"
                    value={expertForm.platformFeePercent}
                    onChange={(event) =>
                      setExpertForm({
                        ...expertForm,
                        platformFeePercent: formatPercentageInput(event.target.value),
                      })
                    }
                    required
                  />
                </Field>
                <Field label="Valor fixo">
                  <Input
                    inputMode="numeric"
                    value={expertForm.platformFeeFixedReais}
                    onChange={(event) =>
                      setExpertForm({
                        ...expertForm,
                        platformFeeFixedReais: formatBrlCurrencyInput(event.target.value),
                      })
                    }
                    required
                  />
                </Field>
                <Field label="Taxa marketplace">
                  <Input
                    inputMode="decimal"
                    value={expertForm.marketplaceFeePercent}
                    onChange={(event) =>
                      setExpertForm({
                        ...expertForm,
                        marketplaceFeePercent: formatPercentageInput(event.target.value),
                      })
                    }
                    required
                  />
                </Field>
              </div>
              <p className="text-xs font-medium text-foreground">
                {formatExpertPlatformFeePreview(
                  Math.round(parsePercentageInput(expertForm.platformFeePercent) * 100),
                  expertForm.platformFeeFixedReais
                    ? parseBrlCurrencyToCentavos(expertForm.platformFeeFixedReais)
                    : 0,
                )}
              </p>
              <p className="text-xs leading-5 text-muted-foreground">
                A taxa marketplace é somada ao percentual apenas quando a compra
                acontece por dentro do Automatize; vendas pelo link direto do
                produto pagam só a taxa acima.
              </p>
            </div>
            <Field label="Status">
              <Select
                value={expertForm.status}
                onValueChange={(status: Expert["status"]) =>
                  setExpertForm({ ...expertForm, status })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="active">Ativo</SelectItem>
                    <SelectItem value="inactive">Inativo</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeExpertDialog}>Cancelar</Button>
              <Button type="submit" disabled={loading}>
                {loading ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                {loading ? "Salvando..." : "Salvar alterações"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={contentDialogOpen}
        onOpenChange={(open) => {
          if (!open) closeContentDialog();
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Conteúdos {selectedProduct ? `· ${selectedProduct.title}` : ""}</DialogTitle>
            <DialogDescription>
              Organize as aulas, arquivos e links disponíveis neste produto.
            </DialogDescription>
          </DialogHeader>
          {selectedProduct ? (
            <div className="space-y-6">
              <form onSubmit={saveContent} className="grid gap-4 md:grid-cols-2">
                <Field label="Tipo">
                  <Select
                    value={contentForm.type}
                    onValueChange={(type) => changeContentType(type as Content["type"])}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="video">Vídeo</SelectItem>
                        <SelectItem value="pdf">PDF</SelectItem>
                        <SelectItem value="file">Arquivo</SelectItem>
                        <SelectItem value="external_link">Link externo</SelectItem>
                        <SelectItem value="scheduling">Agendamento</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Título"><Input value={contentForm.title} onChange={(e) => setContentForm({ ...contentForm, title: e.target.value })} required /></Field>
                <Field label={contentSourceLabel(contentForm.type)}>
                  <Input
                    type={contentForm.type === "video" ? "text" : "url"}
                    value={contentForm.sourceUrl}
                    onChange={(e) => changeContentSourceUrl(e.target.value)}
                    placeholder={contentSourcePlaceholder(contentForm.type)}
                  />
                  {contentForm.type === "pdf" ? (
                    <p className="text-xs leading-5 text-muted-foreground">
                      Use um link com acesso “Qualquer pessoa com o link” ou envie o PDF abaixo.
                    </p>
                  ) : null}
                  {contentForm.type === "scheduling" ? (
                    <p className="text-xs leading-5 text-muted-foreground">
                      Se o link for do Calendly, o calendário aparece na página do
                      produto. Outros links abrem em uma nova aba.
                    </p>
                  ) : null}
                </Field>
                {contentForm.type === "video" ? (
                  <Field label="Hospedagem do vídeo">
                    <Select
                      value={contentForm.videoProvider}
                      onValueChange={(videoProvider) =>
                        setContentForm({
                          ...contentForm,
                          videoProvider,
                        })
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="youtube">YouTube</SelectItem>
                          <SelectItem value="vimeo">Vimeo</SelectItem>
                          <SelectItem value="external">URL incorporável</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                ) : null}
                <Field label="Posição"><Input type="number" min="1" value={contentForm.position} onChange={(e) => setContentForm({ ...contentForm, position: e.target.value })} /></Field>
                {contentForm.type === "pdf" || contentForm.type === "file" ? (
                  <Field label={contentForm.type === "pdf" ? "Ou envie o PDF" : "Arquivo privado"}>
                    <Input
                      key={fileInputKey}
                      type="file"
                      accept={contentForm.type === "pdf" ? "application/pdf,.pdf" : undefined}
                      onChange={(e) => changeContentFile(e.target.files?.[0] ?? null)}
                    />
                  </Field>
                ) : null}
                <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={contentForm.published} onChange={(event) => setContentForm({ ...contentForm, published: event.target.checked })} /> Publicado</label>
                <div className="flex gap-2 md:col-span-2"><Button type="submit" disabled={loading}>{loading ? <Loader2 className="size-4 animate-spin" /> : file ? <Upload className="size-4" /> : <Plus className="size-4" />}{loading ? (file ? "Enviando arquivo..." : "Salvando...") : editingContentId ? "Salvar conteúdo" : "Adicionar conteúdo"}</Button>{editingContentId ? <Button type="button" variant="ghost" onClick={() => { setEditingContentId(null); setContentForm(emptyContent); }}>Cancelar</Button> : null}</div>
              </form>
              <div className="divide-y rounded-lg border">
                {content.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-4 px-4 py-3"><div><p className="font-medium">{item.position}. {item.title}</p><p className="text-xs text-muted-foreground">{item.type} · {item.published ? "publicado" : "rascunho"}</p></div><div className="flex gap-1"><Button size="icon" variant="ghost" onClick={() => editContent(item)}><Pencil className="size-4" /></Button><Button size="icon" variant="ghost" onClick={() => void removeContent(item.id)}><Trash2 className="size-4" /></Button></div></div>
                ))}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={paymentsDialogProduct !== null}
        onOpenChange={(open) => {
          if (!open) setPaymentsDialogProduct(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>
              Pagamentos {paymentsDialogProduct ? `· ${paymentsDialogProduct.title}` : ""}
            </DialogTitle>
            <DialogDescription>
              Vendas e pagamentos registrados para este produto.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[min(60vh,640px)] overflow-auto rounded-lg border">
            <Table className="min-w-[920px]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Data</TableHead>
                  <TableHead>Comprador</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Método</TableHead>
                  <TableHead>ID pagamento</TableHead>
                  <TableHead>Status pedido</TableHead>
                  <TableHead>Status pagamento</TableHead>
                  <TableHead className="text-right">Líquido</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {productPayments.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="h-28 text-center text-muted-foreground"
                    >
                      Nenhum pagamento registrado para este produto.
                    </TableCell>
                  </TableRow>
                ) : (
                  productPayments.map((order) => (
                    <TableRow key={order.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {dateTime(order.createdAt)}
                      </TableCell>
                      <TableCell>
                        <p className="font-medium">{order.buyerName}</p>
                        <p className="text-xs text-muted-foreground">
                          {order.buyerEmail}
                        </p>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">
                        {money(order.priceCentavos)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {paymentMethod(order)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                        {order.providerPaymentId ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {orderStatusLabel[order.status] ?? order.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {order.paymentStatus ? (
                          <Badge variant="outline">
                            {paymentStatusLabel[order.paymentStatus] ??
                              order.paymentStatus}
                          </Badge>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">
                        {order.netAmountCentavos !== null
                          ? money(order.netAmountCentavos)
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPaymentsDialogProduct(null)}
            >
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={orderDetailTarget !== null}
        onOpenChange={(open) => {
          if (!open) setOrderDetailTarget(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Detalhe do pedido</DialogTitle>
            <DialogDescription>
              {orderDetailTarget
                ? `${orderDetailTarget.productTitle} · ${orderDetailTarget.buyerName}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          {orderDetailTarget ? (
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Modelo financeiro</dt>
                <dd className="font-mono text-xs">
                  {financialModelLabel(orderDetailTarget.financialModel)}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Tarifa Estimada do Gateway</dt>
                <dd>
                  {formatGatewayFeeEstimateLabel({
                    financialModel:
                      orderDetailTarget.financialModel ?? "legacy_net_split",
                    provider: orderDetailTarget.provider ?? "mercadopago",
                    gatewayFeeEstimateBps: orderDetailTarget.gatewayFeeEstimateBps,
                    gatewayFeeEstimateFixedCentavos:
                      orderDetailTarget.gatewayFeeEstimateFixedCentavos,
                  }) ??
                    (orderDetailTarget.financialModel === "gateway_net_v1" &&
                    orderDetailTarget.gatewayFeeEstimateBps === null &&
                    orderDetailTarget.gatewayFeeEstimateFixedCentavos === null
                      ? "—"
                      : "Não se aplica")}
                </dd>
              </div>
              {(() => {
                const amounts = resolveProductOrderNetAmounts(
                  orderFinanceRow(orderDetailTarget),
                );
                return (
                  <>
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">Trilho de repasse</dt>
                      <dd>{amounts.expertSettlementLabel ?? "—"}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">Bruto</dt>
                      <dd className="font-mono tabular-nums">
                        {money(amounts.grossCentavos)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">Tarifa real</dt>
                      <dd className="font-mono tabular-nums">
                        {amounts.feeCentavos !== null
                          ? money(amounts.feeCentavos)
                          : "—"}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">Líquido</dt>
                      <dd className="font-mono tabular-nums">
                        {money(amounts.netCentavos)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">Parte do Expert</dt>
                      <dd className="font-mono tabular-nums">
                        {money(amounts.expertRevenueCentavos)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">
                        Coprodução do Automatize
                      </dt>
                      <dd className="font-mono tabular-nums">
                        {amounts.automatizeRevenueCentavos !== null
                          ? money(amounts.automatizeRevenueCentavos)
                          : "—"}
                      </dd>
                    </div>
                    {orderDetailTarget.stripeAccountId ? (
                      <div className="flex justify-between gap-4">
                        <dt className="text-muted-foreground">Conta Stripe</dt>
                        <dd className="max-w-[220px] truncate font-mono text-xs">
                          {orderDetailTarget.stripeAccountId}
                        </dd>
                      </div>
                    ) : null}
                    {orderDetailTarget.refundOperationStatus ? (
                      <div className="flex justify-between gap-4">
                        <dt className="text-muted-foreground">Operação de reembolso</dt>
                        <dd className="max-w-[260px] text-right text-xs">
                          {orderDetailTarget.refundOperationStatus === "external_partial"
                            ? `Exceção parcial · ${money(orderDetailTarget.refundOperationAmountCentavos ?? 0)}`
                            : orderDetailTarget.refundOperationStatus}
                          {orderDetailTarget.refundOperationOperatorEmail
                            ? ` · ${orderDetailTarget.refundOperationOperatorEmail}`
                            : ""}
                        </dd>
                      </div>
                    ) : null}
                    {orderDetailTarget.refundBalanceCaseId ? (
                      <div className="space-y-2 rounded-md border border-amber-300/60 bg-amber-50/50 p-3 dark:bg-amber-950/20">
                        <div className="flex justify-between gap-4">
                          <dt className="text-muted-foreground">Caso de saldo</dt>
                          <dd className="text-right text-xs">
                            {orderDetailTarget.refundBalanceStatus === "resolved"
                              ? "resolvido"
                              : `pendente · ${orderDetailTarget.refundBalanceResponsible ?? "não atribuído"}`}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-4 text-xs">
                          <dt className="text-muted-foreground">Valor / tentativas</dt>
                          <dd className="font-mono tabular-nums">
                            {money(orderDetailTarget.grossAmountCentavos ?? orderDetailTarget.checkoutTotalCentavos)} · {orderDetailTarget.refundBalanceAttemptCount ?? 0}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-4 text-xs">
                          <dt className="text-muted-foreground">Primeira falha</dt>
                          <dd>{orderDetailTarget.refundBalanceFirstFailedAt ? dateTime(orderDetailTarget.refundBalanceFirstFailedAt) : "—"}</dd>
                        </div>
                        <div className="flex justify-between gap-4 text-xs">
                          <dt className="text-muted-foreground">Prazo de 24h</dt>
                          <dd>{orderDetailTarget.refundBalanceDueAt ? dateTime(orderDetailTarget.refundBalanceDueAt) : "—"}</dd>
                        </div>
                        <div className="flex justify-between gap-4 text-xs">
                          <dt className="text-muted-foreground">Próxima ação</dt>
                          <dd className="text-right">
                            {orderDetailTarget.refundBalanceStatus === "resolved"
                              ? "Caso encerrado"
                              : orderDetailTarget.refundOperationStatus === "confirmed"
                                ? "Liberar vendas com motivo"
                                : orderDetailTarget.refundBalanceNextRetryAt
                                  ? `Retentar em ${dateTime(orderDetailTarget.refundBalanceNextRetryAt)}`
                                  : "Retentar agora"}
                          </dd>
                        </div>
                        {orderDetailTarget.refundBalanceLastFailureCode ? (
                          <p className="text-xs text-muted-foreground">
                            Último retorno: {orderDetailTarget.refundBalanceLastFailureCode}
                          </p>
                        ) : null}
                        {orderDetailTarget.refundBalanceStatus === "pending" && orderDetailTarget.refundOperationStatus === "confirmed" && orderDetailTarget.refundBalanceResponsible === "expert" ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={releasingBalance}
                            onClick={() => void releaseRefundBalanceCase(orderDetailTarget)}
                          >
                            {releasingBalance ? "Registrando…" : "Liberar vendas após confirmação"}
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </>
                );
              })()}
            </dl>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOrderDetailTarget(null)}
            >
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={refundTarget !== null}
        onOpenChange={(open) => {
          if (!open && !refunding) setRefundTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isMercadoPagoRefund
                ? "Estornar pagamento no Mercado Pago"
                : "Registrar reembolso"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {refundTarget
                ? `${refundTarget.buyerName} · total da cobrança: ${money(refundTarget.checkoutTotalCentavos)}`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 text-sm text-muted-foreground">
            {refundTarget ? (
              <div className="rounded-md border bg-muted/30 p-3 text-foreground">
                <p className="mb-2 font-medium">Itens abrangidos</p>
                <ul className="space-y-1">
                  {refundTarget.checkoutItems.map((item) => (
                    <li key={item.orderId} className="flex justify-between gap-3">
                      <span>{item.title}</span>
                      <span className="font-mono tabular-nums">
                        {money(item.amountCentavos)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p className="font-medium text-foreground">
              {isMercadoPagoRefund
                ? "A devolução é integral pela cobrança original. O sistema só conclui depois da confirmação do Mercado Pago."
                : "Isso não devolve o dinheiro — o Pix ao cliente é feito manualmente, fora do sistema."}
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Revoga os acessos somente após a confirmação integral.</li>
              <li>Estorna o repasse do expert no ledger.</li>
              <li>Zera a receita líquida da Automatize neste pagamento.</li>
            </ul>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={refunding}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={refunding}
              onClick={(event) => {
                event.preventDefault();
                void confirmRefund();
              }}
            >
              {refunding
                ? isMercadoPagoRefund
                  ? "Estornando…"
                  : "Registrando…"
                : isMercadoPagoRefund
                  ? "Estornar no Mercado Pago"
                  : "Registrar reembolso"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={onboardingLinkDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setOnboardingLinkDialogOpen(false);
            setOnboardingLinkUrl(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Link de onboarding da Conta Stripe do Expert</DialogTitle>
            <DialogDescription>
              Link de uso único. Copie e envie ao Expert — a URL não fica registrada em log.
            </DialogDescription>
          </DialogHeader>
          {onboardingLinkUrl ? (
            <div className="space-y-3">
              <Input readOnly value={onboardingLinkUrl} />
              <Button
                type="button"
                variant="outline"
                onClick={() => void copyOnboardingLink(onboardingLinkUrl)}
              >
                <Copy className="size-4" />
                Copiar link
              </Button>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOnboardingLinkDialogOpen(false);
                setOnboardingLinkUrl(null);
              }}
            >
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-2 ${className}`}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}
