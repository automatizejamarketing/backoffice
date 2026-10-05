# Públicos da Meta no backoffice — design

Data: 2026-10-05. Estado: aprovado explicitamente pelo usuário em 2026-10-05 ("Aprovo.").

## Intenção e escopo acordados

Copiar a experiência atual de criação e gerenciamento de públicos personalizados da Meta e tipos relacionados do `automatize-frontend` para o `backoffice`. O usuário confirmou que a mudança deve alcançar a página **Públicos** e o gerenciador dentro da criação de campanha com IA.

A funcionalidade serve aos operadores do backoffice que gerenciam a biblioteca de públicos de um cliente em uma conta de anúncios. O sucesso é encontrar os mesmos tipos de criação e o mesmo fluxo de edição do frontend, com autorização administrativa e contexto do cliente preservados.

O backoffice já implementa as operações e endpoints. A diferença principal está na interface: o frontend apresenta uma biblioteca compacta e abre apenas o formulário solicitado; o backoffice ainda empilha os formulários de criação e edição.

## Bases e isolamento

- As duas `main` foram atualizadas com `git pull --ff-only origin main` em 2026-10-05.
- Backoffice: base `7c5a273`, branch `feat/backoffice-audiences`, worktree `D:/automatize-marketing/.worktrees/backoffice-audiences/backoffice`.
- Frontend: referência `5942cc2e`, branch isolada `feat/backoffice-audiences`, worktree irmã `D:/automatize-marketing/.worktrees/backoffice-audiences/automatize-frontend`.
- A implementação ocorre na branch do backoffice. O frontend permanece como referência; alterações nele só se houver necessidade comprovada de paridade de uma dependência atingida.
- O criador nativo de worktree retornou `Not a git repository` porque esta conversa está aberta na pasta que contém os dois repositórios. As worktrees foram criadas com `git worktree add` no diretório externo `.worktrees/backoffice-audiences`, seguindo a organização existente.

## Abordagens consideradas

1. **Reaproveitar as APIs administrativas e portar a interface do frontend — escolhida.** Preserva RBAC, carteira, conexão Meta do cliente, revisão e confirmação. A mudança fica concentrada no manager, workspace, editores e entradas de navegação.
2. Copiar a implementação inteira, inclusive rotas e autorização do frontend. Duplicaria infraestrutura já presente e exigiria readequar o modelo de sessão para o contexto administrativo.
3. Extrair um pacote compartilhado entre os dois projetos. Ampliaria a mudança para estrutura de build e publicação, sem necessidade para esta entrega.

## Experiência proposta

### Biblioteca e criação

A biblioteca mostra nome, tipo, tamanho estimado, status Meta e pendência de importação, com paginação e atualização. O botão **Criar público** abre a seleção dos quatro tipos já presentes no frontend:

- **Lista de clientes:** CSV/XLSX, planilha/colunas, prévia, declarações e termos, envio e histórico conforme permissões existentes.
- **Instagram:** perfil profissional, atividade e período.
- **Site:** pixel com atividade, visitantes, URL ou evento e período.
- **Público semelhante:** origem elegível, país e percentual.

Selecionar um tipo abre somente seu formulário. É possível voltar à seleção de tipos, cancelar e retornar à biblioteca. Na página independente o workspace abre em diálogo; dentro da campanha ele abre inline no gerenciador embutido, evitando empilhar um segundo diálogo de edição sobre o painel de campanha.

### Edição e exclusão

O botão **Editar** resolve o editor pelo tipo e pela regra representável, como na fonte: Instagram/site recebem o editor de regra correspondente; listas com permissão comprovada para membros recebem o formulário de atualização já direcionado ao público; os demais recebem metadados. Regras externas/compostas e semelhantes preservam sua formação.

Salvar mantém as etapas existentes de revisão, confirmação e reconciliação e atualiza a biblioteca. Exclusão mantém a revisão de impacto, a confirmação permanente e os bloqueios por dependências. Criar ou editar um público nunca o aplica automaticamente à campanha.

### Contexto administrativo

A entrada continua no marketing do cliente, incluindo a ficha incorporada. O link transmite `userId` e a conta selecionada (`accountId`) e respeita o prefixo `/embed` quando usado nesse contexto.

A página valida a conta solicitada contra as contas acessíveis carregadas para o cliente. Sem conta solicitada, mantém a seleção padrão existente. Com conta solicitada inválida ou inacessível, mostra uma orientação para selecionar outra conta e não abre silenciosamente a biblioteca de uma conta diferente.

