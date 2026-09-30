# Localização editável no fluxo de IA do backoffice — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O operador do backoffice consegue buscar, adicionar, trocar e excluir endereços e raios na Localização do "Criar campanha com IA", como no app do cliente.

**Architecture:** A busca do `LocationTargetingSection` deixa de ser um `Popover` com portal (que abre coberto pelo sheet de revisão `z-[90]`) e vira um painel inline, igual ao app. As operações de lista viram funções puras testáveis em `location-selection.ts`. Um ajuste global de empilhamento (`[data-radix-popper-content-wrapper]` e `PopoverContent` em z-index 100) conserta os overlays dos outros sheets de revisão (Período, CTA). No caminho do molde, a linha "Localização" aparece só leitura, com o resumo do plano.

**Tech Stack:** Next.js 16 (App Router, React 19), Radix UI (Popover/Select/Dialog-Sheet), `cmdk`, Tailwind v4, `bun:test`, agent-browser 0.38 (verificação na UI).

**Spec:** `docs/superpowers/specs/2026-09-30-ai-location-edit-design.md`

## Global Constraints

- Repositório: só `backoffice`, worktree `D:\automatize-marketing\backoffice-ai-location-edit`, branch `fix/ai-location-edit`. Nunca commitar na `main`.
- Sem mudança no `automatize-frontend`, no motor espelhado `lib/meta-business/marketing/ai-creation/`, no banco (`lib/db/`) ou em rotas de API (`app/api/`).
- Regra do Brasil **igual ao app, sem mudança**: adicionar um local específico tira o "Brasil"; remover o último local deixa `[Brasil · PAÍS]`; "Brasil" sozinho é válido.
- Raio só para `custom_location` e `place`, inteiro, limitado a `MIN_RADIUS_KM`–`MAX_RADIUS_KM` (1–80 km) ou aos `minRadiusKm`/`maxRadiusKm` do componente; padrão `DEFAULT_CITY_RADIUS_KM` (16).
- Texto da UI em pt-BR. Comentários de código em inglês, no estilo dos arquivos vizinhos.
- Pacotes: só `bun` (nunca `npm`/`yarn`/`pnpm`).
- Testes: `bun:test` (`import { describe, expect, test } from "bun:test"`) ou `node:test` + `node:assert/strict`, como os vizinhos.
- Suíte completa: `FRONTEND_ROOT=D:/automatize-marketing/automatize-frontend bun test` a partir da raiz da worktree. Baseline da branch: **1497 pass / 8 fail**. As 8 falhas pré-existentes são exatamente: "CRM contact filters, signup association, monthly goals and gifted access separation"; "both apps share the tag migration and timestamp"; "expiration and audit remain atomic with pipelining disabled"; "grant concurrency, expiry extension, lapsed renewal, monthly idempotency, ended partnership, billing separation"; "journal de migrations > gêmeas byte-idênticas compartilham o mesmo when"; "journal de migrations > não estreia colisão de `when` com o repositório irmão"; "pool preserves transactions, queues work, releases idle clients and reconnects"; "settings persist across reads with editor attribution and do not alter contact attribution". Qualquer outra falha é regressão.
- Typecheck: `bunx tsc --noEmit -p .` já sai com **23 erros pré-existentes**, todos em arquivos `*.test.ts` fora do escopo (`lib/backoffice/portfolio-filters.test.ts`, `lib/backoffice/users-csv.test.ts`, `lib/env/frontend-app-url.test.ts`, `lib/meta-business/admin-oauth.test.ts`, `lib/meta-business/marketing/audiences/release.test.ts`, `lib/meta-business/partner-access-status.test.ts`, `lib/meta-business/sanitize.test.ts`, `lib/performance-report/analysis.test.ts`, `lib/performance-report/metrics.test.ts`, `tests/customer-file-xlsx.test.ts`). Portão: nenhum erro em arquivo tocado por esta branch.
- Lint: `bunx eslint <arquivos tocados>` deve sair 0. O `bun run lint` do repo inteiro já sai 1 na base; não é portão.
- Commits: `git add` só dos arquivos listados na tarefa (nunca `git add -A` ou `git add .`). Mensagem em pt-BR no estilo `fix(marketing): …`, terminando com a linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Verificação na UI: nunca clicar em "Publicar campanha", "Criar pixel" ou qualquer ação que escreva na Meta. As contas `act_763911788291358` e `act_2102201707319672` são reais.

## Review Focus

1. **Esc dentro da busca** (sheet de revisão e diálogos de conjunto): o operador espera que Esc feche só a busca. Sem cuidado, o listener de Esc do Radix, na captura do `document`, fecha o sheet e descarta o rascunho. Coberto pela Task 2 (listener na captura do `window`, passo 8 da verificação).
2. **Endereço do Google sem coordenadas ou falha nos detalhes do Places**: a mensagem aparece dentro do painel inline, nada é adicionado e o painel continua aberto. Coberto pela Task 2 (o caminho do código continua o mesmo; o passo 6 da verificação confere que o erro aparece dentro do painel).
3. **Raio digitado com lixo** (`""`, `"0"`, `"-3"`, `"abc"`, `"120"`): o lixo é ignorado e o valor alto vira 80. Coberto pelos testes de `setLocationRadius` na Task 1.
4. **Pino arrastado e depois raio editado**: o arraste troca a chave do local (`custom_<lat>_<lng>`), e o ±/slider seguinte precisa achar o local pela chave nova. Coberto pelo teste "depois de mover o pino, o raio edita pela chave nova" na Task 1.
5. **Molde sem plano carregado** (`plannedAudience` indefinido porque o `/plan` falhou): a linha só leitura mostra "não especificada", sem quebrar a revisão. Coberto pelo teste `geoSummaryLine(undefined)` na Task 4.

---

## Receita de verificação na UI (agent-browser)

Toda tarefa de UI usa esta receita. `S` é `C:/Users/rafae/AppData/Local/Temp/claude/D--automatize-marketing/57abf49b-a1d0-4e8b-a186-ffbd2ff38758/scratchpad`.

**O controlador (sessão principal) garante antes de despachar tarefas de UI:**
- `.env.staging` copiado de `D:\automatize-marketing\backoffice\.env.staging` para a raiz da worktree. É gitignored, e o controlador apaga no fim.
- Dev server `bun run dev:staging` (porta 3006, banco staging `wsbsnzgzqiehqnklzchm`) rodando, iniciado pelo controlador. **Implementers não iniciam nem param o servidor.** O Next recompila sozinho quando os arquivos mudam.
- Token de sessão em `$S/verify/magic.token`, gerado com `cd /d/automatize-marketing/backoffice && APP_ENV=staging bun scripts/with-env.ts bun "$S/verify/mint.ts" "$S/verify/magic.token"`. **Nunca imprima o conteúdo do token.**

