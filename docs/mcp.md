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

## Como funciona

- OAuth 2.1 próprio (`lib/mcp-oauth`), portado do conector Mat do frontend: registro dinâmico, PKCE S256, refresh com rotação. Tabelas `backoffice_mcp_oauth_*` (migration 0130), separadas das do Mat: token de cliente nunca autentica o backoffice.
- `/api/mcp` usa `mcp-handler`; as ferramentas ficam em `lib/mcp/` e chamam as mesmas funções da tela.
- Para adicionar uma área nova, crie as ferramentas com `defineTool` e a permissão RBAC correspondente e registre em `app/api/mcp/route.ts`.

## Links rastreados

Todo link de campanha é medido por pessoa. Links no texto são recusados; o link vai no botão:
- "Falar com a equipe": `https://www.automatizemarketing.com/contato-direto/{{1}}` → WhatsApp de atendimento.
- Link rastreado: o template na Meta aponta para `https://www.automatizemarketing.com/r/{{1}}` (id da entrega) e o destino real fica em `whatsapp_campaigns.button.destination`. A rota `/r` do frontend registra o clique (`whatsapp_template_deliveries.clicked_at`) e redireciona. Como o destino não vai para a Meta, dá para trocá-lo sem nova aprovação.
