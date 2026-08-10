# Spec — Fundação de Tracking de Campanhas Meta

Status: ready-for-agent
Feature: campaign-tracking-foundation
Branch: feat/campaign-tracking-foundation (a partir de staging, nos dois repos)

## Problem Statement

A plataforma cria e gerencia campanhas de anúncio Meta em nome dos clientes (Campanhas Gerenciadas, prefixo configurável `[AM]`), e os clientes também criam e alteram campanhas por conta própria — pelo painel ou direto no Gerenciador de Anúncios. Hoje nada registra de forma sistemática **qual configuração** cada campanha, conjunto e anúncio tinha em cada momento, **quais resultados diários** cada configuração produziu, e **quais ações** foram tomadas, por quem e por quê. Sem essa base:

- O gestor não consegue reconstruir "o que estava valendo quando o resultado subiu/caiu" nem auditar quem mexeu no quê.
- A prova que cada conta produz se perde com o tempo (a Meta só permite olhar 37 meses para trás, em janela deslizante, e não oferece nenhum histórico de configuração — só o estado atual).
- Os propósitos futuros — otimizador de campanhas, criação enviesada por histórico (a Criação com IA das ADRs 0022/0023), tomada de decisão, informacional — não têm de onde aprender, nem dentro da conta do cliente nem entre clientes.
- Alterações feitas pelo backoffice registram motivo apenas em parte das operações (mudança de status não registra nada), e alterações feitas direto no Gerenciador são invisíveis.

## Solution

Uma fundação de dados que observa diariamente todas as contas de anúncio conectadas e registra três coisas, cada uma no seu formato ideal:

1. **Versões de configuração** — cada entidade (campanha, conjunto, anúncio) tem uma sequência de versões; versão nova nasce apenas quando a configuração efetivamente muda. Cada versão guarda o período de vigência, colunas tipadas para consulta e o registro integral em JSON. "Estado em qualquer data" é uma consulta de vigência.
2. **Série diária de resultados** — uma linha por entidade×dia, sempre com granularidade de 1 dia, re-coletada em janela móvel de 28 dias (insights da Meta mudam retroativamente até congelar). Qualquer janela de análise é derivada por consulta.
3. **Stream unificado de ações** — toda mudança, em qualquer nível, vira um evento com o diff campo-a-campo pré-computado, a origem (backoffice, painel do cliente, detectada via API, sistema), o autor quando conhecido e o **motivo** — obrigatório quando o gestor/administrador age pelo backoffice, ausente quando a ação foi detectada apenas pela API, conforme definido.

O tracking profundo diário cobre apenas entidades com estado efetivo ativo (quem gasta dinheiro); as demais são observadas pela listagem diária somente para gerar eventos de transição de ciclo de vida e reentrar no tracking se reativarem. Na ativação, um backfill captura 13 meses de resultados diários por conta. A correlação ação→resultado é computada na leitura, sobre dados brutos perfeitos, sem materializar metodologia prematuramente.

## User Stories

