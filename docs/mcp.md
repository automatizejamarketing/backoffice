# MCP do backoffice

Conector MCP para o colaborador usar o backoffice pelo Claude (claude.ai, Claude Desktop ou Claude Code).

## Conectar

A página **Conectar IA** do backoffice (`/ai`, no rodapé do menu) tem o guia passo a passo para Claude, ChatGPT e Claude Code, as perguntas de exemplo por permissão e as conexões ativas. Aparece para quem tem alguma ferramenta (`marketing:read`, que todo cargo com `whatsapp:campaigns` também tem).

- Claude: Configurações → Conectores → Adicionar conector personalizado (a página abre esse formulário já preenchido). Nome `Backoffice Automatize`, URL `https://backoffice.automatizemarketing.com/api/mcp`. Depois Connect.
- ChatGPT (só no navegador; Pro só leitura, Business só admins do workspace, Enterprise/Edu com liberação do admin): Configurações → Apps → Advanced settings → Developer mode; depois Apps → Create → nome, URL e OAuth → Scan Tools → autorizar → Create. Caminho conferido na ajuda da OpenAI (artigo 12584461) em 09/10/2026. `offline_access` é anunciado em `scopes_supported` e aceito sem dar acesso nenhum (todo grant já tem refresh token); pedido sozinho na autorização vale só leitura, e no refresh mantém os escopos do grant.
- Claude Code: `claude mcp add --transport http backoffice-automatize https://backoffice.automatizemarketing.com/api/mcp` e depois `/mcp` → Authenticate.

Em todos, o app abre o login do backoffice (Google ou link por e-mail) e depois a tela de autorização, que mostra só o que o cargo da pessoa pode fazer (`consentItems`), avisa quando o retorno é para o próprio computador (Claude Code) e recusa cargos sem ferramenta. O app age com as permissões de quem autorizou. Cada chamada relê o cargo pelo e-mail: tirar alguém do backoffice corta o conector na hora.

### Conexões ativas e Desconectar

- Uma conexão é a dupla pessoa + app (`actor_email` + `client_id`) com algum token ainda utilizável (`revoked_at` nulo e refresh não vencido). Cada refresh revoga a linha anterior e cria outra, então as linhas da dupla são o histórico da conexão: "Primeira conexão" é a primeira linha (a tabela não distingue revogação por refresh de revogação por Desconectar, então o início da conexão atual não é recuperável), "Última atividade" a mais recente. O app renova ao usar, no máximo uma vez por hora (validade do access token), então a última atividade tem essa precisão.
- Desconectar (`DELETE /api/backoffice/mcp-connections`) revoga todos os tokens vivos da dupla e queima os códigos de autorização não usados, para um consentimento dado segundos antes não virar token depois. Access e refresh param na hora.
- Troca de código, refresh e Desconectar da mesma dupla rodam em transação com `pg_advisory_xact_lock` (`lib/mcp-oauth/store.ts`): sem isso, um refresh que já revogou a linha antiga e ainda não inseriu a nova passaria invisível pelo Desconectar e o token novo continuaria valendo.
- Cada pessoa vê e desconecta as próprias conexões; quem tem `team:manage` (admin) vê as da equipe inteira e desconecta qualquer uma.
- Também dá para desconectar removendo o conector no Claude.

## Ferramentas (campanhas de WhatsApp, permissão `whatsapp:campaigns`)

| Ferramenta | O que faz |
| --- | --- |
| `list_whatsapp_campaigns` / `get_whatsapp_campaign` | Lista e detalha campanhas, status do template na Meta e resultados |
| `save_whatsapp_campaign_draft` | Cria/edita rascunho: texto (sem links), botão (nenhum, "Falar com a equipe" ou link rastreado) e mídia por link público (Drive aceito; vídeo MP4 até 16 MB, imagem até 5 MB) |
| `delete_whatsapp_campaign_draft` | Exclui rascunho sem envios |
| `submit_whatsapp_template` | Manda o template para aprovação da Meta |
| `list_whatsapp_test_contacts` / `send_whatsapp_campaign_test` | Teste para os números habilitados |
| `set_whatsapp_campaign_audience` | Salva os filtros de público e devolve quantos contatos entram |
| `preview_whatsapp_campaign_send` | Prévia (destinatários, custo, horário, impedimentos) com um código de confirmação |
| `confirm_whatsapp_campaign_send` | Agenda ou inicia o envio. Exige o código da prévia; falha se campanha, público ou horário mudaram |
| `set_whatsapp_campaign_paused` | Pausa ou retoma |

Envio real só acontece com `confirm_whatsapp_campaign_send`, que o Claude deve chamar apenas depois que o colaborador aprovar a prévia. A conexão pode ser só leitura (`backoffice:read`): ferramentas de escrita exigem `backoffice:write`.

## Ferramentas de Meta Ads (só leitura, permissão `marketing:read`)

Para o consultor analisar muitos clientes e campanhas de uma vez. Nenhuma escreve na Meta.

