# Campanhas de conversa e métricas de mensagens na Meta Marketing API v25.0

> Pesquisa concluída em 2026-09-15. Escopo: Graph API/Marketing API v25.0, somente fontes primárias oficiais da Meta. O SDK citado é o repositório oficial `facebook/facebook-python-business-sdk`, fixado na série `25.0.x`, e serve para confirmar contratos gerados da API quando a página de referência não expõe o tipo estrutural completo.

## Resumo executivo

A regra recomendada para classificar **uma campanha de conversa** é:

```text
campaign.objective == "MESSAGES"
OR
exists(adset) where
  adset.optimization_goal == "CONVERSATIONS"
  AND adset.destination_type in MESSAGING_DESTINATIONS
```

`MESSAGES` deve ser tratado como marcador legado no nível da campanha. Na estrutura atual, `objective` pertence à campanha, enquanto `optimization_goal` e `destination_type` pertencem ao conjunto de anúncios; a referência v25.0 ainda enumera tanto `MESSAGES` quanto os objetivos `OUTCOME_*`, e o SDK v25.0 confirma a separação dos campos entre `Campaign` e `AdSet`. [Campaign v25.0](https://developers.facebook.com/docs/marketing-api/reference/ad-campaign-group/v25.0#fields), [Campaign no SDK oficial v25.0.3](https://github.com/facebook/facebook-python-business-sdk/blob/25.0.3/facebook_business/adobjects/campaign.py#L64-L64), [AdSet no SDK oficial v25.0.3](https://github.com/facebook/facebook-python-business-sdk/blob/25.0.3/facebook_business/adobjects/adset.py#L64-L95)

O operador entre os dois marcadores modernos precisa ser **`AND`**, não `OR`: `destination_type` define para onde o clique leva e a documentação v25.0 permite destinos de mensageria em configurações otimizadas para `LINK_CLICKS`, `LEAD_GENERATION`, `QUALITY_LEAD` e `OFFSITE_CONVERSIONS`, entre outras; `CONVERSATIONS`, por sua vez, é definido como a otimização para pessoas com maior probabilidade de conversar com a empresa. Logo, qualquer um dos dois isoladamente é evidência insuficiente para o significado estrito “otimizada para conversa”. [Destination Type v25.0](https://developers.facebook.com/docs/marketing-api/adset/destination_type/v25.0), [Ad Set v25.0 — `optimization_goal`](https://developers.facebook.com/docs/marketing-api/reference/ad-campaign/v25.0#fields)

As quatro ações de mensagem documentadas na referência v25.0 são `onsite_conversion.messaging_conversation_started_7d`, `onsite_conversion.messaging_first_reply`, `onsite_conversion.messaging_block` e `onsite_conversion.messaging_user_subscribed`. Elas vêm dentro de `actions`; os custos correspondentes, quando reportados, vêm dentro de `cost_per_action_type`, localizando o mesmo `action_type`. Os nomes de produto como `messaging_conversations_started` e `cost_per_messaging_conversation_started` **não são campos da Graph API** e não devem ser enviados em `fields=`. [Ads Action Stats v25.0](https://developers.facebook.com/docs/marketing-api/reference/ads-action-stats/v25.0), [Ads Insights no SDK oficial v25.0.3](https://github.com/facebook/facebook-python-business-sdk/blob/25.0.3/facebook_business/adobjects/adsinsights.py#L33-L101), [tipos de retorno no SDK oficial v25.0.3](https://github.com/facebook/facebook-python-business-sdk/blob/25.0.3/facebook_business/adobjects/adsinsights.py#L449-L517)

## 1. Classificação: regra híbrida precisa

### 1.1 Regra operacional

Para uma linha de campanha, classificar como conversa se ocorrer pelo menos uma destas condições:

1. `campaign.objective === "MESSAGES"`; ou
2. existe ao menos um conjunto da campanha com `optimization_goal === "CONVERSATIONS"` **e** um `destination_type` de mensageria.

A referência de Campaign v25.0 lista `MESSAGES` no enum de `objective`, ao lado dos objetivos ODAX `OUTCOME_ENGAGEMENT`, `OUTCOME_LEADS` e `OUTCOME_SALES`; a própria seção de mapeamento ODAX mostra `MESSAGES` como objetivo antigo e `OUTCOME_ENGAGEMENT` como o novo objetivo correspondente para o caso Messenger + `CONVERSATIONS`. [Campaign v25.0 — `objective` e mapeamento ODAX](https://developers.facebook.com/docs/marketing-api/reference/ad-campaign-group/v25.0#odax-mapping), [enum no SDK oficial v25.0.3](https://github.com/facebook/facebook-python-business-sdk/blob/25.0.3/facebook_business/adobjects/campaign.py#L139-L161)

O conjunto v25.0 expõe `optimization_goal` e `destination_type` como campos distintos; `CONVERSATIONS` está no enum oficial de metas e é descrito como a entrega para pessoas com maior probabilidade de conversar com a empresa. [Ad Set v25.0](https://developers.facebook.com/docs/marketing-api/reference/ad-campaign/v25.0#fields), [campos e enum no SDK oficial v25.0.3](https://github.com/facebook/facebook-python-business-sdk/blob/25.0.3/facebook_business/adobjects/adset.py#L64-L95), [`CONVERSATIONS` no SDK oficial v25.0.3](https://github.com/facebook/facebook-python-business-sdk/blob/25.0.3/facebook_business/adobjects/adset.py#L170-L206)

### 1.2 Destinos de mensageria

Para cumprir literalmente o escopo decidido nesta entrega, o conjunto mínimo é:

```text
MESSENGER
WHATSAPP
INSTAGRAM_DIRECT
```

A página oficial v25.0 define os três como destinos para Messenger, WhatsApp e Instagram Direct. Ela também documenta quatro destinos multicanal; aceitá-los evita falso negativo quando a Meta devolve um conjunto que pode entregar em mais de um app de mensagens. [Destination Type v25.0](https://developers.facebook.com/docs/marketing-api/adset/destination_type/v25.0), [enum no SDK oficial v25.0.3](https://github.com/facebook/facebook-python-business-sdk/blob/25.0.3/facebook_business/adobjects/adset.py#L255-L279)

Conjunto robusto sugerido:

```text
MESSENGER
WHATSAPP
INSTAGRAM_DIRECT
MESSAGING_MESSENGER_WHATSAPP
MESSAGING_INSTAGRAM_DIRECT_MESSENGER
MESSAGING_INSTAGRAM_DIRECT_MESSENGER_WHATSAPP
MESSAGING_INSTAGRAM_DIRECT_WHATSAPP
```

Os quatro valores `MESSAGING_*` acima são documentados como destinos de criativo para combinações de Instagram Direct, Messenger e WhatsApp. [Destination Type v25.0](https://developers.facebook.com/docs/marketing-api/adset/destination_type/v25.0), [enum no SDK oficial v25.0.3](https://github.com/facebook/facebook-python-business-sdk/blob/25.0.3/facebook_business/adobjects/adset.py#L262-L271)

### 1.3 Por que não filtrar a regra moderna pelo objetivo da campanha

A documentação v25.0 não sustenta uma allowlist limitada a `OUTCOME_ENGAGEMENT | OUTCOME_SALES | OUTCOME_LEADS`. A tabela oficial de destinos permite canais de mensagem também em `OUTCOME_AWARENESS` e `OUTCOME_TRAFFIC`; em `OUTCOME_LEADS`, os destinos específicos documentados são `LEAD_FROM_MESSENGER` e `LEAD_FROM_IG_DIRECT`, enquanto a tabela de validação do Ad Set associa Messenger nesse objetivo a `LEAD_GENERATION`/`QUALITY_LEAD`, não a `CONVERSATIONS`. [Destination Type v25.0 — tabela “Objectives”](https://developers.facebook.com/docs/marketing-api/adset/destination_type/v25.0), [Ad Set v25.0 — tabela de validação ODAX](https://developers.facebook.com/docs/marketing-api/reference/ad-campaign/v25.0#odax)

Por isso, a classificação deve usar `objective=MESSAGES` apenas como escape legado e, para ODAX, confiar no par de configuração do conjunto. Restringir adicionalmente por `OUTCOME_*` cria acoplamento a combinações que a própria Meta altera por objetivo e destino. [Destination Type v25.0](https://developers.facebook.com/docs/marketing-api/adset/destination_type/v25.0)

### 1.4 O que fica fora desta classificação

A v25.0 também enumera metas mais específicas como `MESSAGING_PURCHASE_CONVERSION`, `MESSAGING_DEEP_CONVERSATION_AND_FOLLOW` e `MESSAGING_APPOINTMENT_CONVERSION`. Elas são metas válidas de Ad Set, mas **não são `CONVERSATIONS`**; incluí-las ampliaria o requisito de “campanha de conversa” para “qualquer otimização de negócio dentro de mensagens”. Essa ampliação deve ser uma decisão de produto separada, não uma consequência silenciosa desta entrega. [Ad Set v25.0 — `optimization_goal`](https://developers.facebook.com/docs/marketing-api/reference/ad-campaign/v25.0#fields), [enum no SDK oficial v25.0.3](https://github.com/facebook/facebook-python-business-sdk/blob/25.0.3/facebook_business/adobjects/adset.py#L170-L206)

Do mesmo modo, a presença de uma ação de mensagem em Insights não é campo de configuração e não deve substituir a regra acima. Ela pode ser usada como diagnóstico/fallback de dados incompletos, mas isso seria uma heurística adicional não definida como classificação de campanha pela documentação v25.0. [Ads Action Stats v25.0](https://developers.facebook.com/docs/marketing-api/reference/ads-action-stats/v25.0), [Ad Set v25.0](https://developers.facebook.com/docs/marketing-api/reference/ad-campaign/v25.0#fields)

## 2. Métricas de mensagem documentadas

Todos os identificadores abaixo aparecem literalmente na referência `Ads Action Stats` v25.0. A coluna “rótulo oficial” mantém o significado publicado pela Meta; as traduções pt-BR propostas são rótulos do produto. [Ads Action Stats v25.0](https://developers.facebook.com/docs/marketing-api/reference/ads-action-stats/v25.0)

| `action_type` | Rótulo oficial da Meta | Rótulo pt-BR recomendado | Fonte |
|---|---|---|---|
| `onsite_conversion.messaging_conversation_started_7d` | Messaging Conversations Started | Conversas iniciadas | [Ads Action Stats v25.0](https://developers.facebook.com/docs/marketing-api/reference/ads-action-stats/v25.0) |
| `onsite_conversion.messaging_first_reply` | New Messaging Conversations | Novas conversas por mensagem | [Ads Action Stats v25.0](https://developers.facebook.com/docs/marketing-api/reference/ads-action-stats/v25.0) |
| `onsite_conversion.messaging_block` | Blocked Messaging Conversations | Conversas bloqueadas | [Ads Action Stats v25.0](https://developers.facebook.com/docs/marketing-api/reference/ads-action-stats/v25.0) |
| `onsite_conversion.messaging_user_subscribed` | Messaging Subscriptions | Inscrições por mensagem | [Ads Action Stats v25.0](https://developers.facebook.com/docs/marketing-api/reference/ads-action-stats/v25.0) |

Consequências para o contrato de produto:

- `messaging_user_subscribed` precisa ser **exposto como contagem** se a entrega promete as quatro ações documentadas; usá-lo somente para classificação não cumpre esse escopo. [Ads Action Stats v25.0](https://developers.facebook.com/docs/marketing-api/reference/ads-action-stats/v25.0)
- “Novos contatos” é uma interpretação de produto. A v25.0 chama `messaging_first_reply` de “New Messaging Conversations”, mas não define nessa página unicidade de pessoa/contato nem uma janela de deduplicação; o rótulo tecnicamente mais fiel é “Novas conversas por mensagem”. [Ads Action Stats v25.0](https://developers.facebook.com/docs/marketing-api/reference/ads-action-stats/v25.0)
- O sufixo `_7d` faz parte do identificador oficial de “Messaging Conversations Started”. A página v25.0 não explica nesse verbete se esse `7d` representa recência de conversa, deduplicação ou atribuição; ele deve ser tratado como nome opaco, não confundido com `action_attribution_windows`. [Ads Action Stats v25.0](https://developers.facebook.com/docs/marketing-api/reference/ads-action-stats/v25.0), [janelas de atribuição no SDK oficial v25.0.3](https://github.com/facebook/facebook-python-business-sdk/blob/25.0.3/facebook_business/adobjects/adsinsights.py#L250-L276)

### 2.1 Métricas a mostrar por padrão

Para campanha/conjunto classificado como conversa:

| Métrica do produto | Origem Graph | Extração |
|---|---|---|
| Conversas iniciadas | `actions` | item cujo `action_type` é `onsite_conversion.messaging_conversation_started_7d` |
| Custo por conversa iniciada | `cost_per_action_type` | mesmo `action_type` |
| Novas conversas por mensagem | `actions` | item cujo `action_type` é `onsite_conversion.messaging_first_reply` |
| Custo por nova conversa | `cost_per_action_type` | mesmo `action_type` |
| Conversas bloqueadas | `actions` | item cujo `action_type` é `onsite_conversion.messaging_block` |
| Inscrições por mensagem | `actions` | item cujo `action_type` é `onsite_conversion.messaging_user_subscribed` |

O contrato gerado v25.0 tipa `actions` e `cost_per_action_type` como listas de `AdsActionStats`, e `AdsActionStats` contém `action_type` e `value`, ambos strings. [Ads Insights no SDK oficial v25.0.3](https://github.com/facebook/facebook-python-business-sdk/blob/25.0.3/facebook_business/adobjects/adsinsights.py#L449-L517), [Ads Action Stats no SDK oficial v25.0.3](https://github.com/facebook/facebook-python-business-sdk/blob/25.0.3/facebook_business/adobjects/adsactionstats.py#L68-L87), [tipos no SDK oficial v25.0.3](https://github.com/facebook/facebook-python-business-sdk/blob/25.0.3/facebook_business/adobjects/adsactionstats.py#L131-L150)

Custos para bloqueio e inscrição poderiam ser procurados genericamente em `cost_per_action_type`, mas a referência v25.0 apenas documenta os quatro `action_type` e a família genérica de custo; ela não promete que toda ação terá sempre um item de custo. Para esta entrega, manter custo somente para conversa iniciada e nova conversa é a opção conservadora. [Ads Action Stats v25.0](https://developers.facebook.com/docs/marketing-api/reference/ads-action-stats/v25.0), [`cost_per_action_type` no SDK oficial v25.0.3](https://github.com/facebook/facebook-python-business-sdk/blob/25.0.3/facebook_business/adobjects/adsinsights.py#L101-L101)

Quando a Meta não devolver o item do `action_type`, preservar `null`/“não reportado” evita inventar zero. A documentação v25.0 enumera o formato, mas não estabelece que a ausência de um item equivale a contagem zero; portanto essa é uma recomendação defensiva de implementação, não uma garantia da API. [Ads Action Stats v25.0](https://developers.facebook.com/docs/marketing-api/reference/ads-action-stats/v25.0)

## 3. Consulta e extração

### 3.1 Configuração para classificar

Na leitura de campanhas, pedir `objective` no nível de campanha e `optimization_goal,destination_type` nos conjuntos. A Graph API permite expansão de campos/conexões, e a referência v25.0 expõe esses campos nos respectivos objetos. [Field Expansion — Graph API](https://developers.facebook.com/docs/graph-api/guides/field-expansion/), [Campaign v25.0](https://developers.facebook.com/docs/marketing-api/reference/ad-campaign-group/v25.0#fields), [Ad Set v25.0](https://developers.facebook.com/docs/marketing-api/reference/ad-campaign/v25.0#fields)

Exemplo conceitual:

```http
GET /v25.0/act_<AD_ACCOUNT_ID>/campaigns
  ?fields=id,name,objective,
    adsets.limit(200){id,effective_status,optimization_goal,destination_type}
```

O uso de `/v25.0/` fixa a semântica da chamada na versão investigada; os exemplos gerados da referência de Campaign v25.0 também usam explicitamente esse prefixo. [Campaign v25.0 — examples](https://developers.facebook.com/docs/marketing-api/reference/ad-campaign-group/v25.0)

Se a expansão de `adsets` for paginada, a classificação “algum conjunto corresponde” só é correta depois de percorrer todas as páginas relevantes; parar no primeiro bloco pode produzir falso negativo. O guia de paginação da Graph API documenta cursores e links `paging`. [Graph API — Paginated Results](https://developers.facebook.com/docs/graph-api/results)

### 3.2 Insights para métricas

Pedir as famílias reais da API e extrair pelo `action_type` exato:

```http
GET /v25.0/act_<AD_ACCOUNT_ID>/insights
  ?level=campaign
  &fields=campaign_id,campaign_name,spend,actions,cost_per_action_type
  &time_range={...}
```

O endpoint oficial do Ad Account é `GET /insights`; na v25.0 ele aceita, entre outros, `fields`, `level`, `time_range`, `action_attribution_windows`, `action_breakdowns`, `action_report_time` e `use_unified_attribution_setting`. [Ad Account `get_insights` no SDK oficial v25.0.3](https://github.com/facebook/facebook-python-business-sdk/blob/25.0.3/facebook_business/adobjects/adaccount.py#L3160-L3210)

Não somar a família `actions` inteira: a documentação explica que seus itens são hierárquicos e que uma soma simples pode contar a mesma ação em níveis agregados e detalhados. Para estas métricas, procurar igualdade exata de `action_type`; se houver dimensões extras de `action_breakdowns`, agregar somente entradas do mesmo identificador e da combinação de dimensões desejada. [Breakdowns v25.0 — “Total action counts”](https://developers.facebook.com/docs/marketing-api/insights/breakdowns/v25.0)

Não é necessário enviar `action_breakdowns=action_type`: quando `action_breakdowns` é omitido, a v25.0 adiciona `action_type` implicitamente para agrupar o campo `actions`. [Breakdowns v25.0 — “Action breakdowns”](https://developers.facebook.com/docs/marketing-api/insights/breakdowns/v25.0)

## 4. Atribuição e breakdowns: cautelas que afetam o painel

A documentação v25.0 avisa que métricas de ação podem ficar indisponíveis quando há tentativa de agregação sobre múltiplas configurações de atribuição ou quando a consulta usa breakdowns afetados; essa segunda restrição é indicada para tipos de ação e eventos fora da Meta. Ela registra como exceção uma consulta explícita com `action_attribution_windows=1d_click,7d_click,1d_view,incrementality`, sem incluir a janela `default`. [Breakdowns v25.0 — “Action Metrics”](https://developers.facebook.com/docs/marketing-api/insights/breakdowns/v25.0), [Ads Action Stats v25.0](https://developers.facebook.com/docs/marketing-api/reference/ads-action-stats/v25.0)

Para as tabelas/cards desta entrega:

- não adicionar breakdown demográfico/placement à mesma chamada usada para os KPIs de mensagem sem testar compatibilidade;
- manter os mesmos parâmetros de atribuição usados pelas métricas já exibidas, para não comparar números calculados em janelas diferentes;
- não alterar `action_report_time` só para mensagens; a v25.0 aceita `conversion`, `impression`, `mixed` e `lifetime`, portanto uma mudança modifica a base temporal do relatório. [Breakdowns v25.0](https://developers.facebook.com/docs/marketing-api/insights/breakdowns/v25.0), [`ActionReportTime` no SDK oficial v25.0.3](https://github.com/facebook/facebook-python-business-sdk/blob/25.0.3/facebook_business/adobjects/adsinsights.py#L296-L301)

O SDK oficial v25.0 confirma que `use_unified_attribution_setting` é um parâmetro booleano de Insights, mas as páginas v25.0 consultadas nesta pesquisa não forneceram uma garantia textual suficiente de que ele, sozinho, resolve agregação de conjuntos com configurações de atribuição diferentes. Recomendação: preservar o valor já adotado pela aplicação e não usá-lo como justificativa para ignorar o alerta de agregação da documentação. [Ad Account `get_insights` no SDK oficial v25.0.3](https://github.com/facebook/facebook-python-business-sdk/blob/25.0.3/facebook_business/adobjects/adaccount.py#L3168-L3191), [Breakdowns v25.0](https://developers.facebook.com/docs/marketing-api/insights/breakdowns/v25.0)

## 5. Limites do que foi verificado oficialmente

### Verificado

- Os quatro `action_type` listados na seção 2 são os únicos verbetes específicos de mensageria encontrados na lista oficial de tipos de ação da referência v25.0. [Ads Action Stats v25.0](https://developers.facebook.com/docs/marketing-api/reference/ads-action-stats/v25.0)
- `objective` fica em Campaign; `optimization_goal` e `destination_type` ficam em AdSet. [Campaign no SDK oficial v25.0.3](https://github.com/facebook/facebook-python-business-sdk/blob/25.0.3/facebook_business/adobjects/campaign.py#L64-L64), [AdSet no SDK oficial v25.0.3](https://github.com/facebook/facebook-python-business-sdk/blob/25.0.3/facebook_business/adobjects/adset.py#L64-L95)
- `MESSAGES` aparece no enum v25.0, enquanto a página de Destination Type afirma que os objetivos antigos foram descontinuados na Marketing API v17.0. Isso sustenta leitura/classificação retrocompatível, mas não sustenta criar novas campanhas com `MESSAGES`. [Campaign v25.0](https://developers.facebook.com/docs/marketing-api/reference/ad-campaign-group/v25.0#fields), [Destination Type v25.0](https://developers.facebook.com/docs/marketing-api/adset/destination_type/v25.0)
- A Graph API v25.0 foi lançada em 18 de fevereiro de 2026; o changelog v25.0 não anuncia mudança específica nesses quatro identificadores de mensagem. A mudança de Marketing API registrada nessa versão e relevante a relatórios assíncronos adiciona campos de erro padrão aos jobs que falham, não altera a extração síncrona `actions`/`cost_per_action_type`. [Graph API v25.0 Changelog](https://developers.facebook.com/docs/graph-api/changelog/version25.0)

### Não verificado — não transformar em contrato

- Os identificadores práticos do Gerenciador para “conversas respondidas”, profundidade de 2/3/5 mensagens e visualização da mensagem de boas-vindas **não aparecem** na lista v25.0 consultada. Eles ficam fora desta entrega mesmo que uma conta real os devolva. [Ads Action Stats v25.0](https://developers.facebook.com/docs/marketing-api/reference/ads-action-stats/v25.0)
- A página v25.0 não define a semântica detalhada de “first reply” além do rótulo “New Messaging Conversations”; não foi possível comprovar por fonte oficial v25.0 que seja exatamente “novo contato único”. [Ads Action Stats v25.0](https://developers.facebook.com/docs/marketing-api/reference/ads-action-stats/v25.0)
- A página v25.0 não explica o significado do `_7d` em `messaging_conversation_started_7d`; não assumir que seja a janela de atribuição da consulta. [Ads Action Stats v25.0](https://developers.facebook.com/docs/marketing-api/reference/ads-action-stats/v25.0)
- A documentação oficial não promete a presença de um item de `cost_per_action_type` para cada um dos quatro tipos em toda conta/período. Tratar custo ausente como não reportado. [Ads Action Stats v25.0](https://developers.facebook.com/docs/marketing-api/reference/ads-action-stats/v25.0), [Ads Insights no SDK oficial v25.0.3](https://github.com/facebook/facebook-python-business-sdk/blob/25.0.3/facebook_business/adobjects/adsinsights.py#L449-L517)

## 6. Recomendações objetivas para a implementação

1. Centralizar um único predicado configuracional: `legacy MESSAGES || some(adset => goal === CONVERSATIONS && isMessagingDestination(destination))`.
2. Não classificar por `destination_type` isolado e não incluir metas `MESSAGING_*` nesta entrega sem uma decisão explícita de ampliar “conversa” para “mensageria”.
3. Incluir os quatro destinos multicanal `MESSAGING_*` na allowlist para tolerar respostas v25.0 que combinam apps.
4. Buscar `actions` e `cost_per_action_type` uma vez e mapear por igualdade exata do `action_type`; não enviar nomes derivados do produto em `fields=`.
5. Expor seis métricas: quatro contagens documentadas mais custo por conversa iniciada e custo por nova conversa. Em particular, expor `messaging_user_subscribed` como contagem.
6. Usar `null` quando a Meta omitir uma ação/custo; não converter ausência em zero.
7. Manter a consulta principal sem breakdown adicional; se houver breakdowns, testar a matriz de compatibilidade e respeitar a configuração de atribuição.
8. Aplicar a mesma extração em frontend, backoffice, ordenação rápida e ferramentas do Mat para impedir que cada consumidor mantenha sua própria lista de identificadores.

## Fontes oficiais consultadas

- [Meta — Ads Action Stats, v25.0](https://developers.facebook.com/docs/marketing-api/reference/ads-action-stats/v25.0)
- [Meta — Ad Campaign (Ad Set), v25.0](https://developers.facebook.com/docs/marketing-api/reference/ad-campaign/v25.0)
- [Meta — Ad Campaign Group (Campaign), v25.0](https://developers.facebook.com/docs/marketing-api/reference/ad-campaign-group/v25.0)
- [Meta — Ad Set Destination Type, v25.0](https://developers.facebook.com/docs/marketing-api/adset/destination_type/v25.0)
- [Meta — Insights Breakdowns, v25.0](https://developers.facebook.com/docs/marketing-api/insights/breakdowns/v25.0)
- [Meta — Graph API v25.0 Changelog](https://developers.facebook.com/docs/graph-api/changelog/version25.0)
- [Meta — Graph API Field Expansion](https://developers.facebook.com/docs/graph-api/guides/field-expansion/)
- [Meta — Python Business SDK, tag 25.0.3](https://github.com/facebook/facebook-python-business-sdk/tree/25.0.3)
