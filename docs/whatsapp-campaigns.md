# Campanhas de WhatsApp

`/whatsapp/campanhas` permite preparar rascunhos, submeter textos à Meta,
consultar aprovação, selecionar destinatários, enviar manualmente, agendar, pausar e retirar contatos
que ainda estão na fila. As estimativas usam a tarifa em reais informada pelo
operador e não representam a fatura da Meta.

## Configuração e publicação

- Aplicar `0110_whatsapp_campaigns.sql` pelo migrador do backoffice. A migration
  espelhada no frontend é `0114_whatsapp_campaigns.sql`, com o mesmo hash e `when`.
  São duas tabelas novas; não há alteração dos dados existentes.
- Configurar no backoffice `META_WHATSAPP_ACCESS_TOKEN`, `META_WHATSAPP_WABA_ID`
  e `META_WHATSAPP_PHONE_NUMBER_ID`, correspondentes à conta de produção usada
  pelo frontend. `META_GENERAL_APP_SECRET` habilita appsecret_proof.
- O cron usa `CRON_SECRET`. O envio só funciona com
  `WHATSAPP_CAMPAIGNS_ENABLED=true`; deixá-lo ausente durante a preparação.
- A publicação e a ativação dos disparos são etapas separadas da submissão dos
  templates. Nenhuma delas é feita automaticamente pelo código de preparação.
- Preserva as permissões existentes: leitura exige `whatsapp:view`; alterações
  também exigem `marketing:write`. Não amplia o acesso do papel comercial.

## Operação

O operador escolhe **Manual · enviar agora** ou **Automático · agendar** em
Configurar envio. O padrão da tela é manual, mas selecionar essa opção não
dispara nada: ainda é preciso escolher o público, conferir os custos e confirmar.
Rascunhos e templates aprovados ficam parados até essa decisão explícita.
O envio manual entra na fila imediatamente após a confirmação e é processado
em lotes; o agendado só fica disponível para processamento no horário escolhido.
Ambos são únicos por campanha, sem recorrência automática. O modo escolhido
fica registrado na campanha e aparece na listagem.

O lote de outubro contém os quatro textos de atendimento de 05, 08, 12 e 26/10.
Vídeos, grupo e a mensagem com segundo CTA de trial permanecem pendentes.
As URLs de atendimento estão no corpo. Apenas `{{1}}` (primeiro nome) é variável.
O texto de 08/10 corresponde às informações publicadas nas páginas Sobre e
Contato do frontend (7 dias grátis e ausência de multa de cancelamento).

### Submissão de 05/10/2026

Submetidos pelo WhatsApp Manager, na conta **AutomatizeJá — Contato**,
WABA `1394004519212111`, categoria Marketing, idioma `pt_BR`:

| Template | ID Meta | Status observado após submissão |
| --- | --- | --- |
| `outubro_2026_0510_atendimento_v1` | `965853266563761` | Ativo — Qualidade pendente |
| `outubro_2026_0810_assinatura_v1` | `4261893187435993` | Em análise |
| `outubro_2026_1210_trafego_v1` | `1648343650223111` | Em análise |
| `outubro_2026_2610_suporte_v1` | `1668398118288526` | Em análise |

Esses status são um registro da submissão, não uma consulta em tempo real.
Nenhum envio a clientes foi executado. Antes da publicação, conferir que as
variáveis de ambiente do backoffice apontam para essa mesma WABA.

Ambos os modos exigem template aprovado com texto idêntico, tarifa positiva e
orçamento suficiente para todo o público selecionado. O agendamento exige
também horário futuro de Brasília.
A seleção exclui contas com trial/assinatura, contas internas, leads em
atendimento e conversas de WhatsApp recebidas. A elegibilidade é conferida de
novo imediatamente antes do envio. Atendimentos e pedidos de exclusão recebidos
fora da plataforma precisam ser refletidos no CRM/seleção pelo operador.

Cada destinatário é reivindicado atomicamente no Postgres. Cron concorrente não
reenvia a mesma linha. Timeouts e interrupções ficam como `unknown`, sem retry
automático; erros do provedor pausam a campanha. Uma mensagem já em envio pode
terminar após a pausa. Webhooks são recebidos pelo frontend no rastreamento
existente; eventos que chegam antes da resposta de envio também são conciliados.

## Validação local

Os testes de integração precisam de um Postgres **descartável** em `127.0.0.1`,
com banco `automatize_whatsapp_test`, vazio. Eles criam e removem suas tabelas e
substituem apenas o HTTP da Meta; nunca enviam mensagens reais.

```sh
WHATSAPP_TEST_DATABASE_URL=postgres://USER@127.0.0.1:55985/automatize_whatsapp_test \
  bun --conditions=react-server test \
  lib/backoffice/whatsapp-campaign-core.test.ts \
  tests/whatsapp-campaigns.integration.test.ts tests/migration-journal.test.ts
```

Cobertura: orçamento, variáveis, telefone, elegibilidade, concorrência,
webhook antecipado, resposta perdida, pausa, exclusão, desligamento e migrations.