**No começo de cada verificação:**

```bash
S="C:/Users/rafae/AppData/Local/Temp/claude/D--automatize-marketing/57abf49b-a1d0-4e8b-a186-ffbd2ff38758/scratchpad"
EVID="D:/automatize-marketing/backoffice-ai-location-edit/docs/superpowers/plans/2026-09-30-ai-location-edit-evidence"
mkdir -p "$EVID"
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3006/login   # tem de dar 200; se não, reporte BLOCKED
agent-browser skills get core          # leia uma vez: refs (@eN), snapshot, click, fill, eval, screenshot
agent-browser open http://localhost:3006/login
agent-browser cookies set backoffice_magic_session "$(cat "$S/verify/magic.token")" --url http://localhost:3006
agent-browser set viewport 1440 900
```

**Clientes de staging:**

| Caso | userId | accountId | Observação |
|---|---|---|---|
| A — com endereço salvo (sheet de revisão) | `ef82046f-3489-430a-8bdd-c12c3e535d3d` | `act_763911788291358` | Endereço em Campos/RJ; Página com Instagram. |
| B — sem endereço (passo "Onde anunciar?") | `384f3178-3946-4fe5-b686-7f30adf16999` | `act_2102201707319672` | Uma Página (Mytribe), então o passo de identidade não aparece. |
| M — molde (caminho do molde) | `ef82046f-3489-430a-8bdd-c12c3e535d3d` | `act_763911788291358` | O molde só é buscado com o objetivo "Vendas no site". |

URL do fluxo: `http://localhost:3006/marketing/ai?userId=<userId>&accountId=<accountId>`.

**Caminho mais curto até a revisão, sem publicar (casos A e B):**
1. Objetivo: "Leads" (sem passo de pixel; o link é opcional).
2. Orçamento: clique num valor pronto (20, 30, 50 ou 100) e em Continuar.
3. Identidade: só aparece com 2+ Páginas; escolha a primeira e continue.
4. Mídia: aba de envio do dispositivo; suba `$S/verify/sample.png` (já preparado pelo controlador). Em dev, sem R2, o arquivo vai para `.data/media-r2` no disco, sem Meta e sem Blob.
5. Texto: título "Teste de localização" e texto "Verificação local, não publicar." (não use "escrever com IA").
6. Caso A: a Localização é pulada e o fluxo cai na revisão. Caso B: aparece "Onde anunciar?".

**Checagem objetiva de "por cima" (sem depender só do screenshot):**

```bash
# painel inline da busca de localização: 'on-top' | 'covered' | 'no-panel'
agent-browser eval "(() => { const b = document.querySelector('button[aria-controls][aria-expanded=\"true\"]'); const p = b && document.getElementById(b.getAttribute('aria-controls')); if (!p) return 'no-panel'; const r = p.getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(24, r.height / 2)); return p.contains(el) ? 'on-top' : 'covered'; })()"
# overlay Radix com portal (popover, calendário, select) aberto por último: 'on-top' | 'covered' | 'no-overlay'
agent-browser eval "(() => { const w = [...document.querySelectorAll('[data-radix-popper-content-wrapper]')].pop(); if (!w) return 'no-overlay'; const r = w.getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(24, r.height / 2)); return w.contains(el) ? 'on-top' : 'covered'; })()"
# sem scroll horizontal (celular)
agent-browser eval "document.documentElement.scrollWidth <= window.innerWidth"
```

Screenshots: `agent-browser screenshot "$EVID/<NN>-<descrição>.png"`. Os PNGs **não** entram no commit (a pasta está no `info/exclude`). No relatório da tarefa, liste cada arquivo com uma linha dizendo o que ele prova, e o resultado de cada `eval`.

---

### Task 1: Operações puras da lista de localizações

**Files:**
- Create: `app/(admin)/marketing/components/location-selection.ts`
- Test: `app/(admin)/marketing/components/location-selection.test.ts`

**Interfaces:**
- Consumes: de `@/lib/meta-business/geo-targeting-types`: `applyDefaultBrazilLocationRule(locations: SelectedGeoLocation[]): SelectedGeoLocation[]`, `isRadiusGeoLocation(location: Pick<SelectedGeoLocation, "type">): boolean`, `DEFAULT_CITY_RADIUS_KM` (16), `DEFAULT_BRAZIL_LOCATION`, `MIN_RADIUS_KM` (1), `MAX_RADIUS_KM` (80), `type SelectedGeoLocation`.
- Produces (usado pela Task 2):
  - `type RadiusBounds = { min: number; max: number }`
  - `addSelectedLocation(locations: SelectedGeoLocation[], location: SelectedGeoLocation): SelectedGeoLocation[]` — recebe um local **já normalizado**.
  - `removeSelectedLocation(locations: SelectedGeoLocation[], key: string): { locations: SelectedGeoLocation[]; removedIndex: number }`
  - `expandedIndexAfterRemoval(current: number | null, removedIndex: number): number | null`
  - `setLocationRadius(locations: SelectedGeoLocation[], key: string, rawValue: string, bounds: RadiusBounds): SelectedGeoLocation[]`
  - `stepLocationRadius(locations: SelectedGeoLocation[], key: string, delta: number, bounds: RadiusBounds): SelectedGeoLocation[]`
  - `moveLocationPin(locations: SelectedGeoLocation[], index: number, latitude: number, longitude: number, bounds: RadiusBounds): SelectedGeoLocation[]`

- [ ] **Step 1: Write the failing test**

