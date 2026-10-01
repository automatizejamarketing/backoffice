# Localização editável no "Criar campanha com IA" do backoffice — design

Data: 2026-09-30 · Branch: `fix/ai-location-edit` · Repositório: `backoffice` (só ele)

## Problema

Quando o operador do backoffice cria uma campanha com IA para um cliente, ele não consegue
adicionar, trocar ou excluir endereços e raios na Localização. O comportamento desejado é o do
app do cliente (`automatize-frontend`): adicionar, alterar e excluir endereços e raios à vontade.

### Causa raiz (lida no código)

1. **A busca abre por baixo do sheet.** A busca do `LocationTargetingSection` é um Radix
   `Popover` com portal para o `body` e `z-50` (`components/ui/popover.tsx:34`). O sheet de
   revisão (`ReviewEditSheet`, `app/(admin)/marketing/ai/flow-chrome.tsx:270`) fica em `z-[90]`.
   O Radix copia o z-index do conteúdo para o wrapper posicionado, então a lista de resultados
   abre coberta pelo sheet e o clique parece não fazer nada. O guard `isPortaledOverlayEvent`
   só impede o sheet de fechar; ele não resolve o empilhamento.
2. **O mesmo empilhamento vale para os outros overlays com portal dentro dos sheets de revisão**
   (calendário em `Popover` e `Select`s do Período, `Select` do CTA). Não há override de
   `[data-radix-popper-content-wrapper]` no `app/globals.css` do backoffice.
3. O app do cliente corrigiu exatamente isso no commit `b5e9c7df` (15/08/2026): painel de busca
   inline sem portal no `location-targeting-section.tsx`, `PopoverContent` em
   `z-[100] pointer-events-auto` e `[data-radix-popper-content-wrapper] { z-index: 100 }` no
   `globals.css`. A cópia do backoffice nunca recebeu essa correção.

O "Brazil · PAÍS" sozinho do relato vem da regra `applyDefaultBrazilLocationRule`: remover o
último local recoloca o Brasil. É o mesmo comportamento do app e **fica como está** (ver
Regra do Brasil).

## Objetivo e critérios de sucesso

No sheet "Localização" da revisão e no passo "Onde anunciar?" do fluxo de IA, o operador:

- busca e adiciona endereços, estabelecimentos, cidades, estados e países (a lista de resultados
  aparece visível e clicável);
- remove qualquer local;
- muda o raio de endereços e estabelecimentos por slider, botões ± e campo numérico (1–80 km);
- arrasta o pino no mapa;
- em **Salvar**, vê a nova lista na linha "Localização" da revisão, e ela é a que vai no payload
  do `/fallback`; em **Cancelar** ou **X**, a alteração é descartada.

Também: os overlays com portal dos sheets de Período e CTA abrem por cima do sheet; no caminho
do molde, a linha "Localização" aparece só para leitura.

## Decisões tomadas

| Tema | Decisão |
|---|---|
| Abordagem | **A**: portar a correção do app inteira (painel inline + ajuste global de empilhamento). |
| Caminho do molde | **Paridade com o app**: linha "Localização" só leitura, sem editar. O publish continua herdando a geo do anúncio base. O motor `ai-creation` não muda. |
| Regra do Brasil | **Igual ao app**, documentada neste spec e coberta por testes. |
| Escopo | Só `backoffice`. Sem mudança no frontend, no motor espelhado (`lib/meta-business/marketing/ai-creation/`), no banco ou em rotas de API. |

## Design

### Componentes e arquivos

