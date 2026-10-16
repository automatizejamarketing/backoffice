import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getExpertAdminDetail } from "@/lib/db/product-queries";
import { resolveFrontendAppUrl } from "@/lib/env/frontend-app-url";
import { formatBrlCurrencyFromCentavos } from "@/lib/products/currency-input";
import { getExpertMercadoPagoPanel } from "@/lib/products/expert-mercadopago-panel";
import {
  readStoredTrackingPixels,
  TRACKING_PIXEL_PROVIDER_LABELS,
} from "@/lib/products/tracking-pixels";
import { ExpertAvatar } from "../../expert-avatar";
import { TrackingPixelLogo } from "../../tracking-pixel-logos";
import { ExpertDefaultPixelsPanel } from "./expert-default-pixels-panel";

export const dynamic = "force-dynamic";

const productStatus: Record<
  "draft" | "published" | "archived",
  { label: string; tone: StatusTone }
> = {
  draft: { label: "Rascunho", tone: "neutral" },
  published: { label: "Publicado", tone: "success" },
  archived: { label: "Arquivado", tone: "neutral" },
};

const methodStatus: Record<string, { label: string; tone: StatusTone }> = {
  available: { label: "disponível", tone: "success" },
  unavailable: { label: "indisponível", tone: "danger" },
  unknown: { label: "aguardando validação", tone: "warning" },
};

function percent(basisPoints: number) {
  return `${(basisPoints / 100).toLocaleString("pt-BR", {
    maximumFractionDigits: 2,
  })}%`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="space-y-1 p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

export default async function ExpertDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getExpertAdminDetail(id);
  if (!detail) notFound();
  const mercadoPago = await getExpertMercadoPagoPanel(id);
  const frontendAppUrl = resolveFrontendAppUrl();
  const { expert, products, sales } = detail;
  const published = products.filter((row) => row.status === "published");

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-4">
        <Button variant="ghost" size="sm" className="w-fit gap-1.5" asChild>
          <Link href="/products?tab=experts">
            <ArrowLeft className="size-4" />
            Produtos e Experts
          </Link>
        </Button>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <ExpertAvatar
              name={expert.displayName}
              src={expert.profileImageUrl}
              size="lg"
            />
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-2xl font-semibold">
                  {expert.displayName}
                </h1>
                <StatusBadge
                  tone={expert.status === "active" ? "success" : "neutral"}
                >
                  {expert.status === "active" ? "Ativo" : "Inativo"}
                </StatusBadge>
              </div>
              <p className="truncate text-sm text-muted-foreground">
                {expert.email}
              </p>
            </div>
          </div>
          <Button variant="outline" asChild>
            <Link href={`/products?tab=experts&expert=${expert.id}`}>
              <Pencil className="size-4" />
              Editar cadastro
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="Produtos publicados"
          value={`${published.length} de ${products.length}`}
        />
        <Stat label="Vendas aprovadas" value={String(sales.count)} />
        <Stat
          label="Faturamento bruto"
          value={formatBrlCurrencyFromCentavos(sales.grossCentavos)}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recebimento</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Row label="Mercado Pago">
              <StatusBadge tone={mercadoPago.connected ? "success" : "neutral"}>
                {mercadoPago.connected ? "Conectada" : "Não conectada"}
              </StatusBadge>
            </Row>
            {mercadoPago.connected ? (
              <>
                <Row label="Conta">
                  <span className="font-mono">
                    {"accountId" in mercadoPago ? mercadoPago.accountId : "—"}
                  </span>
                </Row>
                {(["pix", "card"] as const).map((method) => {
                  const status =
                    methodStatus[mercadoPago[method]] ?? methodStatus.unknown;
                  return (
                    <Row key={method} label={method === "pix" ? "Pix" : "Cartão"}>
                      <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                    </Row>
                  );
                })}
              </>
            ) : null}
            <Row label="Stripe">
              <StatusBadge
                tone={expert.stripeChargesEnabled ? "success" : "neutral"}
              >
                {expert.stripeChargesEnabled
                  ? "Habilitada"
                  : expert.stripeAccountId
                    ? "Pendente"
                    : "Não conectada"}
              </StatusBadge>
            </Row>
            <Row label="Chave Pix">
              <span className="break-all">{expert.pixKey}</span>
            </Row>
            <Row label="WhatsApp">{expert.phone ?? "—"}</Row>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Taxa da plataforma</CardTitle>
            <CardDescription>
              Aplicada às novas vendas dos produtos deste expert.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Row label="Percentual">{percent(expert.platformFeeBasisPoints)}</Row>
            <Row label="Valor fixo">
              {formatBrlCurrencyFromCentavos(expert.platformFeeFixedCentavos)}
            </Row>
            <Row label="Taxa marketplace">
              {percent(expert.marketplaceFeeBasisPoints)}
            </Row>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pixels padrão</CardTitle>
          <CardDescription>
            Ao salvar, entram nos produtos do expert sem pixel da plataforma (ou
            ainda no padrão anterior) e em todo produto novo. Pixel próprio do
            produto não é trocado.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ExpertDefaultPixelsPanel
            expertId={expert.id}
            initialPixels={readStoredTrackingPixels(expert.defaultTrackingPixels)}
            initialCapiPixelIds={expert.capiPixelIds}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Produtos ({products.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {products.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum produto deste expert.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Preço</TableHead>
                  <TableHead>Pixels</TableHead>
                  <TableHead className="text-right">Checkout</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((row) => {
                  const status = productStatus[row.status];
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="max-w-72">
                        <p className="truncate font-medium" title={row.title}>
                          {row.title}
                        </p>
                        <p className="truncate font-mono text-xs text-muted-foreground">
                          {row.slug}
                        </p>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                          {row.status === "published" && !row.salesEnabled ? (
                            <StatusBadge tone="warning">Vendas pausadas</StatusBadge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatBrlCurrencyFromCentavos(row.priceCentavos)}
                      </TableCell>
                      <TableCell>
                        {row.trackingPixels.length === 0 ? (
                          <span className="text-sm text-muted-foreground">—</span>
                        ) : (
                          <div className="flex flex-wrap items-center gap-2">
                            {row.trackingPixels.map((pixel) => (
                              <Badge
                                key={`${pixel.provider}:${pixel.pixelId}`}
                                variant="outline"
                                className="gap-1.5 font-mono"
                                title={TRACKING_PIXEL_PROVIDER_LABELS[pixel.provider]}
                              >
                                <TrackingPixelLogo
                                  provider={pixel.provider}
                                  className="size-3.5"
                                />
                                {pixel.pixelId}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {row.status === "published" ? (
                          <Button variant="ghost" size="sm" asChild>
                            <a
                              href={`${frontendAppUrl}/produtos/${row.slug}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Abrir
                              <ExternalLink className="size-3.5" />
                            </a>
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