Crie `app/(admin)/marketing/components/location-selection.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import {
  DEFAULT_BRAZIL_LOCATION,
  DEFAULT_CITY_RADIUS_KM,
  MAX_RADIUS_KM,
  MIN_RADIUS_KM,
  type SelectedGeoLocation,
} from "@/lib/meta-business/geo-targeting-types";

import {
  addSelectedLocation,
  expandedIndexAfterRemoval,
  moveLocationPin,
  removeSelectedLocation,
  setLocationRadius,
  stepLocationRadius,
} from "./location-selection";

const BOUNDS = { min: MIN_RADIUS_KM, max: MAX_RADIUS_KM };

const campinas: SelectedGeoLocation = {
  key: "243451",
  name: "Campinas",
  type: "city",
  region: "São Paulo",
  country_name: "Brazil",
};

const paulista: SelectedGeoLocation = {
  key: "google_paulista",
  name: "Av. Paulista, 1000",
  type: "custom_location",
  address_string: "Av. Paulista, 1000 - Bela Vista, São Paulo - SP",
  latitude: -23.5614,
  longitude: -46.6559,
  radius: 5,
  distance_unit: "kilometer",
};

const loja: SelectedGeoLocation = {
  key: "place_loja",
  name: "Loja Centro",
  type: "place",
  latitude: -23.55,
  longitude: -46.63,
  radius: 3,
  distance_unit: "kilometer",
};

describe("regra do Brasil (igual ao app)", () => {
  test("adicionar um local específico tira o Brasil", () => {
    expect(addSelectedLocation([DEFAULT_BRAZIL_LOCATION], campinas)).toEqual([campinas]);
  });

  test("remover o último local devolve só o Brasil", () => {
    expect(removeSelectedLocation([paulista], paulista.key)).toEqual({
      locations: [DEFAULT_BRAZIL_LOCATION],
      removedIndex: 0,
    });
  });

  test("Brasil sozinho continua e não sai ao ser removido", () => {
    expect(addSelectedLocation([], DEFAULT_BRAZIL_LOCATION)).toEqual([DEFAULT_BRAZIL_LOCATION]);
    expect(removeSelectedLocation([DEFAULT_BRAZIL_LOCATION], DEFAULT_BRAZIL_LOCATION.key)).toEqual({
      locations: [DEFAULT_BRAZIL_LOCATION],
      removedIndex: 0,
    });
  });

  test("escolher o Brasil com uma cidade na lista mantém só a cidade", () => {
    expect(addSelectedLocation([campinas], DEFAULT_BRAZIL_LOCATION)).toEqual([campinas]);
  });
});

describe("adicionar e remover", () => {
  test("adicionar anexa no fim", () => {
    expect(addSelectedLocation([campinas], paulista)).toEqual([campinas, paulista]);
  });

  test("remover do meio preserva a ordem", () => {
    expect(removeSelectedLocation([campinas, paulista, loja], paulista.key)).toEqual({
      locations: [campinas, loja],
      removedIndex: 1,
    });
  });

  test("chave inexistente não muda a lista", () => {
    expect(removeSelectedLocation([campinas, paulista], "nao-existe")).toEqual({
      locations: [campinas, paulista],
      removedIndex: -1,
    });
  });
});

describe("expandedIndexAfterRemoval", () => {
  test("nada expandido continua nada expandido", () => {
    expect(expandedIndexAfterRemoval(null, 1)).toBeNull();
  });

  test("o card removido fecha", () => {
    expect(expandedIndexAfterRemoval(1, 1)).toBeNull();
  });

  test("cards depois do removido sobem uma posição", () => {
    expect(expandedIndexAfterRemoval(2, 1)).toBe(1);
  });

  test("cards antes do removido ficam onde estão", () => {
    expect(expandedIndexAfterRemoval(0, 1)).toBe(0);
  });

  test("remoção de chave inexistente não mexe no expandido", () => {
    expect(expandedIndexAfterRemoval(2, -1)).toBe(2);
  });
});

describe("raio", () => {
  test("campo numérico grava o raio em km", () => {
    expect(setLocationRadius([paulista], paulista.key, "12", BOUNDS)).toEqual([
      { ...paulista, radius: 12, distance_unit: "kilometer" },
    ]);
  });

  test("estabelecimento (place) também aceita raio", () => {
    expect(setLocationRadius([loja], loja.key, "7", BOUNDS)[0]?.radius).toBe(7);
  });

  test("acima do máximo fica no máximo", () => {
    expect(setLocationRadius([paulista], paulista.key, "120", BOUNDS)[0]?.radius).toBe(MAX_RADIUS_KM);
  });

  test("abaixo do mínimo configurado sobe para o mínimo", () => {
    expect(setLocationRadius([paulista], paulista.key, "2", { min: 5, max: 50 })[0]?.radius).toBe(5);
  });

  test("vazio, zero, negativo e texto são ignorados", () => {
    for (const rawValue of ["", "0", "-3", "abc"]) {
      expect(setLocationRadius([paulista], paulista.key, rawValue, BOUNDS)).toEqual([paulista]);
    }
  });

  test("cidade e país não recebem raio", () => {
    expect(setLocationRadius([campinas], campinas.key, "10", BOUNDS)).toEqual([campinas]);
    expect(stepLocationRadius([DEFAULT_BRAZIL_LOCATION], "BR", 1, BOUNDS)).toEqual([
      DEFAULT_BRAZIL_LOCATION,
    ]);
  });

  test("± soma e subtrai 1 km", () => {
    expect(stepLocationRadius([paulista], paulista.key, 1, BOUNDS)[0]?.radius).toBe(6);
    expect(stepLocationRadius([paulista], paulista.key, -1, BOUNDS)[0]?.radius).toBe(4);
  });

  test("± respeita os limites", () => {
    const noMaximo = { ...paulista, radius: MAX_RADIUS_KM };
    const noMinimo = { ...paulista, radius: MIN_RADIUS_KM };
    expect(stepLocationRadius([noMaximo], paulista.key, 1, BOUNDS)[0]?.radius).toBe(MAX_RADIUS_KM);
    expect(stepLocationRadius([noMinimo], paulista.key, -1, BOUNDS)[0]?.radius).toBe(MIN_RADIUS_KM);
  });

  test("± sem raio parte do padrão", () => {
    const semRaio = { ...paulista, radius: undefined };
    expect(stepLocationRadius([semRaio], paulista.key, 1, BOUNDS)[0]?.radius).toBe(
      DEFAULT_CITY_RADIUS_KM + 1,
    );
  });

  test("só o local da chave muda", () => {
    expect(setLocationRadius([paulista, loja], loja.key, "9", BOUNDS)[0]).toEqual(paulista);
  });
});

describe("mover o pino", () => {
  test("uma cidade vira endereço personalizado com raio padrão", () => {
    expect(moveLocationPin([campinas], 0, -22.9, -47.06, BOUNDS)).toEqual([
      {
        ...campinas,
        key: "custom_-22.900000_-47.060000",
        type: "custom_location",
        latitude: -22.9,
        longitude: -47.06,
        address_string: "Campinas",
        radius: DEFAULT_CITY_RADIUS_KM,
        distance_unit: "kilometer",
      },
    ]);
  });

  test("um endereço mantém o raio e o texto do endereço", () => {
    const [moved] = moveLocationPin([paulista], 0, -23.6, -46.7, BOUNDS);
    expect(moved).toMatchObject({
      key: "custom_-23.600000_-46.700000",
      radius: 5,
      address_string: paulista.address_string,
    });
  });

  test("o raio padrão respeita o máximo configurado", () => {
    expect(moveLocationPin([campinas], 0, -22.9, -47.06, { min: 1, max: 10 })[0]?.radius).toBe(10);
  });

  test("os outros locais não mudam", () => {
    expect(moveLocationPin([campinas, paulista], 1, -23.6, -46.7, BOUNDS)[0]).toEqual(campinas);
  });

  test("depois de mover o pino, o raio edita pela chave nova", () => {
    const moved = moveLocationPin([campinas], 0, -22.9, -47.06, BOUNDS);
    const newKey = moved[0]?.key ?? "";
    expect(setLocationRadius(moved, newKey, "9", BOUNDS)[0]?.radius).toBe(9);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test "app/(admin)/marketing/components/location-selection.test.ts"`
