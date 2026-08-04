"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  Check,
  Loader2,
  Pencil,
  Plus,
  RefreshCcw,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Expert = {
  id: string;
  displayName: string;
  email: string;
  phone: string | null;
  pixKey: string;
  status: string;
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
  expertShareBasisPoints: number;
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
  productTitle: string;
  buyerName: string;
  buyerEmail: string;
  priceCentavos: number;
  status: string;
  createdAt: string;
  providerPaymentId: string | null;
  netAmountCentavos: number | null;
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
  expertSharePercent: string;
  minimumPlanTier: string;
  visibility: "public" | "unlisted";
  status: Product["status"];
  salesEnabled: boolean;
  termsVersion: string;
};

const emptyProduct: ProductFormState = {
  ownerType: "automatize",
  expertId: "",
  title: "",
  slug: "",
  description: "",
  coverUrl: "",
  priceReais: "0",
  expertSharePercent: "0",
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

function money(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value / 100);
}

async function readError(response: Response) {
  const payload = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  return payload?.error ?? "Operação não concluída.";
}

export function ProductsAdminWorkspace() {
  const [products, setProducts] = useState<Array<{ product: Product; expertName: string | null }>>([]);
  const [experts, setExperts] = useState<Expert[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [content, setContent] = useState<Content[]>([]);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [productForm, setProductForm] = useState(emptyProduct);
  const [contentForm, setContentForm] = useState(emptyContent);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [editingContentId, setEditingContentId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);

  const selectedProduct = useMemo(
    () => products.find((row) => row.product.id === selectedProductId)?.product,
    [products, selectedProductId],
  );

  const loadAll = useCallback(async () => {
    setLoading(true);
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
    const payload = {
      ...productForm,
      expertId: productForm.expertId || null,
      priceCentavos: Math.round(Number(productForm.priceReais.replace(",", ".")) * 100),
      expertSharePercent: Number(productForm.expertSharePercent.replace(",", ".")),
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
    setLoading(false);
    if (!response.ok) return toast.error(await readError(response));
    toast.success(editingProductId ? "Produto atualizado." : "Produto criado.");
    setEditingProductId(null);
    setProductForm(emptyProduct);
    await loadAll();
  }

  function editProduct(row: Product) {
    setEditingProductId(row.id);
    setProductForm({
      ownerType: row.ownerType,
      expertId: row.expertId ?? "",
      title: row.title,
      slug: row.slug,
      description: row.description ?? "",
      coverUrl: row.coverUrl ?? "",
      priceReais: String(row.priceCentavos / 100).replace(".", ","),
      expertSharePercent: String(row.expertShareBasisPoints / 100).replace(".", ","),
      minimumPlanTier: row.minimumPlanTier ?? "",
      visibility: row.visibility,
      status: row.status,
      salesEnabled: row.salesEnabled,
      termsVersion: row.termsVersion,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function archiveProduct(id: string) {
    const response = await fetch(`/api/products/admin/${id}`, { method: "DELETE" });
    if (!response.ok) return toast.error(await readError(response));
    toast.success("Produto arquivado.");
    await loadAll();
  }

  async function saveContent(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedProductId) return;
    setLoading(true);
    let uploaded:
      | { pathname: string; filename: string; mimeType: string }
      | undefined;
    if (file) {
      const form = new FormData();
      form.set("file", file);
      form.set("productId", selectedProductId);
      const uploadResponse = await fetch("/api/products/admin/uploads", {
        method: "POST",
        body: form,
      });
      if (!uploadResponse.ok) {
        setLoading(false);
        return toast.error(await readError(uploadResponse));
      }
      uploaded = await uploadResponse.json();
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
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/products/admin/experts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(form)),
    });
    if (!response.ok) return toast.error(await readError(response));
    event.currentTarget.reset();
    toast.success("Expert vinculado.");
    await loadAll();
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
            <CardHeader>
              <CardTitle>{editingProductId ? "Editar produto" : "Novo produto"}</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={saveProduct} className="grid gap-4 md:grid-cols-3">
                <Field label="Título"><Input value={productForm.title} onChange={(e) => setProductForm({ ...productForm, title: e.target.value })} required /></Field>
                <Field label="Slug"><Input value={productForm.slug} onChange={(e) => setProductForm({ ...productForm, slug: e.target.value })} placeholder="gerado pelo título" /></Field>
                <Field label="Preço (R$)"><Input inputMode="decimal" value={productForm.priceReais} onChange={(e) => setProductForm({ ...productForm, priceReais: e.target.value })} required /></Field>
                <Field label="Proprietário">
                  <select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={productForm.ownerType} onChange={(e) => setProductForm({ ...productForm, ownerType: e.target.value as "automatize" | "expert" })}>
                    <option value="automatize">Automatize</option><option value="expert">Expert</option>
                  </select>
                </Field>
                <Field label="Expert">
                  <select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={productForm.expertId} disabled={productForm.ownerType !== "expert"} onChange={(e) => setProductForm({ ...productForm, expertId: e.target.value })}>
                    <option value="">Selecione</option>{experts.map((expert) => <option key={expert.id} value={expert.id}>{expert.displayName}</option>)}
                  </select>
                </Field>
                <Field label="Participação do expert (%)"><Input inputMode="decimal" disabled={productForm.ownerType !== "expert"} value={productForm.expertSharePercent} onChange={(e) => setProductForm({ ...productForm, expertSharePercent: e.target.value })} /></Field>
                <Field label="Incluído a partir do plano">
                  <select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={productForm.minimumPlanTier} onChange={(e) => setProductForm({ ...productForm, minimumPlanTier: e.target.value })}>
                    <option value="">Não incluir</option><option value="starter">Starter</option><option value="pro">Pro</option><option value="premium">Premium</option>
                  </select>
                </Field>
                <Field label="Visibilidade"><select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={productForm.visibility} onChange={(e) => setProductForm({ ...productForm, visibility: e.target.value as "public" | "unlisted" })}><option value="unlisted">Não listado</option><option value="public">Público</option></select></Field>
                <Field label="Status"><select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={productForm.status} onChange={(e) => setProductForm({ ...productForm, status: e.target.value as Product["status"] })}><option value="draft">Rascunho</option><option value="published">Publicado</option><option value="archived">Arquivado</option></select></Field>
                <Field label="Descrição" className="md:col-span-2"><Input value={productForm.description} onChange={(e) => setProductForm({ ...productForm, description: e.target.value })} /></Field>
                <Field label="Capa (URL)"><Input value={productForm.coverUrl} onChange={(e) => setProductForm({ ...productForm, coverUrl: e.target.value })} /></Field>
                <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={productForm.salesEnabled} onChange={(event) => setProductForm({ ...productForm, salesEnabled: event.target.checked })} /> Disponível para aquisição</label>
                <div className="flex gap-2 md:col-span-3">
                  <Button type="submit" disabled={loading}>{editingProductId ? <Check className="size-4" /> : <Plus className="size-4" />}{editingProductId ? "Salvar alterações" : "Criar produto"}</Button>
                  {editingProductId ? <Button type="button" variant="ghost" onClick={() => { setEditingProductId(null); setProductForm(emptyProduct); }}>Cancelar</Button> : null}
                </div>
              </form>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
            <Card>
              <CardHeader><CardTitle>Produtos</CardTitle></CardHeader>
              <CardContent className="divide-y p-0">
                {products.map(({ product: row, expertName }) => (
                  <button key={row.id} type="button" onClick={() => setSelectedProductId(row.id)} className={`w-full px-5 py-4 text-left hover:bg-muted/50 ${selectedProductId === row.id ? "bg-primary/5" : ""}`}>
                    <div className="flex items-start justify-between gap-3"><div><p className="font-medium">{row.title}</p><p className="text-xs text-muted-foreground">{expertName ?? "Automatize"} · {money(row.priceCentavos)}</p></div><Badge variant="outline">{row.status}</Badge></div>
                    <div className="mt-3 flex gap-2"><Button type="button" size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); editProduct(row); }}><Pencil className="size-3.5" /> Editar</Button><Button type="button" size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); void archiveProduct(row.id); }}><Archive className="size-3.5" /> Arquivar</Button></div>
                  </button>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Conteúdos {selectedProduct ? `· ${selectedProduct.title}` : ""}</CardTitle></CardHeader>
              <CardContent className="space-y-6">
                {selectedProduct ? (
                  <>
                    <form onSubmit={saveContent} className="grid gap-4 md:grid-cols-2">
                      <Field label="Tipo"><select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={contentForm.type} onChange={(e) => setContentForm({ ...contentForm, type: e.target.value as Content["type"] })}><option value="video">Vídeo</option><option value="pdf">PDF</option><option value="file">Arquivo</option><option value="external_link">Link externo</option></select></Field>
                      <Field label="Título"><Input value={contentForm.title} onChange={(e) => setContentForm({ ...contentForm, title: e.target.value })} required /></Field>
                      <Field label="URL / ID do vídeo"><Input value={contentForm.sourceUrl} onChange={(e) => setContentForm({ ...contentForm, sourceUrl: e.target.value })} disabled={!!file} /></Field>
                      {contentForm.type === "video" ? (
                        <Field label="Hospedagem do vídeo">
                          <select
                            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                            value={contentForm.videoProvider}
                            onChange={(event) =>
                              setContentForm({
                                ...contentForm,
                                videoProvider: event.target.value,
                              })
                            }
                          >
                            <option value="youtube">YouTube</option>
                            <option value="vimeo">Vimeo</option>
                            <option value="external">URL incorporável</option>
                          </select>
                        </Field>
                      ) : null}
                      <Field label="Posição"><Input type="number" min="1" value={contentForm.position} onChange={(e) => setContentForm({ ...contentForm, position: e.target.value })} /></Field>
                      <Field label="Arquivo privado"><Input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
                      <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={contentForm.published} onChange={(event) => setContentForm({ ...contentForm, published: event.target.checked })} /> Publicado</label>
                      <div className="flex gap-2 md:col-span-2"><Button type="submit" disabled={loading}>{file ? <Upload className="size-4" /> : <Plus className="size-4" />}{editingContentId ? "Salvar conteúdo" : "Adicionar conteúdo"}</Button>{editingContentId ? <Button type="button" variant="ghost" onClick={() => { setEditingContentId(null); setContentForm(emptyContent); }}>Cancelar</Button> : null}</div>
                    </form>
                    <div className="divide-y rounded-lg border">
                      {content.map((item) => (
                        <div key={item.id} className="flex items-center justify-between gap-4 px-4 py-3"><div><p className="font-medium">{item.position}. {item.title}</p><p className="text-xs text-muted-foreground">{item.type} · {item.published ? "publicado" : "rascunho"}</p></div><div className="flex gap-1"><Button size="icon" variant="ghost" onClick={() => editContent(item)}><Pencil className="size-4" /></Button><Button size="icon" variant="ghost" onClick={() => void removeContent(item.id)}><Trash2 className="size-4" /></Button></div></div>
                      ))}
                    </div>
                  </>
                ) : <p className="text-muted-foreground">Selecione um produto.</p>}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="experts" className="space-y-6 pt-4">
          <Card><CardHeader><CardTitle>Vincular expert</CardTitle></CardHeader><CardContent><form onSubmit={createExpert} className="grid gap-4 md:grid-cols-4"><Field label="E-mail do usuário"><Input name="email" type="email" required /></Field><Field label="Nome público"><Input name="displayName" required /></Field><Field label="WhatsApp"><Input name="phone" /></Field><Field label="Chave Pix"><Input name="pixKey" required /></Field><div className="md:col-span-4"><Button type="submit"><Plus className="size-4" /> Vincular expert</Button></div></form></CardContent></Card>
          <Card><CardHeader><CardTitle>Experts</CardTitle></CardHeader><CardContent className="divide-y p-0">{experts.map((expert) => <div key={expert.id} className="grid gap-2 px-5 py-4 sm:grid-cols-3"><div><p className="font-medium">{expert.displayName}</p><p className="text-sm text-muted-foreground">{expert.email}</p></div><span>{expert.phone ?? "Sem WhatsApp"}</span><span className="font-mono text-sm">{expert.pixKey}</span></div>)}</CardContent></Card>
        </TabsContent>

        <TabsContent value="orders" className="pt-4">
          <Card><CardHeader><CardTitle>Vendas</CardTitle></CardHeader><CardContent className="divide-y p-0">{orders.map((order) => <div key={order.id} className="grid gap-3 px-5 py-4 lg:grid-cols-[1fr_1fr_auto_auto] lg:items-center"><div><p className="font-medium">{order.productTitle}</p><p className="text-sm text-muted-foreground">{order.buyerName} · {order.buyerEmail}</p></div><div><p>{money(order.priceCentavos)}</p>{order.netAmountCentavos !== null ? <p className="text-xs text-muted-foreground">Líquido {money(order.netAmountCentavos)}</p> : null}</div><Badge variant="outline">{order.status}</Badge>{order.status === "approved" ? <Button size="sm" variant="destructive" onClick={() => void refundOrder(order.id)}>Reembolsar</Button> : null}</div>)}</CardContent></Card>
        </TabsContent>

        <TabsContent value="payouts" className="pt-4">
          <Card><CardHeader><CardTitle>Repasses</CardTitle></CardHeader><CardContent className="divide-y p-0">{payouts.map((payout) => <div key={payout.id} className="grid gap-3 px-5 py-4 lg:grid-cols-[1fr_auto_auto] lg:items-center"><div><p className="font-medium">{payout.expertName} · {money(payout.amountCentavos)}</p><p className="font-mono text-xs text-muted-foreground">Pix: {payout.pixKeySnapshot}</p><p className="text-xs text-muted-foreground">Prazo: {new Date(payout.dueAt).toLocaleDateString("pt-BR")}</p></div><Badge variant="outline">{payout.status}</Badge><div className="flex flex-wrap gap-2">{payout.status === "requested" ? <><Button size="sm" variant="outline" onClick={() => void updatePayout(payout.id, "approved")}>Aprovar</Button><Button size="sm" variant="ghost" onClick={() => void updatePayout(payout.id, "rejected")}>Rejeitar</Button></> : null}{payout.status === "approved" ? <Button size="sm" onClick={() => void updatePayout(payout.id, "paid")}>Registrar pagamento</Button> : null}</div></div>)}</CardContent></Card>
        </TabsContent>
      </Tabs>
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