| Ferramenta | O que faz | Fonte |
| --- | --- | --- |
| `list_my_clients` | Carteira: saúde do negócio e motivos, assinatura, contas de anúncio, gasto dos últimos 7 dias por moeda, campanhas [AM] no ar e alertas abertos. Paginada (25/50/100) | Banco |
| `portfolio_performance` | Todos os clientes de uma vez: período vs anterior de mesmo tamanho (padrão: últimos 7 dias completos). Gasto, resultados, custo por resultado, compras, receita, ROAS, leads, conversas, CTR de link e variação %. Ordena por gasto, resultado, custo por resultado, ROAS ou pela variação de cada um; filtra por gasto mínimo e por clientes | `meta_tracking_daily_metrics` |
| `list_portfolio_alerts` | Alertas pendentes (abertos ou em andamento) agrupados por cliente, críticos primeiro: `playbook`, `drop` (queda de performance) e `account` (conta de anúncio) | `performance_insights` |
| `get_client_campaigns` | Um cliente ao vivo: campanhas, conjuntos ou anúncios com gasto, resultado pelo objetivo de cada campanha, ROAS, CTR, CPC, CPM, frequência e variação. No nível de campanha também lista as ativas sem gasto, com orçamento | Graph API |

Escopo: o consultor comum só vê os clientes atribuídos a ele (`user_marketing_consultants`), em todas as ferramentas e em qualquer `userId` informado. Premium, dev e admin veem todos; só admin filtra por `consultantEmail`.

Limites e decisões:
- `portfolio_performance` não chama a Meta: lê o histórico diário que o cron `meta-tracking/daily` grava de madrugada (só linhas de campanha, para não contar conjunto e anúncio de novo). Por isso responde em menos de 1 s para a carteira inteira (300+ clientes) e não gasta cota. Os dados vão até ontem; quando o período inclui hoje, a resposta avisa que o dia está incompleto. `dataIssue` marca clientes cuja última coleta não foi completa (ex.: `skipped_reconnect`).
- O dia do histórico (`metric_date`) é o dia no fuso da conta de anúncio; o período é calculado em Brasília. Para contas em São Paulo (quase todas) coincide; para conta em outro fuso, o dia de borda desloca.
- "Resultados" na carteira é a soma do resultado de cada campanha como a Meta define (conversa, compra, lead, clique…). Para comparar clientes de objetivos diferentes, use também as colunas específicas (compras, leads, conversas).
- `get_client_campaigns` lê as contas de anúncio que a conexão enxerga, as de maior gasto recente no histórico primeiro (até 5, as mesmas que a carteira soma; com mais de 5 contas, as que sobram vêm listadas em `notes`, com o id para `adAccountId`; o ranking usa o gasto do período ou dos últimos 30 dias, o que for maior), 2 contas por vez com 2 a 3 chamadas cada, com cache de 5 minutos por consulta (`lib/meta-business/read-cache.ts`). Uma conta com erro aparece em `accounts[].error` e as outras respondem. Até 200 linhas por período, ordenadas por gasto.
- Moedas nunca são somadas: a carteira agrega por cliente e moeda (cliente com conta BRL e USD sai em duas linhas) e os totais vêm por moeda; em `get_client_campaigns` a linha de conta não BRL traz `currency`.
- Respostas enxutas: `portfolio_performance` devolve 50 clientes por padrão (até 200); `list_portfolio_alerts` corta evidência e recomendação em 400 caracteres.
- Ficou para a v2: ações (pausar, ativar, orçamento), detalhe ao vivo de muitos clientes em paralelo e métricas por dia (série).

## Como funciona

- OAuth 2.1 próprio (`lib/mcp-oauth`), portado do conector Mat do frontend: registro dinâmico, PKCE S256, refresh com rotação. Tabelas `backoffice_mcp_oauth_*` (migration 0130), separadas das do Mat: token de cliente nunca autentica o backoffice.
- `/api/mcp` usa `mcp-handler`; as ferramentas ficam em `lib/mcp/` e chamam as mesmas funções da tela.
- As ferramentas de Meta Ads ficam em `lib/mcp/meta-ads-*.ts`: `metrics` (períodos, variação e ordenação, puro), `queries` (banco, com o escopo do consultor), `live` (Graph) e `tools`.
- Para adicionar uma área nova, crie as ferramentas com `defineTool` e a permissão RBAC correspondente e registre em `app/api/mcp/route.ts`. Descreva a área em `MCP_CAPABILITIES` (`lib/mcp/connections.ts`): é o que a página Conectar IA e a tela de autorização mostram, e um teste falha se as permissões das ferramentas e as da página divergirem.

## Links rastreados

Todo link de campanha é medido por pessoa. Links no texto são recusados; o link vai no botão:
- "Falar com a equipe": `https://www.automatizemarketing.com/contato-direto/{{1}}` → WhatsApp de atendimento.
- Link rastreado: o template na Meta aponta para `https://www.automatizemarketing.com/r/{{1}}` (id da entrega) e o destino real fica em `whatsapp_campaigns.button.destination`. A rota `/r` do frontend registra o clique (`whatsapp_template_deliveries.clicked_at`) e redireciona. Como o destino não vai para a Meta, dá para trocá-lo sem nova aprovação.