Expected: FAIL; o módulo `./location-selection` não existe ("Cannot find module").

- [ ] **Step 3: Write minimal implementation**

Crie `app/(admin)/marketing/components/location-selection.ts`:

```ts
import {
  DEFAULT_CITY_RADIUS_KM,
  applyDefaultBrazilLocationRule,
  isRadiusGeoLocation,
  type SelectedGeoLocation,
} from "@/lib/meta-business/geo-targeting-types";

/** Inclusive radius range, in km, the location editor accepts. */
export type RadiusBounds = { min: number; max: number };

function clampRadius(value: number, bounds: RadiusBounds): number {
  return Math.min(bounds.max, Math.max(bounds.min, value));
}

/**
 * Appends an already-normalized location. Same Brazil rule as the customer app: the country
 * default leaves the list as soon as a specific place is in it.
 */
export function addSelectedLocation(
  locations: SelectedGeoLocation[],
  location: SelectedGeoLocation,
): SelectedGeoLocation[] {
  return applyDefaultBrazilLocationRule([...locations, location]);
}

/** Removes by key. Removing the last specific place brings the Brazil default back. */
export function removeSelectedLocation(
  locations: SelectedGeoLocation[],
  key: string,
): { locations: SelectedGeoLocation[]; removedIndex: number } {
  return {
    locations: applyDefaultBrazilLocationRule(
      locations.filter((location) => location.key !== key),
    ),
    removedIndex: locations.findIndex((location) => location.key === key),
  };
}

/** The removed card collapses; cards after it shift up one position. */
export function expandedIndexAfterRemoval(
  current: number | null,
  removedIndex: number,
): number | null {
  if (current === null || removedIndex < 0) return current;
  if (removedIndex === current) return null;
  return removedIndex < current ? current - 1 : current;
}

/**
 * Radius typed in the input or picked on the slider. Only address/place locations carry a radius
 * (Meta resolves the boundary of keyed ones); empty, zero, negative or non-numeric input is ignored.
 */
export function setLocationRadius(
  locations: SelectedGeoLocation[],
  key: string,
  rawValue: string,
  bounds: RadiusBounds,
): SelectedGeoLocation[] {
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return locations;

  return locations.map((location) =>
    location.key === key && isRadiusGeoLocation(location)
      ? { ...location, radius: clampRadius(parsed, bounds), distance_unit: "kilometer" as const }
      : location,
  );
}

/** The ± buttons: one km at a time, starting from the default when no radius was set yet. */
export function stepLocationRadius(
  locations: SelectedGeoLocation[],
  key: string,
  delta: number,
  bounds: RadiusBounds,
): SelectedGeoLocation[] {
  return locations.map((location) =>
    location.key === key && isRadiusGeoLocation(location)
      ? {
          ...location,
          radius: clampRadius((location.radius ?? DEFAULT_CITY_RADIUS_KM) + delta, bounds),
          distance_unit: "kilometer" as const,
        }
      : location,
  );
}

/**
 * Dragging the map pin turns the location into a custom address at the new point, keeping its
 * radius (or the default one). The key changes, so later radius edits must use the new key.
 */
export function moveLocationPin(
  locations: SelectedGeoLocation[],
  index: number,
  latitude: number,
  longitude: number,
  bounds: RadiusBounds,
): SelectedGeoLocation[] {
  const key = `custom_${latitude.toFixed(6)}_${longitude.toFixed(6)}`;

  return locations.map((location, position) =>
    position === index
      ? {
          ...location,
          key,
          type: "custom_location" as const,
          latitude,
          longitude,
          address_string: location.address_string ?? location.name,
          radius: location.radius ?? clampRadius(DEFAULT_CITY_RADIUS_KM, bounds),
          distance_unit: "kilometer" as const,
        }
      : location,
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test "app/(admin)/marketing/components/location-selection.test.ts"`
Expected: PASS em todos os testes, 0 fail.

- [ ] **Step 5: Gates**

Run: `bunx eslint "app/(admin)/marketing/components/location-selection.ts" "app/(admin)/marketing/components/location-selection.test.ts"` → exit 0.
Run: `bunx tsc --noEmit -p . 2>&1 | grep "location-selection"` → sem saída.

- [ ] **Step 6: Commit**

```bash
git add "app/(admin)/marketing/components/location-selection.ts" "app/(admin)/marketing/components/location-selection.test.ts"
git commit -m "$(cat <<'EOF'
refactor(marketing): operações puras da lista de localizações

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Busca inline, handlers puros e Esc no `LocationTargetingSection`

**Files:**
- Modify: `app/(admin)/marketing/components/location-targeting-section.tsx`: imports (linhas 3–61); handlers (linhas 277–516); bloco `<Popover>…</Popover>` (linhas 559–716).
- Test: sem teste unitário novo (não há DOM no `bun test` deste repo). A lógica de lista está coberta pela Task 1, e o comportamento visual e de teclado é provado pela verificação no agent-browser (passos 1 e 5–12).

**Interfaces:**
- Consumes (Task 1): `addSelectedLocation`, `removeSelectedLocation`, `expandedIndexAfterRemoval`, `setLocationRadius`, `stepLocationRadius`, `moveLocationPin`, `type RadiusBounds` de `./location-selection`.
- Produces: o mesmo componente `LocationTargetingSection` com as mesmas props (`LocationTargetingSectionProps` não muda). O botão de busca ganha `aria-expanded` e `aria-controls`; o painel é um `<div id={useId()}>`. A receita de verificação depende desses dois atributos.

- [ ] **Step 1: Reproduzir o bug antes de editar (UI, base atual)**

Siga a "Receita de verificação na UI".
Caso A até a revisão → clique no "Editar" da linha "Localização" → no sheet, clique no botão de busca → `agent-browser keyboard type "Avenida Paulista"` → espere 2 s.
- Rode a checagem "overlay Radix com portal" → esperado `covered`.
- `agent-browser screenshot "$EVID/01-antes-busca-coberta-pelo-sheet.png"`.
- Feche o sheet em "Cancelar". Não edite nada ainda.

- [ ] **Step 2: Trocar os imports**

Em `location-targeting-section.tsx`:
- a linha `import { useEffect, useMemo, useState } from "react";` vira `import { useEffect, useId, useMemo, useRef, useState } from "react";`;
- apague a linha `import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";`;
- no import de `@/lib/meta-business/geo-targeting-types`, remova `applyDefaultBrazilLocationRule` (passa a ser usado só em `location-selection.ts`);
- acrescente, depois do import de `../hooks/use-browser-geolocation`:

```ts
import {
  addSelectedLocation,
  expandedIndexAfterRemoval,
  moveLocationPin,
  removeSelectedLocation,
  setLocationRadius,
  stepLocationRadius,
  type RadiusBounds,
} from "./location-selection";
```

- [ ] **Step 3: Estado do painel e Esc**

Logo depois de `const [placeDetailsError, setPlaceDetailsError] = useState<string | null>(null);`, acrescente:

```tsx
  const searchPanelId = useId();
  const searchPanelRef = useRef<HTMLDivElement>(null);
  const searchTriggerRef = useRef<HTMLButtonElement>(null);
```

Troque

```tsx
  const clampRadius = (value: number) =>
    Math.min(maxRadiusKm, Math.max(minRadiusKm, value));
```

por

```tsx
  const radiusBounds: RadiusBounds = { min: minRadiusKm, max: maxRadiusKm };
  const clampRadius = (value: number) =>
    Math.min(maxRadiusKm, Math.max(minRadiusKm, value));
```

Depois do `useEffect` que zera `expandedIndex` (o que compara com `selectedLocations.length`), acrescente:

```tsx
  // Radix sheets and dialogs listen for Escape in the document's capture phase, before any handler
  // inside this panel runs. The portaled popover used to absorb that Escape as its own layer; the
  // inline panel does not, so catch it one step earlier (window capture) and close only the search.
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const panel = searchPanelRef.current;
      if (!panel || !(event.target instanceof Node) || !panel.contains(event.target)) return;
      event.stopPropagation();
      event.preventDefault();
      setOpen(false);
      searchTriggerRef.current?.focus();
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [open]);
```

- [ ] **Step 4: Handlers chamam as funções puras**

Dentro de `commitSelectedLocation`, troque

```tsx
    const nextLocations = applyDefaultBrazilLocationRule([
      ...selectedLocations,
      normalizedLocation,
    ]);
```

por

```tsx
    const nextLocations = addSelectedLocation(selectedLocations, normalizedLocation);
```

O resto de `commitSelectedLocation` (checagem de coordenadas antes, `setExpandedIndex`, limpar termo e token, `setOpen(false)`) fica igual.

Troque o corpo inteiro de `handleRemoveLocation`, `handleRadiusChange`, `handleRadiusStep` e `handleLocationDrag` por:

```tsx
  const handleRemoveLocation = (locationKey: string) => {
    const { locations, removedIndex } = removeSelectedLocation(
      selectedLocations,
      locationKey,
    );
    onLocationsChange(locations);
    setExpandedIndex((current) => expandedIndexAfterRemoval(current, removedIndex));
  };

  const handleRadiusChange = (locationKey: string, value: string) => {
    onLocationsChange(
      setLocationRadius(selectedLocations, locationKey, value, radiusBounds),
    );
  };

  const handleRadiusStep = (locationKey: string, delta: number) => {
    onLocationsChange(
      stepLocationRadius(selectedLocations, locationKey, delta, radiusBounds),
    );
  };

  const handleLocationDrag = (
    locationIndex: number,
    latitude: number,
    longitude: number,
  ) => {
    onLocationsChange(
      moveLocationPin(
        selectedLocations,
        locationIndex,
        latitude,
        longitude,
        radiusBounds,
      ),
    );
  };
```

O `clampRadius` local continua em uso no `Slider` (`value={[location.radius ?? clampRadius(DEFAULT_CITY_RADIUS_KM)]}`). Não remova.

- [ ] **Step 5: Painel inline no lugar do Popover**

Substitua o bloco inteiro, de `<Popover open={open} onOpenChange={setOpen}>` até o `</Popover>` correspondente, por:

```tsx
      <div className="space-y-2">
        <Button
          ref={searchTriggerRef}
          type="button"
          variant="outline"
          disabled={disabled || !accountId}
          aria-expanded={open}
          aria-controls={searchPanelId}
          onClick={() => setOpen((current) => !current)}
          className={cn(
            "h-auto w-full justify-between rounded-xl border-border/70 bg-background px-3 py-3 text-left hover:bg-accent/40",
            open && "border-primary/40 bg-primary/5",
            !accountId && "text-muted-foreground",
          )}
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Search className="size-4" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {accountId
                  ? summarizeLocations(selectedLocations, t)
                  : t("selectAccountFirst")}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {accountId ? t("searchHint") : t("searchDisabledHint")}
              </p>
            </div>
          </div>
          <MapPin className="size-4 shrink-0 text-muted-foreground" />
        </Button>
        {open ? (
          <div
            ref={searchPanelRef}
            id={searchPanelId}
            className="overflow-hidden rounded-xl border border-border/60 bg-popover shadow-sm"
          >
            <Command shouldFilter={false}>
              <CommandInput
                autoFocus
                value={searchTerm}
                onValueChange={handleSearchTermChange}
                placeholder={t("searchPlaceholder")}
              />
              <CommandList>
                {/* the CommandList children stay exactly as they were inside PopoverContent */}
              </CommandList>
            </Command>
          </div>
        ) : null}
      </div>
```

Dentro de `<CommandList>`, **mova sem alterar** todo o conteúdo que hoje está entre `<CommandList>` e `</CommandList>` no `PopoverContent`: linhas 599–712 do arquivo original, de `{error ? (` até o `) : null}` que fecha o bloco de resultados. Isso inclui:
- o bloco `error` (continua mostrando `error.message`);
- `placeDetailsError`;
- "Buscando…" e estado vazio;
- `CommandEmpty`;
- `groupedMetaResults.map(...)` e o grupo `googleResults`.

Apague o comentário-guia `{/* the CommandList children … */}` depois de mover. O resultado não pode ter nenhum `Popover*` no arquivo.

- [ ] **Step 6: Gates estáticos**

Run: `grep -n "Popover\|applyDefaultBrazilLocationRule" "app/(admin)/marketing/components/location-targeting-section.tsx"` → sem saída.
Run: `bunx eslint "app/(admin)/marketing/components/location-targeting-section.tsx"` → exit 0.
Run: `bunx tsc --noEmit -p . 2>&1 | grep -E "location-targeting-section|location-selection|adset-(create|edit)-dialog|ai-campaign-client"` → sem saída.
Run: `bun test "app/(admin)/marketing/components/location-selection.test.ts"` → PASS.

- [ ] **Step 7: Verificação na UI — sheet de revisão (caso A)**