1. Como gestor de tráfego, quero que toda campanha, conjunto e anúncio ativos de toda conta conectada tenham sua configuração registrada diariamente, para reconstruir o estado de qualquer entidade em qualquer data.
2. Como gestor, quero que Campanhas Gerenciadas (`[AM]`) e campanhas criadas pelo próprio cliente sejam trackeadas igualmente, para comparar o desempenho do que a plataforma faz com o que o cliente faz sozinho.
3. Como gestor, quero que a marca de "gerenciada" seja avaliada e gravada por versão (como era na época), para que renomear uma campanha não reescreva a história dela.
4. Como coletor, quero criar versão nova de configuração somente quando algo muda de fato, para que o histórico seja denso em informação e barato em armazenamento.
5. Como analista, quero consultar os campos quentes (status, orçamentos, estratégia de lance, objetivo, meta de otimização, estado Advantage+) em colunas tipadas, para filtrar e agregar sem abrir JSON.
6. Como consumidor de dados futuro, quero o registro integral da configuração em JSON desde o primeiro dia, para que um campo que hoje ninguém consulta já esteja capturado quando um novo propósito precisar dele.
7. Como gestor, quero que pausar, retomar, arquivar e deletar gerem eventos de transição datados, para que o ciclo de vida faça parte do histórico de ações.
8. Como coletor, quero parar o tracking profundo de entidades que saíram do estado ativo e retomá-lo quando reativarem, para não gastar cota de API com quem não está gastando dinheiro.
9. Como gestor, quero que campanhas novas criadas na conta sejam descobertas no máximo no dia seguinte, para que nada exista fora do tracking.
10. Como gestor, quero os resultados de cada entidade registrados dia a dia (nunca agregados por janela), para analisar qualquer período com granularidade mínima de um dia.
11. Como coletor, quero re-coletar os últimos 28 dias todo dia com upsert por dia, para capturar a atribuição retroativa até os valores congelarem.
12. Como analista, quero saber se o valor de um dia é final ou ainda mutável, para decidir se uma análise é definitiva ou provisória.
13. Como gestor, quero 13 meses de resultados diários backfillados na ativação de cada conta, para ter um ano completo de sazonalidade desde o primeiro dia — antes que a janela deslizante da Meta os torne irrecuperáveis.
14. Como gestor/administrador, quero registrar o motivo de toda alteração que eu fizer pelo backoffice, para que a intenção fique permanentemente ligada à ação.
15. Como sistema, quero rejeitar alterações vindas do backoffice sem motivo preenchido, para que o requisito não dependa de disciplina individual.
16. Como gestor, quero que mudanças de status feitas pelo backoffice também sejam registradas com motivo (hoje não são registradas de forma alguma), para eliminar esse ponto cego.
17. Como cliente, quero que as edições que eu fizer pelo painel sejam registradas em meu nome, sem motivo obrigatório, para que fique claro o que foi decisão minha.
18. Como gestor, quero que mudanças feitas direto no Gerenciador de Anúncios sejam detectadas em até um dia e entrem no stream como ações sem motivo, para que nenhuma ação escape.
19. Como gestor, quero que ações detectadas via API sejam enriquecidas com autor e horário exato quando o audit trail da Meta tiver o evento correspondente, para auditar quem mexeu e quando.
20. Como coletor, quero persistir os eventos crus de atividade da conta mesmo quando não há match com uma ação, para servir de matéria-prima futura (billing, públicos, papéis da conta).
21. Como coletor, quero reconhecer que uma mudança detectada via API já foi registrada por uma escrita interna e não duplicar o evento, para que o stream tenha uma ação por fato.
22. Como analista, quero buscar ações por campo alterado, origem, conta, entidade e período, para responder perguntas como "quem mudou orçamento neste mês e por quê".
23. Como analista, quero o diff velho→novo de cada ação pré-computado na coleta, para nunca precisar comparar configurações em tempo de consulta.
24. Como analista, quero o snapshot do criativo referenciado por cada anúncio, para correlacionar troca de criativo com o conteúdo do criativo.
25. Como analista, quero obter o estado vigente de qualquer entidade em qualquer data com uma consulta de vigência, para basear análises pontuais e comparativas.
26. Como analista, quero uma linha do tempo unificada por entidade — versões, ações e série diária alinhadas —, para ler a história completa de uma campanha num só lugar.
27. Como analista, quero janelas de N dias antes/depois de uma ação com sinalização de ações concorrentes e de reset de fase de aprendizado, para que a correlação ação→resultado seja honesta sobre confundidores.
28. Como operador da plataforma, quero ver a cobertura de coleta por conta e por dia (completa, parcial, pulada por reconexão pendente), para detectar buracos irrecuperáveis na série a tempo de agir.
29. Como operador, quero que contas com token inválido ou reconexão pendente apareçam em destaque, para acionar o cliente antes que o buraco cresça.
30. Como operador, quero que a coleta seja idempotente (rodar duas vezes no mesmo dia não duplica versões, eventos nem linhas de métrica), para re-executar sem medo após falhas.
31. Como operador, quero que o coletor respeite preventivamente a cota por conta (pelos headers de uso da Meta) e pare antes de gerar erros, para proteger a licença do app — que é throttled por taxa de erro.
32. Como consumidor cross-cliente futuro (otimizador, criação enviesada), quero acessar apenas padrões agregados/anonimizados sem identificação do cliente-fonte, para conformidade com LGPD e com os termos da plataforma Meta.
33. Como gestor, quero identificar campanhas Advantage+ (estado Advantage+, tipo de promoção inteligente) em cada versão, para distinguir ASC/AAC legadas — que a Meta pausará na v26 — de campanhas na estrutura nova.
34. Como operador, quero que a desconexão da conta Meta pare a coleta preservando todo o histórico já registrado, para que churn não apague aprendizado.
35. Como analista, quero valores monetários na moeda da conta e dias na timezone da conta de anúncio, para que os números batam com o Gerenciador de Anúncios.
36. Como operador, quero acompanhar o progresso e o resultado de cada execução de coleta e de backfill (contadores, erros, duração), para diagnosticar regressões de coleta.

## Implementation Decisions

**Escopo e ciclo de vida**