| Unidade | Mudança |
|---|---|
| `app/(admin)/marketing/components/location-selection.ts` (novo) | Funções puras com as operações de lista, extraídas dos handlers do componente **sem mudar comportamento** (`bounds = { min: number; max: number }`): `addSelectedLocation(list, location): SelectedGeoLocation[]`; `removeSelectedLocation(list, key): { locations: SelectedGeoLocation[]; removedIndex: number }`; `expandedIndexAfterRemoval(current: number \| null, removedIndex: number): number \| null`; `setLocationRadius(list, key, rawValue: string, bounds): SelectedGeoLocation[]`; `stepLocationRadius(list, key, delta: number, bounds): SelectedGeoLocation[]`; `moveLocationPin(list, index, latitude, longitude, bounds): SelectedGeoLocation[]`. A checagem "local com raio sem coordenadas → erro" continua no componente, antes de chamar `addSelectedLocation`. |
| `app/(admin)/marketing/components/location-targeting-section.tsx` | (a) Troca `Popover`/`PopoverTrigger`/`PopoverContent` pelo painel inline do app: o botão de busca alterna `open` com `aria-expanded`/`aria-controls`; logo abaixo, quando `open`, um `<div>` com `Command` + `CommandInput autoFocus` e a mesma lista de resultados de hoje. O `id` do painel vem de `useId()`. (b) Os handlers passam a chamar `location-selection.ts`. (c) Esc dentro do painel fecha só o painel (ver "Esc dentro da busca"). Ficam como estão as diferenças próprias do backoffice: `userId` na busca e nos detalhes do Google, prop `required`, hook de i18n `useLocationTargetingT`, mensagem de erro detalhada da busca. |
| `app/globals.css` | `[data-radix-popper-content-wrapper] { z-index: 200 !important; }`, com o comentário do app adaptado para citar os dois sheets de revisão (z-90 e z-110). `!important` e 200 porque o Radix copia o z-index do conteúdo inline no wrapper, o sheet de público avançado é z-110 e 200 é a mesma camada do app. |
| `components/ui/popover.tsx` | `PopoverContent`: `z-50` → `z-[200]` (mesma camada do wrapper) e `pointer-events-auto` (nas duas strings de classe onde `z-50` aparece). |
| `app/(admin)/marketing/ai/review-summaries.ts` | Recebe `geoSummaryLine(geo)`: a função privada `audienceGeoLabel` de `ai-review-card.tsx` extraída sem mudar o texto, e aceitando `undefined`. O bloco "Segmentação efetiva por conjunto" (`ReviewEffectiveAudience`) passa a usá-la; a linha nova do molde também. |
| `app/(admin)/marketing/ai/ai-campaign-client.tsx` | A linha "Localização" da revisão passa a aparecer também com molde: `ReviewRow` só leitura (sem `onEdit`), valor `geoSummaryLine(plannedAudience?.geo)` ("não especificada" enquanto não houver plano). Sem molde, fica como hoje (`locationLabel` + editar abrindo o sheet). |

Consumidores do `LocationTargetingSection` que passam a ter o painel inline (igual ao app):
o fluxo de IA (`ai-campaign-client.tsx`, passo "Onde anunciar?" e sheet de revisão),
`adset-create-dialog.tsx` e `adset-edit-dialog.tsx`.

### Comportamento

**Busca**
- Clicar no botão abre o painel logo abaixo, com foco no campo; clicar de novo fecha.
- Sem termo: estado vazio ("digite para buscar"). Com termo: grupos Meta (por tipo) e grupo
  Google (estabelecimentos antes de endereços), como hoje.
- Escolher um resultado adiciona o local, expande o card dele (mapa), limpa o termo, zera o
  token de sessão do Places e fecha o painel.
- Resultado do Google resolve detalhes (`fetchGooglePlaceDetails` com `userId`) antes de entrar;
  sem coordenadas → mensagem "não foi possível obter o endereço" e nada é adicionado.
- Erros continuam dentro do painel: erro da busca, erro de detalhes e "Buscando…".

**Edição da lista (comportamento atual, agora em `location-selection.ts`)**
- `addSelectedLocation`: normaliza (`normalizeSelectedGeoLocation`), anexa ao fim e aplica a
  regra do Brasil. Índice expandido = último.
- `removeSelectedLocation`: remove pela chave e aplica a regra do Brasil. Índice expandido:
  `null` se era o removido, −1 se o removido vinha antes, igual se vinha depois.
- `setLocationRadius`: só para `custom_location` e `place`; valor inteiro > 0, limitado a
  `[min, max]` (padrão 1–80); valor inválido ou ≤ 0 não muda nada; grava `distance_unit:
  "kilometer"`.
- `stepLocationRadius`: `(radius ?? DEFAULT_CITY_RADIUS_KM) + delta`, limitado a `[min, max]`,
  só para `custom_location` e `place`.
- `moveLocationPin`: o local no índice vira `custom_location` com chave
  `custom_<lat.toFixed(6)>_<lng.toFixed(6)>`, `latitude`/`longitude` novos,
  `address_string` = o anterior ou o nome, raio = o anterior ou o padrão limitado,
  `distance_unit: "kilometer"`.

**Regra do Brasil (igual ao app — não muda)**
1. Adicionar um local específico com "Brasil" na lista tira o Brasil.
2. Remover o último local deixa `[Brasil · PAÍS]`.
3. "Brasil" sozinho é uma lista válida para salvar e publicar.

**Sheet de revisão "Localização" (sem mudança de lógica)**
- Abre como rascunho: se `manualLocations` está vazio e há endereços salvos do negócio, usa os
  salvos; senão, `manualLocations`.