Receita de verificação, caso A até a revisão. Guarde `agent-browser eval "document.body.innerText.match(/Localização[^\n]*\n[^\n]*/)?.[0]"` (linha inicial da revisão). Clique em "Editar" na linha "Localização".
1. Clique no botão de busca (o que tem `aria-controls`) → `agent-browser keyboard type "Avenida Paulista"` → espere 2 s. Checagem "painel inline" → esperado `on-top`. `screenshot "$EVID/02-depois-busca-inline-visivel.png"`.
2. Clique num resultado do grupo do Google (endereço). Esperado: o painel fecha, o endereço aparece como card expandido com mapa e raio. `screenshot "$EVID/03-endereco-adicionado.png"`.
3. Raio:
   - no campo numérico do card, `fill` com `25`;
   - clique uma vez no botão "+" (aria-label de aumentar raio) → esperado 26;
   - clique uma vez no "−" → esperado 25;
   - arraste o slider com `agent-browser mouse` (down, move, up) até mudar o valor.

   Leia o valor do campo depois de cada ação com `agent-browser get value <sel>`. `screenshot "$EVID/04-raio-editado.png"`.
4. Remova todos os cards pelo X até sobrar um só: esperado o card "Brazil · PAÍS". `screenshot "$EVID/05-brasil-volta-ao-remover-tudo.png"`.
5. Busque `Campinas` e escolha o resultado de cidade (grupo "Cidade"). Esperado: "Brazil" sai e fica só Campinas. `screenshot "$EVID/06-cidade-tira-o-brasil.png"`.
6. Erro dentro do painel: rode `agent-browser network route "**/api/geo/google-places/details*" --abort`, que é a rota do `fetchGooglePlaceDetails` (`app/(admin)/marketing/hooks/use-location-search.ts:199`). Busque um endereço do Google e clique nele. Esperado: mensagem de erro dentro do painel, nada adicionado, painel aberto. `screenshot "$EVID/07-erro-detalhes-no-painel.png"`. Depois `agent-browser network unroute`.
7. Esc: com o painel aberto e o foco no campo de busca, `agent-browser press Escape`. Esperado: painel fechado, **sheet ainda aberto** e a lista intacta. Confira com `snapshot` que o título "Localização" do sheet continua. `screenshot "$EVID/08-esc-fecha-so-a-busca.png"`.
8. Clique em "Salvar". Esperado: a linha "Localização" da revisão mostra o novo conteúdo (Campinas, e o endereço, se ainda estiver na lista). `screenshot "$EVID/09-salvar-atualiza-a-revisao.png"`.
9. Reabra "Editar", remova um local, clique em "Cancelar" e reabra. Esperado: a lista é a salva no passo 8, e a linha da revisão não mudou. `screenshot "$EVID/10-cancelar-descarta.png"`.

- [ ] **Step 8: Verificação na UI — passo "Onde anunciar?" (caso B)**

Caso B até o passo "Onde anunciar?". Busque `Florianópolis`, escolha a cidade. Checagem "painel inline" antes de escolher → `on-top`. Clique em "Continuar": esperado avançar para a revisão, com a linha "Localização" = Florianópolis. `screenshot "$EVID/11-onde-anunciar-busca-e-continua.png"`.

- [ ] **Step 9: Verificação na UI — celular**

`agent-browser set viewport 375 812`. Caso A na revisão → "Editar" Localização → abra a busca e digite `Avenida Paulista`. Checagem "sem scroll horizontal" → `true`; checagem "painel inline" → `on-top`. `screenshot "$EVID/12-celular-sheet-localizacao.png"`. Volte com `agent-browser set viewport 1440 900`.

- [ ] **Step 10: Verificação na UI — diálogo de editar conjunto (melhor esforço)**

Abra `http://localhost:3006/users/ef82046f-3489-430a-8bdd-c12c3e535d3d?tab=marketing`. Se houver campanha com conjunto listada, abra a edição do conjunto e a seção de localização: busca abre inline (`on-top`), Esc fecha só o painel e o diálogo continua aberto. `screenshot "$EVID/13-dialogo-conjunto-busca-inline.png"`. **Não salve** o diálogo: feche em Cancelar. Se não houver campanha ou conjunto, registre "não exercitado: sem conjunto na staging" no relatório. Não é bloqueio.

- [ ] **Step 11: Suíte completa**

Run: `FRONTEND_ROOT=D:/automatize-marketing/automatize-frontend bun test 2>&1 | tail -15`
Expected: 8 fail, e exatamente as 8 da baseline (Global Constraints); pass ≥ 1497 + os testes da Task 1.

- [ ] **Step 12: Commit**

```bash
git add "app/(admin)/marketing/components/location-targeting-section.tsx"
git commit -m "$(cat <<'EOF'
fix(marketing): busca de localização inline para não abrir coberta pelo sheet

A busca do LocationTargetingSection era um Popover com portal em z-50 e abria
coberta pelo sheet de revisão (z-90) do fluxo de IA: o operador não conseguia
adicionar nem trocar endereços. Passa a ser um painel inline, como no app do
cliente; Esc dentro dele fecha só a busca, sem descartar o rascunho do sheet.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Overlays com portal por cima dos sheets de revisão

**Files:**
- Modify: `app/globals.css` (dentro do `@layer base { … }`, que começa na linha 133)
- Modify: `components/ui/popover.tsx:34-35` (as duas strings de classe do `PopoverContent`)
- Test: `tests/review-sheet-stacking.test.ts`

**Interfaces:**
- Consumes: `ReviewEditSheet` em `app/(admin)/marketing/ai/flow-chrome.tsx` (o `SheetContent` usa `className="z-[90] …"`).
- Produces: todo `[data-radix-popper-content-wrapper]` (Popover, Select em modo popper, DropdownMenu) com `z-index: 100`, e `PopoverContent` com `z-[100] pointer-events-auto`.

- [ ] **Step 1: Reproduzir antes de editar (UI)**

Receita de verificação, caso A até a revisão.
- Linha "Período" → "Editar". Abra o seletor de datas (o `Popover` do calendário) e rode a checagem "overlay Radix com portal". `screenshot "$EVID/20-antes-periodo-calendario.png"`. Esperado `covered`.
- Abra também um dos `Select` de horário do mesmo sheet e rode a checagem de novo. Esperado `covered`. `screenshot "$EVID/21-antes-periodo-select.png"`.
- Cancele. Na linha do CTA (botão de ação), clique em "Editar", abra o `Select` e rode a checagem. `screenshot "$EVID/22-antes-cta-select.png"`. Esperado `covered`.

Se algum der `on-top` já na base, anote no relatório. Isso não bloqueia, e o teste do Step 2 continua valendo como contrato.

- [ ] **Step 2: Write the failing test**

Crie `tests/review-sheet-stacking.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readSource(relativePath: string) {
  return readFileSync(join(repositoryRoot, relativePath), "utf8");
}

