# MCP do backoffice

Conector MCP para o colaborador usar o backoffice pelo Claude (claude.ai, Claude Desktop ou Claude Code).

## Conectar

1. No Claude: Configurações → Conectores → Adicionar conector personalizado.
2. URL: `https://backoffice.automatizemarketing.com/api/mcp`
3. O Claude abre o login do backoffice (Google ou link por e-mail) e depois a tela "Conectar … ao backoffice". Clique em Autorizar.

O Claude age com as permissões de quem autorizou. Cada chamada relê o cargo pelo e-mail: tirar alguém do backoffice corta o conector na hora. Para desconectar, remova o conector no Claude.

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
| `list_my_clients` | Carteira: saúde do negócio e motivos, assinatura, contas de anúncio, gasto dos últimos 7 dias, campanhas [AM] no ar e alertas abertos. Paginada (25/50/100) | Banco |
| `portfolio_performance` | Todos os clientes de uma vez: período vs anterior de mesmo tamanho (padrão: últimos 7 dias completos). Gasto, resultados, custo por resultado, compras, receita, ROAS, leads, conversas, CTR de link e variação %. Ordena por gasto, resultado, custo por resultado, ROAS ou pela variação de cada um; filtra por gasto mínimo e por clientes | `meta_tracking_daily_metrics` |
| `list_portfolio_alerts` | Alertas pendentes (abertos ou em andamento) agrupados por cliente, críticos primeiro: `playbook`, `drop` (queda de performance) e `account` (conta de anúncio) | `performance_insights` |
| `get_client_campaigns` | Um cliente ao vivo: campanhas, conjuntos ou anúncios com gasto, resultado pelo objetivo de cada campanha, ROAS, CTR, CPC, CPM, frequência e variação. No nível de campanha também lista as ativas sem gasto, com orçamento | Graph API |

Escopo: o consultor comum só vê os clientes atribuídos a ele (`user_marketing_consultants`), em todas as ferramentas e em qualquer `userId` informado. Premium, dev e admin veem todos; só admin filtra por `consultantEmail`.

Limites e decisões:
- `portfolio_performance` não chama a Meta: lê o histórico diário que o cron `meta-tracking/daily` grava de madrugada (só linhas de campanha, para não contar conjunto e anúncio de novo). Por isso responde em menos de 1 s para a carteira inteira (300+ clientes) e não gasta cota. Os dados vão até ontem; quando o período inclui hoje, a resposta avisa que o dia está incompleto. `dataIssue` marca clientes cuja última coleta não foi completa (ex.: `skipped_reconnect`).
- O dia do histórico (`metric_date`) é o dia no fuso da conta de anúncio; o período é calculado em Brasília. Para contas em São Paulo (quase todas) coincide; para conta em outro fuso, o dia de borda desloca.
- "Resultados" na carteira é a soma do resultado de cada campanha como a Meta define (conversa, compra, lead, clique…). Para comparar clientes de objetivos diferentes, use também as colunas específicas (compras, leads, conversas).
- `get_client_campaigns` lê as contas que o cliente habilitou (principal primeiro, até 5), 2 a 3 chamadas por conta em paralelo, com cache de 5 minutos por consulta (`lib/meta-business/read-cache.ts`). Uma conta com erro aparece em `accounts[].error` e as outras respondem. Até 200 linhas por período, ordenadas por gasto.
- Moedas nunca são somadas: a carteira agrega por cliente e moeda (cliente com conta BRL e USD sai em duas linhas) e os totais vêm por moeda; em `get_client_campaigns` a linha de conta não BRL traz `currency`.
- Respostas enxutas: `portfolio_performance` devolve 50 clientes por padrão (até 200); `list_portfolio_alerts` corta evidência e recomendação em 400 caracteres.
- Ficou para a v2: ações (pausar, ativar, orçamento), detalhe ao vivo de muitos clientes em paralelo e métricas por dia (série).

## Como funciona

- OAuth 2.1 próprio (`lib/mcp-oauth`), portado do conector Mat do frontend: registro dinâmico, PKCE S256, refresh com rotação. Tabelas `backoffice_mcp_oauth_*` (migration 0130), separadas das do Mat: token de cliente nunca autentica o backoffice.
- `/api/mcp` usa `mcp-handler`; as ferramentas ficam em `lib/mcp/` e chamam as mesmas funções da tela.
- As ferramentas de Meta Ads ficam em `lib/mcp/meta-ads-*.ts`: `metrics` (períodos, variação e ordenação, puro), `queries` (banco, com o escopo do consultor), `live` (Graph) e `tools`.
- Para adicionar uma área nova, crie as ferramentas com `defineTool` e a permissão RBAC correspondente e registre em `app/api/mcp/route.ts`.

## Links rastreados

Todo link de campanha é medido por pessoa. Links no texto são recusados; o link vai no botão:
- "Falar com a equipe": `https://www.automatizemarketing.com/contato-direto/{{1}}` → WhatsApp de atendimento.
- Link rastreado: o template na Meta aponta para `https://www.automatizemarketing.com/r/{{1}}` (id da entrega) e o destino real fica em `whatsapp_campaigns.button.destination`. A rota `/r` do frontend registra o clique (`whatsapp_template_deliveries.clicked_at`) e redireciona. Como o destino não vai para a Meta, dá para trocá-lo sem nova aprovação.