- **Salvar** → `setManualLocations(rascunho)`; a linha da revisão (`locationLabel`) e o payload do
  `/fallback` (`locations: effectiveLocations`) refletem a nova lista. Desabilitado só com lista
  vazia.
- **Cancelar** / **X** / fechar → descarta o rascunho.

**Caminho do molde**
- Linha "Localização" só leitura com `geoSummaryLine(plannedAudience?.geo)`; sem botão de editar.

**`geoSummaryLine(geo | undefined)`** (texto idêntico ao `audienceGeoLabel` atual)
- Com `geo.locations` não vazio: `"<label>"` ou `"<label> · <N> km"` por local, unidos por `" · "`.
- Senão, contagens não nulas unidas por `" + "`: `N endereço(s)`, `N cidade(s)`,
  `N região(ões)`, `N país(es)`.
- Nada disso, ou `geo` ausente → `"não especificada"`.

**Esc dentro da busca**
- Com o painel aberto, Esc com o foco dentro dele fecha só o painel. O sheet de revisão (e os
  diálogos de conjunto) continuam abertos, com o rascunho intacto. Motivo: o Radix escuta Esc na
  fase de captura do `document`; com o `Popover` a camada da busca absorvia o Esc, com o painel
  inline não absorve mais. O componente registra um listener de `keydown` na captura do
  `window` enquanto o painel está aberto e, para Esc com alvo dentro do painel, interrompe a
  propagação e fecha o painel.

## Testes

Unitários com `bun:test` (estilo de `review-summaries.test.ts`):

- `app/(admin)/marketing/components/location-selection.test.ts`
  - Regra do Brasil: adicionar cidade com Brasil na lista → Brasil sai; remover o último →
    `[Brasil]`; `[Brasil]` sozinho permanece.
  - Remover do meio preserva a ordem e ajusta o índice expandido.
  - Raio: campo e ± limitados a 1–80; valor inválido/≤ 0 ignorado; cidade e país não aceitam raio.
  - Pino: vira `custom_location` com chave `custom_<lat>_<lng>`, mantém o raio ou usa o padrão.
- `app/(admin)/marketing/ai/review-summaries.test.ts`: `geoSummaryLine` com locais nomeados e
  raio, só contagens, vazio e `undefined`.
- `tests/review-sheet-stacking.test.ts`: contrato de empilhamento — o z-index de
  `[data-radix-popper-content-wrapper]` no `globals.css` (exigindo `!important`, 200) e o do
  `PopoverContent` ficam acima do z-index do `ReviewEditSheet` (90) e do sheet de público avançado
  (110).

Portões: `tsc --noEmit` sem erros novos; `eslint` nos arquivos tocados (o lint do repo já sai 1
na base); suíte completa `FRONTEND_ROOT=D:/automatize-marketing/automatize-frontend bun test`
sem falhas novas em relação à baseline da branch.

## Verificação na UI (agent-browser)

Contra `bun run dev:staging` (porta 3006) com sessão pelo cookie `backoffice_magic_session`
aplicado só em `localhost`. Screenshots em
`docs/superpowers/plans/2026-09-30-ai-location-edit-evidence/` (fora do commit).

1. **Antes (base):** reproduzir a busca coberta pelo sheet de Localização.
2. **Sheet de revisão:** buscar e adicionar endereço; raio por slider, ± e campo; remover até o
   Brasil voltar; adicionar cidade e ver o Brasil sair; Esc na busca fecha só o painel; Salvar e
   ver a linha atualizada; reabrir, mexer, Cancelar e ver a alteração descartada.
3. **Passo "Onde anunciar?"** (cliente sem endereço salvo): busca e Continuar.
4. **Caminho do molde:** linha "Localização" só leitura.
5. **Sheets de Período e CTA:** calendário e selects por cima do sheet.
6. **Diálogo de editar conjunto:** painel inline (melhor esforço — depende de cliente com
   campanha).
7. **Celular (375 px):** sheet sem scroll horizontal.

Ambiente: staging primeiro. Se staging não tiver cliente com Meta conectada que chegue à revisão
(ou com molde), usar `APP_ENV=prod` local **só leitura**. Em nenhum ambiente clicar em Publicar
ou em Criar pixel.

## Fora do escopo

- Mudar a regra do Brasil.
- Editar a localização no caminho do molde (exigiria mudar o motor espelhado `ai-creation`).
- Qualquer mudança no `automatize-frontend`, no banco ou em rotas de API.

## Entrega

Worktree `D:\automatize-marketing\backoffice-ai-location-edit`, branch `fix/ai-location-edit`
criada da `main` atualizada (`adf2e31`); commit, push e PR contra `main`. O merge é do Rafael.