- Entram no tracking todos os usuários com conta Meta conectada ativa e todas as suas contas de anúncio atribuídas. A flag de Campanha Gerenciada deriva do prefixo configurável já existente nas regras operacionais do negócio.
- Tracking profundo (configuração + diff + versões) apenas para entidades com estado efetivo ativo. A listagem diária por conta cobre todas as entidades apenas para detectar criações, transições de ciclo de vida e reativações. Insights são coletados no nível da conta, o que captura de graça a cauda de atribuição de entidades recém-pausadas.

**Modelo de dados** (novas tabelas, espelhadas nos schemas dos dois projetos; migration additiva de propriedade do backoffice)

- `meta_tracking_config_versions` — versões SCD tipo 2 por entidade: hash da configuração normalizada, JSON integral, colunas tipadas por nível, vigência (`valid_from`/`valid_to`), flag de gerenciada por versão. Campos voláteis (estado efetivo, orçamento restante, fase de aprendizado, avisos) são gravados mas ficam fora do hash — não geram versão; transições de estado viram eventos, não versões.
- `meta_tracking_daily_metrics` — uma linha por entidade×dia; numéricos universais tipados, famílias de ações/valores/custos em JSON; marca de dado final vs mutável; unicidade por entidade+dia; upsert, nunca delete.
- `meta_tracking_change_events` — o stream de ações: tipo do evento (criação, mudança de config, transição de status, arquivamento, remoção detectada), diff campo-a-campo pré-computado, origem (backoffice, painel do cliente, detectada externamente, sistema), autor, motivo (obrigatório na aplicação quando a origem é o backoffice), horário exato quando conhecido, ligações com a versão anterior/nova, com o evento cru da Meta e com o log legado.
- `meta_tracking_activity_events` — eventos crus do audit trail da Meta, deduplicados por chave composta, com marcação de match. Poll diário com sobreposição de 48h.
- `meta_tracking_runs` + `meta_tracking_account_coverage` — execuções e cobertura por conta×dia (status, erros, contadores, moeda e timezone da conta). A cobertura é o mecanismo de claim (conta sem cobertura completa hoje = pendente) e a fonte da tela de operação.
- `meta_tracking_creatives` — snapshot único por criativo (imutáveis na prática), buscado quando um anúncio referencia criativo desconhecido.

**Coleta**

- O diff do coletor é a fonte de verdade das ações detectadas; o audit trail da Meta é enriquecimento oportunista (o formato do detalhe e a retenção não são documentados — nada pode depender dele).
- Campanhas sempre passam por diff completo: o carimbo de atualização de campanha não reflete mudanças de orçamento (limitação documentada) e o edge de campanhas não filtra por atualização. Conjuntos e anúncios usam o pré-filtro de "atualizado desde" como otimização.
- Insights com incremento diário, janela móvel de 28 dias, atribuição unificada (a mesma configuração de atribuição do conjunto, para bater com o Gerenciador); sem breakdowns nesta fundação. Erro de volume de linhas degrada para fatias menores e, em último caso, para o job assíncrono de insights.
- Backfill de 13 meses por conta via jobs assíncronos de insights, fatiado por período, retomável por estado de progresso, espalhado por janelas noturnas; o estado atual de cada entidade (incluindo pausadas e arquivadas, apenas neste momento) vira a versão inicial.
- Execução por cron no backoffice em janela de madrugada distinta dos crons existentes, com múltiplos disparos drenando lotes por invocação (limite de duração da plataforma), idempotência por dia, recuperação de execuções travadas e autenticação de cron — os padrões operacionais já em produção.
- Postura de cota herdada da restrição arquitetural do app (licença Meta throttled por taxa de erro): monitorar os headers de uso por conta e interromper preventivamente com cobertura parcial, deixando o próximo disparo completar; jamais insistir até tomar erro de rate limit.

**Ações internas e superfície de edição**

- Conforme a ADR 0010, os primitives de atualização continuam sendo a superfície única de edição e permanecem intocados (são fonte espelhada byte-a-byte entre os projetos). A escrita no stream de ações acontece na camada de wrapper das rotas — o mesmo lugar onde os logs de auditoria vivem hoje — nos dois projetos.
- Toda mutação do backoffice (orçamento, CBO↔ABO, segmentação, agendamento, criativo, renomeio, duplicação e **status** — corrigindo a lacuna atual) passa a exigir motivo e a gravar o evento com autor e horário exatos. As tabelas legadas de log de edição continuam recebendo dual-write, com ponte de referência no evento novo.
- O coletor reconhece mudanças já registradas por escrita interna (mesma entidade, mesmo delta, janela de tolerância) e não duplica o evento — apenas liga a versão nova ao evento existente.

