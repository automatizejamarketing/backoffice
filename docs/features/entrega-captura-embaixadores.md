# Captura comercial e embaixadores — entrega local

Implementado em 22/09/2026 a partir de `frontend origin/main 45b03733` e `backoffice origin/main d8074b5`. As duas referências foram buscadas e os dois worktrees receberam `pull --ff-only origin main`. O trabalho preexistente nas branches originais foi preservado. Branch nos dois repositórios: `feat/captura-embaixadores`.

## Comportamento

- `/captura` grava um contato comercial e seu envio histórico; não cria conta, trial, comissão nem mensagem externa. O e-mail normalizado identifica o contato; telefone não é chave de deduplicação. Reenvio preserva estágio, identidade e data de entrada. O mesmo requestId não grava duas vezes.
- CRM usa `crm_contacts` e `crm_contact_events`, preservando o funil e as métricas. Há filtros e etiquetas de campanha Isaac e perfil. Cadastro posterior liga a conta ao contato sem reiniciar estágio ou contar uma nova entrada. Cortesia Starter é distinguida de trial/assinatura paga.
- `/ambassadors` adiciona afiliados existentes e separa publicidade/coprodução. Responsáveis filtram a lista; dependências, datas reais, reabertura em ordem inversa, checklist de materiais, observações, categoria e encerramento mantêm histórico. Ciclos mensais preservam pendências antigas.
- Liberar Starter é uma ação independente com vencimento escolhido. Acesso é estendido sem reduzir um prazo anterior. Créditos: 250 na primeira liberação, depois no dia original (limitado ao último dia dos meses curtos). Prorrogação não concede bônus. Renovação após vencimento retoma no próximo ciclo original, sem repor períodos expirados. Assinatura ativa/trialing/past_due bloqueia a liberação para revisão administrativa.
- Benefício não fabrica assinatura, pagamento ou receita. O acesso aos produtos incluídos no Starter reconhece a gratuidade. Histórico de créditos mostra um rótulo próprio.
- O modal **Como funciona** reproduz as regras confirmadas; fontes: [captura](captura-crm/spec.md), [embaixadores](embaixadores/spec.md) e [texto do modal](embaixadores/como-funciona.md).

## Dados, permissões e ativação

Migrations espelhadas: backoffice `0120_capture_ambassadors.sql` e frontend `0127_capture_ambassadors.sql`, SQL idêntico e mesmo `when` acima dos dois journals. São aditivas, com backfill e triggers de compatibilidade do CRM legado. Contas antigas com data de cadastro desconhecida permanecem sem data, sem inflar as metas do mês da migração. As tabelas legadas não são removidas.

Aplicar as migrations **antes** de publicar o código. Conferir `bun run db:migrate:status` nos dois repositórios do ambiente alvo e tratar pendências históricas antes de avançar a marca d'água compartilhada. Não usar `db:push`. O comando padrão de geração encontrou colisão histórica entre snapshots `0017` e `0024`; a nova diferença foi gerada em diretório temporário contra o schema atualizado, sem reescrever snapshots antigos.

Administradores têm acesso à aba. Em **Acessos da equipe**, um administrador autoriza a conta real de Bernardo e habilita **Liberar Starter** para ele; autoriza os demais integrantes apenas para acompanhamento. Os responsáveis devem ter acesso ativo à aba. As permissões são verificadas no servidor; o benefício não amplia permissões de cobrança ou de alteração genérica de contas. Não há inferência de identidade pelo nome.

O cron do frontend `/api/cron-job/ambassadors`, protegido pelo `CRON_SECRET` já usado pelos outros crons, roda às 03:05 UTC (00:05 de Brasília). Reexecuções são seguras por lock e ledger único de créditos. A visualização e as atualizações também projetam os ciclos mensais atuais, sem depender do horário do cron para exibi-los. Créditos de ciclos cobertos são recuperados se uma execução diária falhar; períodos sem benefício válido não são concedidos.

Encerrar parceria preserva benefício e créditos até o vencimento. Não há reativação automática, renovação automática, disparo de briefing ou publicação externa.

## Validação

Verificação feita somente com dados sintéticos em PostgreSQL local descartável. A carga do schema-base precisou omitir, apenas no banco de teste, um CHECK malformado preexistente de `product_orders`; os constraints da nova migration foram aplicados integralmente:

