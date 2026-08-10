# Product Acquisition List Action Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evidenciar produtos indisponíveis para aquisição na listagem do Backoffice e permitir habilitá-los pelo dropdown de ações.

**Architecture:** Extrair a montagem do payload completo do `PATCH` para um helper puro em `lib/products`, reutilizado pelas ações de publicar e habilitar aquisição. O componente mantém um estado local com o ID da mutação em andamento, apresenta tag e item condicionais e recarrega os dados após sucesso.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS, shadcn/ui, Bun test.

## Global Constraints

- Exibir `Aquisição desabilitada` somente quando `salesEnabled` for `false`.
- Exibir `Habilitar aquisição` somente quando `salesEnabled` for `false`.
- Manter a desativação exclusivamente no formulário de edição.
- Reutilizar `PATCH /api/products/admin/[id]`; não alterar banco, schema ou contrato de API.
- Não adicionar dependências.
- Não executar build.

---

### Task 1: Payload de atualização e ação na listagem

**Files:**
- Create: `lib/products/admin-update-payload.ts`
- Test: `lib/products/admin-update-payload.test.ts`
- Modify: `app/(admin)/products/products-admin-workspace.tsx`

**Interfaces:**
- Consumes: Os campos atuais de `Product` recebidos pela listagem e o endpoint `PATCH /api/products/admin/[id]`.
- Produces: `buildProductAdminUpdatePayload(product, overrides)` retornando o payload completo aceito por `parseProductAdminInput`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { buildProductAdminUpdatePayload } from "./admin-update-payload";

describe("buildProductAdminUpdatePayload", () => {
  test("enables acquisition while preserving the remaining product fields", () => {
    const product = {
      ownerType: "expert" as const,
      expertId: "11111111-1111-4111-8111-111111111111",
      title: "Produto",
      slug: "produto",
      description: "Descrição",
      coverUrl: "https://example.com/cover.webp",
      priceCentavos: 12900,
      coproducerType: "automatize" as const,
      coproducerExpertId: null,
      coproducerShareBasisPoints: 2500,
      minimumPlanTier: "pro" as const,
      visibility: "public" as const,
      status: "published" as const,
      salesEnabled: false,
      termsVersion: "v2",
    };

    expect(
      buildProductAdminUpdatePayload(product, { salesEnabled: true }),
    ).toEqual({
      ownerType: "expert",
      expertId: "11111111-1111-4111-8111-111111111111",
      title: "Produto",
      slug: "produto",
      description: "Descrição",
      coverUrl: "https://example.com/cover.webp",
      priceCentavos: 12900,
      hasCoproduction: true,
      coproducerType: "automatize",
      coproducerExpertId: null,
      coproducerSharePercent: 25,
      minimumPlanTier: "pro",
      visibility: "public",
      status: "published",
      salesEnabled: true,
      termsVersion: "v2",
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test lib/products/admin-update-payload.test.ts`

Expected: FAIL porque `./admin-update-payload` ainda não existe.

- [ ] **Step 3: Implement the minimal pure helper**

```ts
export type ProductAdminUpdateSource = {
  ownerType: "automatize" | "expert";
  expertId: string | null;
  title: string;
  slug: string;
  description: string | null;
  coverUrl: string | null;
  priceCentavos: number;
  coproducerType: "automatize" | "expert" | null;
  coproducerExpertId: string | null;
  coproducerShareBasisPoints: number;
  minimumPlanTier: "starter" | "pro" | "premium" | null;
  visibility: "public" | "unlisted";
  status: "draft" | "published" | "archived";
  salesEnabled: boolean;
  termsVersion: string;
};

export function buildProductAdminUpdatePayload(
  product: ProductAdminUpdateSource,
  overrides: Partial<Pick<ProductAdminUpdateSource, "status" | "salesEnabled">> = {},
) {
  return {
    ownerType: product.ownerType,
    expertId: product.expertId,
    title: product.title,
    slug: product.slug,
    description: product.description,
    coverUrl: product.coverUrl,
    priceCentavos: product.priceCentavos,
    hasCoproduction: product.coproducerType !== null,
    coproducerType: product.coproducerType,
    coproducerExpertId: product.coproducerExpertId,
    coproducerSharePercent: product.coproducerShareBasisPoints / 100,
    minimumPlanTier: product.minimumPlanTier,
    visibility: product.visibility,
    status: product.status,
    salesEnabled: product.salesEnabled,
    termsVersion: product.termsVersion,
    ...overrides,
  };
}
```

- [ ] **Step 4: Run the helper test to verify it passes**

Run: `bun test lib/products/admin-update-payload.test.ts`

Expected: PASS.

- [ ] **Step 5: Wire the helper, tag, and action into the component**

Importar `ShoppingCart` e `buildProductAdminUpdatePayload`. Substituir o payload duplicado de `publishProduct` por:

```ts
body: JSON.stringify(
  buildProductAdminUpdatePayload(row, { status: "published" }),
),
```

Adicionar estado e mutação:

```ts
const [enablingSalesProductId, setEnablingSalesProductId] = useState<string | null>(null);

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
  } finally {
    setEnablingSalesProductId(null);
  }
}
```

Renderizar na célula de status:

```tsx
<div className="flex flex-wrap items-center gap-1.5">
  <Badge variant={statusBadge.variant} className={statusBadge.className}>
    {productStatusLabel[row.status]}
  </Badge>
  {!row.salesEnabled ? (
    <Badge
      variant="outline"
      className="border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-300"
    >
      Aquisição desabilitada
    </Badge>
  ) : null}
</div>
```

Antes de `Copiar link de checkout`, renderizar condicionalmente:

```tsx
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
```

- [ ] **Step 6: Run focused verification**

Run: `bun test lib/products/admin-update-payload.test.ts lib/products/admin-input.test.ts`

Expected: todos os testes passam.

Run: `bunx eslint 'app/(admin)/products/products-admin-workspace.tsx' lib/products/admin-update-payload.ts lib/products/admin-update-payload.test.ts`

Expected: nenhum erro.

- [ ] **Step 7: Validate the interface and commit**

Abrir a listagem local do Backoffice, confirmar a tag em um produto com `salesEnabled: false`, usar `Habilitar aquisição`, confirmar estado de carregamento, toast de sucesso e remoção da tag, e salvar prints da validação.

```bash
git add 'app/(admin)/products/products-admin-workspace.tsx' \
  lib/products/admin-update-payload.ts \
  lib/products/admin-update-payload.test.ts \
  docs/superpowers/plans/2026-08-10-product-acquisition-list-action.md
git commit -m "feat(products): enable acquisition from product list"
```