Carregamento, erro de consulta, ausência de cliente e ausência de contas têm estados distintos e visíveis. A mudança de cliente ou conta descarta o workspace, cursores, dados e respostas pendentes da seleção anterior. O manager é chaveado por `userId:accountId` nas duas entradas.

## Arquitetura e fluxo de dados

- Portar `audience-kind.ts` e `audience-workspace.tsx` para `app/(admin)/marketing/audiences/`, adaptando o contexto `userId`.
- Atualizar `audience-library-manager.tsx` para a listagem e navegação da fonte; manter uma única implementação para página e campanha, com `surface="page" | "embedded"`.
- Adaptar os editores existentes para `chrome="plain"` e, na importação, os valores iniciais de público/operação usados pelo workspace. Preservar seus contratos de API administrativos.
- Atualizar a página e o link em `marketing-workspace.tsx` para preservar a seleção de conta.
- Usar o manager embutido na aba **Públicos da conta** de `AiAdvancedAudienceSheet`. Manter as abas próprias de idade/gênero, inclusões e exclusões.
- Todas as consultas e mutações continuam em `/api/meta-marketing/[accountId]/audiences`, incluindo `userId`, e nas rotas filhas de `customer-file`.
- Reutilizar o RBAC e a reautorização de acesso ao cliente/conta/objeto existentes no servidor. Tokens Meta não entram no cliente.
- Não há necessidade identificada de dependências novas, schema ou migrations.
- Seguir os componentes e tokens do backoffice; copiar a hierarquia visual e os textos de fluxo da fonte sem introduzir outro sistema de design.

## Requisitos de aceitação

| ID | Requisito | Evidência esperada |
| --- | --- | --- |
| R1 | Página e campanha com IA compartilham o manager atualizado, preservando o escopo `userId + accountId`. | Contrato de integração e screenshots das duas entradas. |
| R2 | Biblioteca apresenta nome, tipo, tamanho, status, pendências, atualização e paginação como na fonte. | Testes dos labels/resolução e fluxo de listagem/paginação no navegador. |
| R3 | Criar público abre os quatro tipos e somente o formulário escolhido; voltar/cancelar funciona. | Screenshots e percurso com agent-browser para os quatro tipos. |
| R4 | Abertura pelo marketing preserva cliente, conta selecionada e contexto `/embed`; conta solicitada inacessível não causa troca silenciosa. | Testes de seleção/navegação e percurso com duas contas. |
| R5 | Carregamento, erro, cliente ausente e contas vazias são distinguidos; trocar cliente/conta invalida o estado anterior. | Testes de resolução/estado e fixtures de erro, vazio e respostas atrasadas no navegador. |
| R6 | Editar abre o editor correspondente; regras externas/compostas e semelhantes preservam sua formação; listas só gerenciam membros com capacidade comprovada. | Testes de classificação, validações existentes e screenshots de edição. |
| R7 | Revisão, confirmação, reconciliação, atualização após salvar e revisão de exclusão continuam funcionando sem ampliar permissões. | Testes herméticos existentes/necessários e percurso de revisão/confirmação/exclusão com fixtures. |
| R8 | A biblioteca embutida não altera as respostas, inclusões ou exclusões da campanha; não há callbacks que apliquem público automaticamente. | Contrato de integração e comparação do estado de campanha antes/depois no navegador. |
| R9 | Desktop e mobile permitem ler, navegar, preencher e fechar os fluxos sem corte horizontal ou controles inacessíveis. | Screenshots desktop/mobile e verificação de largura/rolagem/foco com agent-browser. |
| R10 | Entrega é uma branch de feature commitada, com push e PR contra `main`; merge fica com o usuário. | Commits, branch remota e PR anexado à conversa. |

## Limites herdados e fora do escopo

Preservar os limites e validações da fonte: Instagram 1–365 dias, site 1–180 dias, períodos antigos fora da faixa preservados quando inalterados, fontes comprovadas e origem elegível para semelhantes. Criação de Instagram/site pode ser recusada quando a biblioteca ultrapassa o inventário completo de 200 objetos.

Há uma limitação identificada por leitura estática nos dois projetos: `lib/meta-business/marketing/audiences/read.ts` retorna `manageMembers="unknown"`; a importação só libera destinos com capacidade `available`. Isso impede afirmar que a gestão de membros ou a primeira carga de uma lista funciona contra a Meta real. A cópia da experiência não muda essa política nem transforma uma permissão desconhecida em concedida. Essa limitação deve constar na entrega; a verificação com fixtures demonstra os estados permitidos e bloqueados da UI, sem afirmar sucesso real na Meta.

