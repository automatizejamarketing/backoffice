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
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import {
  ExpertImageCropDialog,
  ProductCoverCropDialog,
} from "@/components/expert-image-crop-dialog";
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
  type: "video" | "pdf" | "file" | "external_link";
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
  providerPaymentId: string | null;
  paymentStatus: string | null;
  paymentMethodId: string | null;
  paymentTypeId: string | null;
  grossAmountCentavos: number | null;
  netAmountCentavos: number | null;
  feeAmountCentavos: number | null;
  checkoutChannel: "direct" | "marketplace";
  marketplaceFeeBasisPoints: number;
  platformFeeGrossCentavos: number | null;
  platformGatewayNetRevenueCentavos: number | null;
  ownerExpertReceivableCentavos: number | null;
  coproducerExpertReceivableCentavos: number | null;
  automatizeCoproductionRevenueCentavos: number | null;
  automatizeProductRevenueCentavos: number | null;
  automatizeTotalNetRevenueCentavos: number | null;
  expertAvailableAt: string | null;
  expertLedgerAmountCentavos: number | null;
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

type ProductFormState = {
  ownerType: "automatize" | "expert";
  expertId: string;
  title: string;
  slug: string;
  description: string;
  coverUrl: string;
  priceReais: string;
  hasCoproduction: boolean;
  coproducerType: "automatize" | "expert";
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
  const [paymentsDialogProduct, setPaymentsDialogProduct] = useState<Product | null>(
    null,
  );

  const selectedProduct = useMemo(
    () => products.find((row) => row.product.id === selectedProductId)?.product,
    [products, selectedProductId],
  );
  const selectedOwnerExpert = useMemo(
    () => experts.find((expert) => expert.id === productForm.expertId) ?? null,
    [experts, productForm.expertId],
  );
  const expertsById = useMemo(
    () => new Map(experts.map((expert) => [expert.id, expert])),
    [experts],
  );
  const productPayments = useMemo(() => {
    if (!paymentsDialogProduct) return [];
    return orders.filter((order) => order.productId === paymentsDialogProduct.id);
  }, [orders, paymentsDialogProduct]);
  const ownerExpertSharePercent = productForm.hasCoproduction
    ? Math.max(
        0,
        100 - parsePercentageInput(productForm.coproducerSharePercent),
      )
    : 100;

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

  function changeCoproducer(value: string) {
    if (value === "automatize") {
      setProductForm((current) => ({
        ...current,
        coproducerType: "automatize",
        coproducerExpertId: "",
      }));
      return;
    }
    setProductForm((current) => ({
      ...current,
      coproducerType: "expert",
      coproducerExpertId: value.replace("expert:", ""),
    }));
  }

  const loadAll = useCallback(async () => {
    setLoading(true);
    setIsLoadingList(true);
    try {
      const [productsResponse, expertsResponse, ordersResponse, payoutsResponse] =
        await Promise.all([
          fetch("/api/products/admin", { cache: "no-store" }),
          fetch("/api/products/admin/experts", { cache: "no-store" }),
          fetch("/api/products/admin/orders", { cache: "no-store" }),
          fetch("/api/products/admin/payouts", { cache: "no-store" }),
        ]);
      if (![productsResponse, expertsResponse, ordersResponse, payoutsResponse].every((r) => r.ok)) {
        throw new Error("Não foi possível carregar o módulo.");
      }
      const [nextProducts, nextExperts, nextOrders, nextPayouts] =
        await Promise.all([
          productsResponse.json(),
          expertsResponse.json(),
          ordersResponse.json(),
          payoutsResponse.json(),
        ]);
      setProducts(nextProducts);
      setExperts(nextExperts);
      setOrders(nextOrders);
      setPayouts(nextPayouts);
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
      hasCoproduction: row.coproducerType !== null,
      coproducerType: row.coproducerType ?? "automatize",
      coproducerExpertId: row.coproducerExpertId ?? "",
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
        body: JSON.stringify({
          ownerType: row.ownerType,
          expertId: row.expertId,
          title: row.title,
          slug: row.slug,
          description: row.description,
          coverUrl: row.coverUrl,
          priceCentavos: row.priceCentavos,
          hasCoproduction: row.coproducerType !== null,
          coproducerType: row.coproducerType,
          coproducerExpertId: row.coproducerExpertId,
          coproducerSharePercent: row.coproducerShareBasisPoints / 100,
          minimumPlanTier: row.minimumPlanTier,
          visibility: row.visibility,
          status: "published",
          salesEnabled: row.salesEnabled,
          termsVersion: row.termsVersion,
        }),
      });
      if (!response.ok) return toast.error(await readError(response));
      toast.success("Produto publicado.");
      await loadAll();
    } finally {
      setPublishingProductId(null);
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
    setExpertDialogOpen(true);
  }

  function closeExpertDialog() {
    setExpertDialogOpen(false);
    setEditingExpertId(null);
    setExpertForm(emptyExpert);
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

  async function refundOrder(id: string) {
    if (!window.confirm("Confirmar reembolso integral e revogar o acesso da compra?")) return;
    const response = await fetch(`/api/products/admin/orders/${id}/refund`, {
      method: "POST",
    });
    if (!response.ok) return toast.error(await readError(response));
    toast.success("Reembolso registrado.");
    await loadAll();
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
        <TabsList className="grid w-full grid-cols-4 lg:w-fit">
          <TabsTrigger value="products">Produtos</TabsTrigger>
          <TabsTrigger value="experts">Experts</TabsTrigger>
          <TabsTrigger value="orders">Vendas</TabsTrigger>
          <TabsTrigger value="payouts">Repasses</TabsTrigger>
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
                              <span>{ownerName}</span>
                            </div>
                          </TableCell>
                        <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">{money(row.priceCentavos)}</TableCell>
                        <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">{money(grossRevenueCentavos)}</TableCell>
                        <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">{money(automatizeNetRevenueCentavos)}</TableCell>
                        <TableCell>
                          <Badge variant={statusBadge.variant} className={statusBadge.className}>
                            {productStatusLabel[row.status]}
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
                                aria-label={`Ações de ${row.title}`}
                                title="Ações"
                              >
                                <MoreHorizontal className="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-44">
                              {row.status === "draft" ? (
                                <DropdownMenuItem onSelect={() => void publishProduct(row)} disabled={publishingProductId === row.id}>
                                  {publishingProductId === row.id ? <Loader2 className="animate-spin" /> : <CircleCheck />}
                                  {publishingProductId === row.id ? "Publicando..." : "Publicar"}
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
              <Table className="min-w-[1040px]">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Expert</TableHead>
                    <TableHead className="w-[170px]">WhatsApp</TableHead>
                    <TableHead className="w-[280px]">Chave Pix</TableHead>
                    <TableHead className="w-[190px]">Taxa da plataforma</TableHead>
                    <TableHead className="w-[100px]">Status</TableHead>
                    <TableHead className="w-[110px] text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {experts.map((expert) => (
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
                          <DropdownMenuContent align="end" className="w-40">
                            <DropdownMenuItem onSelect={() => editExpert(expert)}>
                              <Pencil /> Editar
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
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
              <Table className="min-w-[1640px]">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Produto</TableHead>
                    <TableHead>Comprador</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead>Pagamento</TableHead>
                    <TableHead className="text-right">Bruto</TableHead>
                    <TableHead className="text-right">Custo MP</TableHead>
                    <TableHead className="text-right">Taxa plataforma</TableHead>
                    <TableHead className="text-right">Expert</TableHead>
                    <TableHead className="text-right">Coprodução Automatize</TableHead>
                    <TableHead className="text-right">Líquido Automatize</TableHead>
                    <TableHead>Liberação do expert</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoadingList ? (
                    <TableRow>
                      <TableCell colSpan={13} className="h-28 text-center">
                        <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  ) : orders.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={13}
                        className="h-28 text-center text-muted-foreground"
                      >
                        Nenhuma venda registrada.
                      </TableCell>
                    </TableRow>
                  ) : (
                    orders.map((order) => (
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
                          <p>{order.providerPaymentId ? `MP ${order.providerPaymentId}` : "—"}</p>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">
                          {money(order.priceCentavos)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">
                          {order.feeAmountCentavos !== null
                            ? money(order.feeAmountCentavos)
                            : "—"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">
                          <p>{order.platformFeeGrossCentavos !== null ? money(order.platformFeeGrossCentavos) : "—"}</p>
                          <p className="text-xs text-muted-foreground">
                            {order.checkoutChannel === "marketplace"
                              ? `marketplace (+${(order.marketplaceFeeBasisPoints / 100).toLocaleString("pt-BR")}%)`
                              : "link direto"}
                          </p>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">
                          {order.ownerExpertReceivableCentavos !== null ||
                          order.coproducerExpertReceivableCentavos !== null
                            ? money(
                                (order.ownerExpertReceivableCentavos ?? 0) +
                                  (order.coproducerExpertReceivableCentavos ?? 0),
                              )
                            : order.expertLedgerAmountCentavos !== null
                              ? money(order.expertLedgerAmountCentavos)
                              : "—"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">
                          {order.automatizeCoproductionRevenueCentavos !== null
                            ? money(order.automatizeCoproductionRevenueCentavos)
                            : order.automatizeProductRevenueCentavos !== null
                              ? money(order.automatizeProductRevenueCentavos)
                              : "—"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">
                          {order.automatizeTotalNetRevenueCentavos !== null
                            ? money(order.automatizeTotalNetRevenueCentavos)
                            : order.netAmountCentavos !== null
                              ? money(order.netAmountCentavos - (order.expertLedgerAmountCentavos ?? 0))
                              : "—"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {order.expertAvailableAt
                            ? paymentMethod(order) === "Pix"
                              ? "Na aprovação"
                              : dateTime(order.expertAvailableAt)
                            : "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {orderStatusLabel[order.status] ?? order.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {order.status === "approved" ? (
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
                              <DropdownMenuContent align="end" className="w-40">
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onSelect={() => void refundOrder(order.id)}
                                >
                                  Reembolsar
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
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
            <div className="space-y-3 rounded-lg border bg-muted/20 p-3 md:col-span-2">
              <p className="text-sm font-medium">Taxa da plataforma</p>
              <p className="text-xs leading-5 text-muted-foreground">
                {productForm.ownerType === "automatize"
                  ? "Produto próprio: sem taxa da plataforma. O líquido do Automatize é o valor bruto menos o custo do gateway."
                  : selectedOwnerExpert
                    ? `Taxa do expert: ${formatExpertPlatformFee(selectedOwnerExpert.platformFeeBasisPoints, selectedOwnerExpert.platformFeeFixedCentavos)}. Ela é congelada no pedido quando a venda é criada.`
                    : "Selecione o expert proprietário para consultar a taxa aplicável."}
              </p>
            </div>
            {productForm.ownerType === "expert" ? (
              <div className="space-y-3 rounded-lg border bg-muted/20 p-3 md:col-span-2">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium">Coprodução</p>
                    <p className="text-xs text-muted-foreground">
                      O proprietário recebe 100% da base enquanto esta opção estiver desativada.
                    </p>
                  </div>
                  <label className="flex shrink-0 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={productForm.hasCoproduction}
                      onChange={(event) =>
                        setProductForm((current) => ({
                          ...current,
                          hasCoproduction: event.target.checked,
                          coproducerType: "automatize",
                          coproducerExpertId: "",
                          coproducerSharePercent: "",
                        }))
                      }
                    />
                    Tem coprodução
                  </label>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Participação do proprietário">
                    <Input
                      value={formatPercentageInput(
                        String(ownerExpertSharePercent).replace(".", ","),
                      )}
                      readOnly
                      aria-readonly="true"
                      className="bg-muted/40"
                    />
                  </Field>

                  {productForm.hasCoproduction ? (
                    <>
                      <Field label="Coprodutor">
                        <Select
                          value={
                            productForm.coproducerType === "automatize"
                              ? "automatize"
                              : `expert:${productForm.coproducerExpertId}`
                          }
                          onValueChange={changeCoproducer}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value="automatize">Automatize</SelectItem>
                              {experts
                                .filter((expert) => expert.id !== productForm.expertId)
                                .map((expert) => (
                                  <SelectItem key={expert.id} value={`expert:${expert.id}`}>
                                    {expert.displayName}
                                    {expert.status === "inactive" ? " (inativo)" : ""}
                                  </SelectItem>
                                ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label="Participação do coprodutor">
                        <Input
                          inputMode="decimal"
                          placeholder="Ex.: 40%"
                          value={productForm.coproducerSharePercent}
                          onChange={(event) =>
                            setProductForm((current) => ({
                              ...current,
                              coproducerSharePercent: formatPercentageInput(
                                event.target.value,
                              ),
                            }))
                          }
                          required
                        />
                        <p className="text-xs text-muted-foreground">
                          Aplicado sobre o valor bruto após a taxa da plataforma.
                        </p>
                      </Field>
                    </>
                  ) : null}
                </div>
              </div>
            ) : null}
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
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Título"><Input value={contentForm.title} onChange={(e) => setContentForm({ ...contentForm, title: e.target.value })} required /></Field>
                <Field label={contentForm.type === "video" ? "URL / ID do vídeo" : contentForm.type === "pdf" ? "Link do Google Drive" : "URL externa"}>
                  <Input
                    type={contentForm.type === "video" ? "text" : "url"}
                    value={contentForm.sourceUrl}
                    onChange={(e) => changeContentSourceUrl(e.target.value)}
                    placeholder={contentForm.type === "pdf" ? "https://drive.google.com/file/d/.../view" : undefined}
                  />
                  {contentForm.type === "pdf" ? (
                    <p className="text-xs leading-5 text-muted-foreground">
                      Use um link com acesso “Qualquer pessoa com o link” ou envie o PDF abaixo.
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
