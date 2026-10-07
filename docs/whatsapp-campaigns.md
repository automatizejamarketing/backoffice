# Campanhas de WhatsApp

`/whatsapp/campanhas` permite preparar rascunhos, submeter textos à Meta,
consultar aprovação, selecionar destinatários, enviar manualmente, agendar, pausar e retirar contatos
que ainda estão na fila. As estimativas usam a tabela pública da Meta em BRL para Marketing no Brasil;
o operador define apenas o orçamento máximo. Não representam a fatura da conta.

## Configuração e publicação

- Aplicar `0110_whatsapp_campaigns.sql` pelo migrador do backoffice. A migration
  espelhada no frontend é `0114_whatsapp_campaigns.sql`, com o mesmo hash e `when`.
  São duas tabelas novas; não há alteração dos dados existentes.
  O `when=1799600000001` já aplicado é imutável. Em outros ambientes com watermark
  posterior, executar `db:migrate:status` e o reparo existente para esta migration
  se a auditoria indicar tabelas ausentes; o migrador normal pode ignorá-la.
- Configurar no backoffice `META_WHATSAPP_ACCESS_TOKEN`, `META_WHATSAPP_WABA_ID`
  e `META_WHATSAPP_PHONE_NUMBER_ID`, correspondentes à conta de produção usada
  pelo frontend. `META_GENERAL_APP_SECRET` habilita appsecret_proof.
- O cron usa `CRON_SECRET`. O envio só funciona com
  `WHATSAPP_CAMPAIGNS_ENABLED=true`; deixá-lo ausente durante a preparação.
- A publicação e a ativação dos disparos são etapas separadas da submissão dos
  templates. Nenhuma delas é feita automaticamente pelo código de preparação.
- Leitura e alterações exigem `whatsapp:campaigns`, exclusiva de admin/dev.
  A permissão geral de WhatsApp ou marketing não permite acessar campanhas.

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

Ambos os modos exigem template aprovado com texto idêntico, tarifa oficial disponível e
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


## Pendências antes de ativar os disparos

A revisão Fable não bloqueou a preparação com a flag desligada. Antes da
ativação, verificar estes pontos operacionais no fluxo real:

- Identidade telefônica: validar a correspondência de números móveis recebidos
  com e sem o nono dígito. Hoje a exclusão compara o telefone completo normalizado.
- Envios incertos: disponibilizar uma resolução auditada após conferência na Meta.
  Atualmente ficam sem retry e podem manter a campanha pausada; retomar não
  resolve a incerteza. Não marcar como concluído para ocultar essa pendência.
- Confirmação recebida com falha de persistência: melhorar a recuperação quando
  há ID da Meta, mas a transação local falha. Hoje a campanha pausa por segurança.
- Medir o custo da consulta de público e considerar carregá-la apenas ao configurar
  o envio. A hipótese de lentidão da revisão ainda não foi medida.

Pausar em erros definitivos individuais é uma decisão conservadora desta versão:
permite revisar o erro antes de continuar o lote; não há retry automático. Uma
classificação mais granular dos erros da Meta pode reduzir essas pausas depois.


## Tarifa automática

A referência é consultada no calculador público oficial em
https://whatsappbusiness.com/products/platform-pricing/ (Brasil, BRL, Marketing).
O servidor usa o nonce público fornecido pela página, sem credenciais da conta,
e guarda somente a tarifa por até uma hora. O endpoint do calculador não é uma
API contratual de faturamento: se a página ou a resposta mudar, a consulta falha
sem inventar preço. Rascunhos continuam permitidos; envio exige tarifa válida.
O cliente não escolhe a tarifa: o servidor a substitui ao salvar e confere se
continua igual ao confirmar o envio. Se mudou, exige salvar e revisar novamente.
A moeda real de cobrança pode ser diferente; o valor exibido é referência BRL.

## Envio de teste

**Enviar teste** envia uma cópia do template aprovado para um dos usuários de
`WHATSAPP_CAMPAIGN_TEST_USER_IDS`, usando seu telefone e primeiro nome cadastrados.
O teste independe dos filtros, orçamento e estado da campanha. Exige a permissão
`whatsapp:campaigns`, integração configurada e `WHATSAPP_CAMPAIGNS_ENABLED=true`.
Não cria destinatários oficiais, altera o agendamento ou entra nas métricas da
campanha. A Meta pode cobrar essa mensagem separadamente.

Cada tentativa tem uma chave própria; repetir a mesma requisição não dispara de
novo, mesmo quando a resposta se perde. **Preparar outro teste** inicia uma nova
tentativa explícita. Respostas incertas pedem conferência no telefone, sem retry
automático. O histórico de entrega usa a origem `backoffice_campaign_test`.

## Botão de contato na campanha de 05/10

A versão `outubro_2026_0510_atendimento_v3` usa o botão estático **Falar com a equipe**
com destino `https://www.automatizemarketing.com/contato-direto`. Essa rota pública
do frontend responde com 307 para o `wa.me` original, preservando o número da equipe
e a mensagem preenchida, sem página intermediária. A URL é fixa e não aceita
destinos enviados por query string. A versão v2 mantém sua página de contato original.
Cada nova versão precisa de aprovação da Meta antes de enviar.

A definição do botão fica junto ao texto do lote. Prévia, submissão, teste e
envio oficial conferem o texto e a configuração do botão. O envio de um botão
estático não requer parâmetro de URL no payload da mensagem. Os templates v1
continuam disponíveis; campanhas já enviadas não devem ser alteradas.

## Cliques rastreados

As versões 05/10 v4 e 08, 12 e 26/10 v2 usam o botão dinâmico
`https://www.automatizemarketing.com/contato-direto/{{1}}`. O parâmetro enviado
à Meta é o UUID aleatório do registro em `whatsapp_template_deliveries`, criado
antes da chamada de envio. Não há telefone, email ou destino livre no link.

O frontend reaproveita o repositório de cliques existente: registra o evento e
marca `clicked_at` na entrega. Robôs de prévia conhecidos e requisições HEAD
não contam. Tokens desconhecidos não contam; falhas no registro não impedem o
redirecionamento para o WhatsApp da equipe. Não há cookie nem IP armazenado por
esta rota; links encaminhados ainda são atribuídos à entrega original.

O relatório conta entregas únicas com clique, dividido pelos envios aceitos pela
Meta. Envios de teste ficam fora das métricas oficiais. Zero cliques em templates
rastreáveis aparece como zero; versões antigas continuam como "Não rastreado".
Isso mede acesso ao link, não uma conversa confirmada. Não é possível recuperar
cliques anteriores nem identificar cliques posteriores de links estáticos antigos.
Cada nova versão precisa de aprovação Meta; campanhas já enviadas não são alteradas.