- 62 testes selecionados passaram (54 de lógica/permissões/CRM/migration, 6 de captura e fronteira pública, 2 de integração transacional).
- Testes das regras de datas, fuso de Brasília, meses curtos, dependências, correções, materiais, recorrência, encerramento e permissões.
- Testes transacionais de requisições concorrentes, crédito único por ciclo, prorrogação, renovação após intervalo, bloqueio de assinatura e ausência de pagamentos/assinaturas artificiais.
- Testes de captura, deduplicação, respostas históricas, vínculo posterior, troca de e-mail, filtros de CRM e contagem mensal sem duplicação ou falso trial.
- Aplicação das duas migrations no mesmo banco e reexecução idempotente, inclusive backfill de conta legada com data desconhecida, status e anotações preservados.
- Navegador: adicionar coprodutor, formalização, Starter, permissões 200/403, CRM, envio real de `/captura`, versão móvel e modal de ajuda.
- `tsc --noEmit` comparado com cópias limpas do mesmo `origin/main`: diagnósticos preexistentes idênticos; não houve novo erro de tipos. Sem executar build.
- A suíte global de journals já falha em `origin/main` por `0110_meta_partner_access`/`0116_meta_partner_access` e `0116_client_report_scopes`/`0121_client_report_scopes`. O teste específico das novas migrations passa. Essas divergências históricas não foram reescritas nesta entrega.

Testes de lógica: `bun test lib/ambassadors/workflow.test.ts lib/ambassadors/permissions.test.ts lib/auth/rbac-core.test.ts lib/backoffice/crm.test.ts lib/backoffice/crm-filters-storage.test.ts lib/backoffice/crm-goals.test.ts tests/capture-ambassadors-migration.test.ts`.

Testes de banco são opt-in (`RUN_AMBASSADOR_DB_TESTS=1` no backoffice e `RUN_CAPTURE_DB_TESTS=1` no frontend) e exigem exatamente o banco local indicado nos testes, previamente preparado com o schema. Não apontar para ambientes compartilhados.

A validação original foi local. O estado da publicação posterior está registrado abaixo. Frontend (3415), backoffice (3416) e PostgreSQL local (55439) foram reabertos a pedido do usuário e permanecem disponíveis para teste.


## Configuração das tags do CRM

No CRM, **Configurar tags** permite a administradores e gestores comerciais alterar nome e cor das etiquetas de campanha e perfil. Os padrões são Campanha Isaac (roxo), Dono de Food Service (verde) e Gestor de Delivery / Consultor (azul). O modal usa componentes do design system, apresenta prévia e salva cada tag individualmente.

A configuração é global para a equipe e persistida em `crm_tag_settings`, com autor e data da última edição. Kanban, lista, detalhes e filtros usam os mesmos nomes. As chaves de atribuição `source:isaac`, `profile:dono` e `profile:gestor` permanecem estáveis; renomear uma tag não altera a origem dos contatos ou os filtros salvos. A cor do texto se ajusta para manter contraste com a cor escolhida.

Migrations adicionais espelhadas: backoffice `0121_crm_tag_settings.sql` e frontend `0128_crm_tag_settings.sql`, mesmo SQL e timestamp. Aplicadas no banco local durante desenvolvimento e em produção na publicação registrada abaixo. A geração isolada preserva os snapshots históricos com colisão.

Seis testes cobrem permissões, nomes/cores válidos, chaves estáveis, contraste, espelhamento e persistência sem alteração dos contatos. O teste de banco exige `RUN_CRM_TAG_DB_TESTS=1` e o banco local descartável. A nova checagem completa de tipos foi interrompida por pressão de memória; não houve build.

Verificação adicional da API local: leitura/edição de admin, leitura de comercial com `canEdit=false`, edição não autorizada 403, anônimo redirecionado ao login e entrada inválida 400. No navegador, nome e cor foram salvos pelo modal, persistiram após recarregamento e apareceram no filtro da campanha e no Kanban. Os rótulos e cores padrão foram restaurados após a verificação.


## Publicação de produção — 22/09/2026

Origin atualizado e incorporado sem conflitos nos dois repositórios: frontend `ff50a2a3` e backoffice `f4aacca`. Foram executados 69 testes selecionados de captura, CRM, permissões, embaixadores e banco local, todos aprovados. A checagem completa de tipos do backoffice retornou exatamente os mesmos diagnósticos preexistentes; a do frontend atingiu o limite de memória nesta tentativa. Nenhum build local foi executado.

Banco de produção confirmado: projeto Supabase `hosjqwtfjjtmphchsuqf`. Os comandos normais de migration foram executados nos dois aplicativos. A auditoria deixou zero pendências e nenhum objeto ausente. A cópia inicial preservou 1.020 contas, 268 registros legados de CRM e 350 eventos: todas as contas possuem contato correspondente, todos os eventos foram copiados e os estágios coincidem. Os três triggers de compatibilidade estão ativos. Nenhum embaixador, benefício Starter ou pagamento foi criado pela migração.

A aplicação dessas migrations precede a publicação de código. Os schemas, SQL e journals estão versionados nos dois repositórios. Permissões reais de embaixadores seguem a gestão explícita em **Acessos da equipe**, sem inferência de identidade pelo nome.