Não acrescentar compartilhamento, pesquisa/filtros novos, operações em massa, exportação de membros, tipos de público ausentes na interface da fonte, edição de formação de semelhante, regras compostas ou configuração de pixel/CAPI.

## Estratégia de verificação

Usar `bun`, incluindo `bun test` a partir da raiz para a suíte completa, além dos testes focados e TypeScript. Definir `FRONTEND_ROOT`/`BACKOFFICE_ROOT` para os repositórios irmãos corretos. Comparar falhas pré-existentes com a base; nenhuma regressão introduzida é aceitável.

O backoffice roda localmente na worktree com `APP_ENV=staging` e Next em `--webpack`, em porta livre exclusiva. Copiar somente o arquivo staging existente para uso local, sem imprimir segredos. A sessão usa a autenticação local já existente e fica restrita a localhost.

Toda tarefa de UI inclui verificação com **agent-browser (Vercel)** contra o app rodando, com screenshot salvo no workspace deste plano. Interceptar as rotas que dependem da Meta antes de percorrer mutações e usar fixtures determinísticas para lista, fontes, importação, revisão, confirmação, falhas e paginação. Testes herméticos cobrem handlers/primitivas; a interceptação do navegador demonstra a UI e não substitui essa cobertura.

Não executar criação/edição/exclusão na Meta real, migrations ou escrita no banco compartilhado para obter evidências. Evidências persistentes ficam em `docs/superpowers/plans/2026-10-05-backoffice-meta-audiences/evidence/`; relatórios e ledger pertencem ao workspace SDD deste plano. Preservar ledger e evidências para a entrega.

Base medida em 2026-10-05 nas checkouts primárias, nos mesmos SHAs de origem e com Postgres local de teste em `localhost:55452`: backoffice **1651 pass / 8 fail**; frontend **4506 pass / 10 skip / 15 fail / 2 errors**. O Postgres local não estava disponível; há também falhas de contratos de migrations e falhas alheias na fonte. Logs iniciais: `D:/automatize-marketing/.scratch/backoffice-audiences/baseline/`. Medir novamente nas worktrees preparadas antes de implementar para separar efeitos de ambiente dos efeitos da mudança.

## Processo autorizado após aprovação

Esta é a única janela interativa. Após aprovação deste design: escrever o plano com `superpowers:writing-plans`, executar seu self-review e tratar o plano como aprovado, conforme instrução expressa do usuário. Execution Handoff: **Subagent-Driven**, já selecionado.

Executar com `superpowers:subagent-driven-development`: implementers um por vez, review por tarefa, fix loops e ledger. Explorações/verificações independentes podem usar agentes paralelos. Não fazer novas perguntas; decidir ambiguidades rotineiras e registrar cada `Ruling:` com motivo e custo de uma decisão errada. Só parar nas quatro classes permitidas pelo SDD, respeitando as autorizações já concedidas para worktrees, push de feature e PR.

O harness determina o papel `automatize-sonnet-high` para todos os subagentes deste workspace (Sonnet 5.5, High). Essa restrição tem precedência sobre os modelos solicitados pelo usuário; a diferença foi informada na conversa. Não há parâmetro de Fast mode exposto no dispatch.

A avaliação final substitui o review global comum: um avaliador recebe spec, plano, diff integral, ledger e evidências, faz code review, monta matriz R1–R10, executa pessoalmente a suíte completa e os fluxos de UI, e apresenta **APROVADO** ou **REPROVADO**. Reprovação exige correção e nova avaliação até aprovação. A restrição de modelo do harness também se aplica a esse papel.

Entrega: o que foi construído mapeado ao spec, comandos exatos de validação, logs/screenshots, veredito final, todos os **Rulings I made** e defeitos/limitações conhecidos. Não fazer merge.

## Self-review do design

- Requisitos ligados à intenção confirmada: página e contexto IA, públicos Meta.
- Escopo limitado à experiência existente e integração administrativa necessária.
- Contratos de cliente/conta, formulário e campanha explícitos; nenhuma autorização é inferida da listagem.
- Limitações de permissões e do ambiente de testes identificadas sem prometer sucesso real na Meta.
- Nenhum placeholder ou decisão técnica pendente necessário à aprovação.