/** z-index of the review sheet (`ReviewEditSheet` → `SheetContent className="z-[N] …"`). */
function reviewSheetZIndex(): number {
  const source = readSource("app/(admin)/marketing/ai/flow-chrome.tsx");
  const match = source.match(/<SheetContent[\s\S]*?className="[^"]*\bz-\[(\d+)\]/);
  assert.ok(match, "ReviewEditSheet deveria declarar z-[N] no SheetContent");
  return Number(match[1]);
}

test("o wrapper dos overlays Radix fica acima do sheet de revisão", () => {
  const css = readSource("app/globals.css");
  const match = css.match(/\[data-radix-popper-content-wrapper\]\s*\{[^}]*z-index:\s*(\d+)/);
  assert.ok(match, "globals.css deveria fixar o z-index de [data-radix-popper-content-wrapper]");
  assert.ok(
    Number(match[1]) > reviewSheetZIndex(),
    `wrapper z-index ${match[1]} precisa ser maior que o do sheet (${reviewSheetZIndex()})`,
  );
});

test("o PopoverContent fica acima do sheet de revisão e recebe cliques", () => {
  const source = readSource("components/ui/popover.tsx");
  assert.doesNotMatch(source, /\bz-50\b/, "PopoverContent não pode voltar para z-50");
  const zValues = [...source.matchAll(/\bz-\[(\d+)\]/g)].map((match) => Number(match[1]));
  assert.ok(zValues.length > 0, "PopoverContent deveria declarar z-[N]");
  for (const value of zValues) {
    assert.ok(value > reviewSheetZIndex(), `z-[${value}] precisa ser maior que o do sheet`);
  }
  assert.match(source, /\bpointer-events-auto\b/);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test tests/review-sheet-stacking.test.ts`
Expected: FAIL nos dois testes ("globals.css deveria fixar…" e "PopoverContent não pode voltar para z-50").

- [ ] **Step 4: Write minimal implementation**

Em `app/globals.css`, dentro do `@layer base { … }` (linha 133), logo depois da regra `body { … }`, acrescente:

```css
  /* Radix positions portaled menus with a transformed wrapper, so z-index on
     the inner content cannot escape. Keep them above review sheets (z-90). */
  [data-radix-popper-content-wrapper] {
    z-index: 100;
  }
```

Em `components/ui/popover.tsx`, nas duas strings de classe do `PopoverContent`:
- a primeira começa com `"z-50 w-72 rounded-md border …"` e passa a começar com `"z-[100] w-72 rounded-md border …"`, com `pointer-events-auto` acrescentado logo depois de `outline-none`;
- na segunda, que termina em `"… duration-100 z-50 w-72 origin-(--transform-origin) outline-hidden"`, troque `z-50` por `z-[100]`.

Nada mais muda no arquivo.

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/review-sheet-stacking.test.ts`
Expected: PASS nos 2 testes.

- [ ] **Step 6: Verificação na UI — depois**

Repita o Step 1. As três checagens esperam `on-top`. Screenshots:
- `$EVID/23-depois-periodo-calendario.png`
- `$EVID/24-depois-periodo-select.png`
- `$EVID/25-depois-cta-select.png`

Escolha uma data no calendário e uma opção no select do CTA para provar que o clique pega. Depois clique em **Cancelar**, porque aqui não precisa salvar.

Confira também que a busca de localização (Task 2) continua `on-top` no sheet de Localização (`$EVID/26-localizacao-continua-ok.png`), e que um popover **fora** de sheet continua abrindo normal. Use a seleção de ad account ou outro popover do hub `/users/<id>?tab=marketing` (`$EVID/27-popover-fora-do-sheet.png`).

- [ ] **Step 7: Gates**

Run: `bunx eslint components/ui/popover.tsx tests/review-sheet-stacking.test.ts` → exit 0.
Run: `bunx tsc --noEmit -p . 2>&1 | grep -E "popover|review-sheet-stacking"` → sem saída.
Run: `FRONTEND_ROOT=D:/automatize-marketing/automatize-frontend bun test 2>&1 | tail -15` → as mesmas 8 falhas da baseline, nenhuma nova.

- [ ] **Step 8: Commit**

```bash
git add app/globals.css components/ui/popover.tsx tests/review-sheet-stacking.test.ts
git commit -m "$(cat <<'EOF'
fix(marketing): overlays com portal acima dos sheets de revisão da IA

Calendário e selects do Período e o select do CTA abriam em z-50, cobertos
pelo sheet de revisão (z-90). Mesmo ajuste do app do cliente: wrapper do
Radix e PopoverContent em z-index 100, com teste de contrato.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Resumo de geo compartilhado e linha "Localização" só leitura no molde

**Files:**
- Modify: `app/(admin)/marketing/ai/review-summaries.ts` (nova função exportada no fim do arquivo + import de tipo no topo)
- Modify: `app/(admin)/marketing/ai/ai-review-card.tsx:218-239` (apagar `AudienceReviewAdSet`, se ficar sem uso, e `audienceGeoLabel`; usar `geoSummaryLine`)
- Modify: `app/(admin)/marketing/ai/ai-campaign-client.tsx:143` (import) e `:2001-2009` (linha "Localização")
- Test: `app/(admin)/marketing/ai/review-summaries.test.ts`

**Interfaces:**
- Consumes: `type ReviewSummary` de `@/lib/meta-business/marketing/ai-creation`, que é `ReviewSummary["audience"]["geo"]` com `{ customLocations: number; cities: number; regions: number; countries: number; locations?: Array<{ label: string; radiusKm?: number }> }`. Consome também o estado `plannedAudience: ReviewSummary["audience"] | undefined` em `ai-campaign-client.tsx:384`.
- Produces: `geoSummaryLine(geo: ReviewSummary["audience"]["geo"] | undefined): string`.

- [ ] **Step 1: Write the failing test**

Em `app/(admin)/marketing/ai/review-summaries.test.ts`, troque o import de `./review-summaries` por `import { geoSummaryLine, scheduleSummary } from "./review-summaries";` e acrescente no fim do arquivo:

```ts
describe("geoSummaryLine", () => {
  const zero = { customLocations: 0, cities: 0, regions: 0, countries: 0 };

  test("locais nomeados, com e sem raio", () => {
    expect(
      geoSummaryLine({
        ...zero,
        customLocations: 1,
        cities: 1,
        locations: [{ label: "Av. Paulista, 1000", radiusKm: 5 }, { label: "Campinas" }],
      }),
    ).toBe("Av. Paulista, 1000 · 5 km · Campinas");
  });

  test("sem nomes, cai nas contagens", () => {
    expect(geoSummaryLine({ customLocations: 2, cities: 1, regions: 0, countries: 1 })).toBe(
      "2 endereço(s) + 1 cidade(s) + 1 país(es)",
    );
    expect(geoSummaryLine({ ...zero, regions: 3 })).toBe("3 região(ões)");
  });

  test("lista de nomes vazia também cai nas contagens", () => {
    expect(geoSummaryLine({ ...zero, cities: 2, locations: [] })).toBe("2 cidade(s)");
  });

  test("nada segmentado ou plano ausente", () => {
    expect(geoSummaryLine(zero)).toBe("não especificada");
    expect(geoSummaryLine(undefined)).toBe("não especificada");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test "app/(admin)/marketing/ai/review-summaries.test.ts"`
Expected: FAIL; `geoSummaryLine` não é exportado ("Export named 'geoSummaryLine' not found" ou `geoSummaryLine is not a function`).

- [ ] **Step 3: Write minimal implementation**

Em `app/(admin)/marketing/ai/review-summaries.ts`, acrescente ao bloco de imports do topo:

```ts
import type { ReviewSummary } from "@/lib/meta-business/marketing/ai-creation";
```

E no fim do arquivo:

```ts
/**
 * One line for where the ads run: the named places (with the radius when there is one), or the
 * counts when the plan cannot name them. Shared by the effective-audience block and the read-only
 * location row of the mold path.
 */
export function geoSummaryLine(geo: ReviewSummary["audience"]["geo"] | undefined): string {
  if (!geo) return "não especificada";
  if (geo.locations?.length) {
    return geo.locations
      .map((location) =>
        location.radiusKm != null
          ? `${location.label} · ${location.radiusKm} km`
          : location.label,
      )
      .join(" · ");
  }
  return (
    [
      geo.customLocations ? `${geo.customLocations} endereço(s)` : "",
      geo.cities ? `${geo.cities} cidade(s)` : "",
      geo.regions ? `${geo.regions} região(ões)` : "",
      geo.countries ? `${geo.countries} país(es)` : "",
    ]
      .filter(Boolean)
      .join(" + ") || "não especificada"
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test "app/(admin)/marketing/ai/review-summaries.test.ts"`
Expected: PASS (os testes antigos de `scheduleSummary` e os 4 novos).

- [ ] **Step 5: `ReviewEffectiveAudience` usa a função compartilhada**

Em `app/(admin)/marketing/ai/ai-review-card.tsx`:
- apague a função `audienceGeoLabel`, da linha 220 até o `}` que a fecha;
- troque `{audienceGeoLabel(adSet.geo)}` por `{geoSummaryLine(adSet.geo)}`;
- acrescente `import { geoSummaryLine } from "./review-summaries";` junto dos imports locais (`./…`);
- se `type AudienceReviewAdSet = …` (linha 218) ficar sem uso depois disso, apague-o também. Confira com `grep -n "AudienceReviewAdSet" "app/(admin)/marketing/ai/ai-review-card.tsx"`.

O texto exibido não muda: a função é a mesma, só mudou de lugar.

- [ ] **Step 6: Linha "Localização" só leitura no molde**

Em `app/(admin)/marketing/ai/ai-campaign-client.tsx`:
- linha 143: `import { scheduleSummary } from "./review-summaries";` vira `import { geoSummaryLine, scheduleSummary } from "./review-summaries";`;
- troque o bloco

```tsx
              {!hasMold ? (
                <ReviewRow
                  label="Localização"
                  value={locationLabel}
                  onEdit={openLocationSheet}
                  disabled={phase === "publishing"}
                  invalid={effectiveLocations.length === 0}
                />
              ) : null}
```

por

```tsx
              {hasMold ? (
                // The mold inherits geo from the base ad (same as the customer app): shown, not edited.
                <ReviewRow label="Localização" value={geoSummaryLine(plannedAudience?.geo)} />
              ) : (
                <ReviewRow
                  label="Localização"
                  value={locationLabel}
                  onEdit={openLocationSheet}
                  disabled={phase === "publishing"}
                  invalid={effectiveLocations.length === 0}
                />
              )}
```

- [ ] **Step 7: Gates**

Run: `bunx eslint "app/(admin)/marketing/ai/review-summaries.ts" "app/(admin)/marketing/ai/review-summaries.test.ts" "app/(admin)/marketing/ai/ai-review-card.tsx" "app/(admin)/marketing/ai/ai-campaign-client.tsx"` → exit 0.
Run: `bunx tsc --noEmit -p . 2>&1 | grep -E "review-summaries|ai-review-card|ai-campaign-client"` → sem saída.
Run: `FRONTEND_ROOT=D:/automatize-marketing/automatize-frontend bun test 2>&1 | tail -15` → as mesmas 8 falhas da baseline, nenhuma nova.

- [ ] **Step 8: Verificação na UI — caminho do molde**

Receita de verificação, caso M:
1. Objetivo "Vendas no site", orçamento pronto, identidade se aparecer.
2. Na mídia, use o que o molde oferecer, ou o upload de `$S/verify/sample.png`.
3. Link de destino `https://example.com`, se for pedido.
4. Siga até a revisão sem clicar em "Criar pixel". Com molde, o passo de pixel não aparece.

O que conferir na revisão:
- a linha "Localização" aparece, **sem** botão "Editar", com o mesmo texto do "Localização:" do bloco "Segmentação efetiva por conjunto";
- as linhas dos outros campos continuam como antes.

`screenshot "$EVID/30-molde-localizacao-so-leitura.png"`.

Se o fluxo cair no caminho sem molde (sem anúncio vencedor na conta), registre "molde não disponível na staging para act_763911788291358" e passe para o plano B aprovado no spec:
- use `APP_ENV=prod` **só leitura**. O controlador sobe o servidor de prod; peça isso no relatório como NEEDS_CONTEXT, não suba você;
- se ainda assim não houver molde, a linha fica coberta só pelo teste de `geoSummaryLine` e pelo type-check. Anote no relatório.

Nos dois ambientes, **nunca** clique em "Publicar campanha" nem em "Criar pixel".

Confira também o caminho sem molde (caso A): a linha "Localização" continua com "Editar" e abre o sheet. `screenshot "$EVID/31-sem-molde-localizacao-editavel.png"`.

- [ ] **Step 9: Commit**

```bash
git add "app/(admin)/marketing/ai/review-summaries.ts" "app/(admin)/marketing/ai/review-summaries.test.ts" "app/(admin)/marketing/ai/ai-review-card.tsx" "app/(admin)/marketing/ai/ai-campaign-client.tsx"
git commit -m "$(cat <<'EOF'
feat(marketing): localização herdada do molde aparece só leitura na revisão

Igual ao app do cliente: no caminho do molde a geo vem do anúncio base e não é
editável, mas passa a aparecer na revisão. O resumo de geo sai do
ai-review-card para review-summaries (geoSummaryLine) e é usado pelos dois.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```