**Consumo**

- Correlação computada na leitura: helpers de consulta para estado vigente em data, linha do tempo unificada, janelas antes/depois de uma ação (com flag de ações concorrentes e de reset de fase de aprendizado) e busca de ações por campo/origem/período.
- Regra de consumo cross-cliente: dados brutos identificáveis apenas para o próprio cliente e para gestores no backoffice; qualquer consumidor cross-cliente lê padrões agregados/anonimizados (seguindo o precedente de fingerprint já existente). A camada concreta de agregação nasce com o primeiro consumidor.
- Vocabulário reservado respeitado: *validado* segue exclusivo da régua de ROAS (ADR 0022); esta fundação fornece a matéria-prima para a eleição de campanha provada, não redefine os termos.

**Operação e visibilidade**

- Tela mínima no backoffice: execuções recentes com contadores, cobertura conta×dia com destaque para reconexão pendente, e o histórico unificado de ações por campanha/conjunto com motivo visível, sob o RBAC existente.
- Desconexão da Meta interrompe a coleta e preserva o histórico. Dias e moedas seguem a conta de anúncio.

## Testing Decisions

- Um bom teste aqui alimenta uma costura pura com dados reais de entrada e afirma sobre o resultado externo — nunca sobre como o resultado foi obtido. Fixtures derivadas de respostas reais da Graph API v25; asserções sobre o delta produzido, não sobre chamadas internas.
- **Costura 1 — cálculo do delta de tracking** (a principal): dado o estado anterior conhecido de uma conta e as respostas da API de hoje (listagem, configurações, atividades, insights), produz o delta completo — versões novas, eventos com diff, transições, upserts de métricas, matches de atividade. Pura, sem I/O; reutilizada pelo coletor diário, pelo backfill e pela deduplicação de escritas internas. Casos obrigatórios: mesma config ⇒ delta vazio (idempotência); campo volátil mudou ⇒ nenhuma versão; transição de status ⇒ evento sem versão; mudança real ⇒ versão + evento com diff exato; entidade nova ⇒ criação; reexecução do mesmo dia ⇒ delta vazio.
- **Costura 2 — gravador do stream de ações** chamado pelas rotas na camada de wrapper: contrato de motivo obrigatório quando a origem é o backoffice, formato do diff, dual-write com ponte para o log legado, autoria e horário.
- **Costura 3 — calculadoras de correlação**: série diária + eventos ⇒ janelas antes/depois, flags de concorrência e de reset de aprendizado, com casos de borda (ação no primeiro/último dia da série, ações simultâneas).
- Executores de I/O (busca na Graph API, escrita no banco) permanecem finos e fora do teste unitário nesta fundação.
- Prior art: as suítes colocadas de regras de negócio já existentes no runner do bun com `node:test` (regras de Campanha Gerenciada, avaliadores de queda de performance) e as suítes de contrato/paridade dos dois projetos. Sem dependência de banco de teste.

## Out of Scope

- Dashboards analíticos (série temporal com marcadores de ação sobre o gráfico) — nascem com os consumidores.
- O otimizador de campanhas, a criação enviesada e qualquer consumidor cross-cliente concreto, incluindo a camada de agregação/anonimização.
- Breakdowns (demográficos, hora, posicionamento) e métricas horárias.
- Materialização de efeitos por ação (tabela de correlação pré-calculada).
- Migração ou remoção das tabelas legadas de log de edição (o dual-write mantém compatibilidade).
- Motivo obrigatório para ações do cliente no painel (só gestor/administrador insere motivo, por definição).
- Webhooks de mudança de objetos de anúncio (não existem na plataforma Meta).

## Further Notes

- A Meta pausará campanhas ASC/AAC legadas na v26 (~set/2026): uma onda de eventos de transição é esperada e não é bug; o estado Advantage+ capturado por versão permite distinguir.
- A janela de 37 meses de insights desliza diariamente — o backfill de 13 meses deve rodar logo após a ativação de cada conta; adiar é perder história.
- O detalhe (`extra_data`) e a retenção do audit trail da Meta não são documentados; o design degrada bem se o endpoint mudar ou falhar (o diff nunca depende dele).
- O plano de implementação aprovado, com o desenho concreto por fases, vive em `docs/plans/` do repositório backoffice, na mesma branch.
- Decisões desta spec foram tomadas em entrevista com o gestor do produto em 2026-08-09; o dossiê de documentação oficial (URLs das páginas da Marketing API v25) está registrado no plano.
