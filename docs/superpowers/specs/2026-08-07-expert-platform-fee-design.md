# Taxa da plataforma por expert

## Objetivo

Substituir a taxa percentual configurável por produto por uma taxa composta,
configurada por expert. O padrão comercial é **5,49% + R$0,39** por aquisição
paga. Produtos próprios do Automatize não pagam essa taxa; sua receita líquida
é o valor bruto menos o custo efetivo do gateway. A mudança só afeta novas aquisições; vendas anteriores preservam
integralmente seus snapshots financeiros.

Este documento cobre os dois repositórios que compartilham o domínio:
`automatize-backoffice` e `automatize-frontend`.

## Regras de domínio

- Cada Expert possui uma Taxa da Plataforma formada por:
  - percentual em basis points, com padrão de `549`;
  - parcela fixa em centavos, com padrão de `39`.
- Todo Produto de Expert usa a taxa vigente do Expert proprietário no momento
  em que a Aquisição é criada.
- A taxa não pode ser configurada ou substituída no Produto.
- Todo Produto próprio do Automatize usa taxa percentual e fixa iguais a zero.
- Produto gratuito gera Taxa da Plataforma igual a zero.
- Em uma Aquisição paga, a taxa é:

  `min(valor bruto, arredondar(valor bruto * basis points / 10.000) + parcela fixa)`

- Exemplo: em uma venda de R$100,00, a Taxa da Plataforma é R$5,88 e a Base de
  Coprodução é R$94,12.
- O custo efetivo do provedor é absorvido pela receita da Taxa da Plataforma e
  não reduz a Base de Coprodução nem o recebível dos Experts.
- Se o custo do provedor superar a Taxa da Plataforma, a receita da plataforma
  pode ficar negativa. O valor não é transferido aos Experts.
- A coprodução permanece independente: os percentuais do proprietário e do
  coprodutor são aplicados sobre a Base de Coprodução.
- Alterações futuras na taxa do Expert só afetam Aquisições criadas depois da
  alteração.

## Modelo de dados e migração

Adicionar em `expert_profiles`:

- `platform_fee_basis_points integer not null default 549`;
- `platform_fee_fixed_centavos integer not null default 39`.

Adicionar em `product_orders`:

- `platform_fee_fixed_centavos integer` como snapshot da parcela fixa.

Introduzir o modelo financeiro `platform_fee_coproduction_v3`. Novas
Aquisições v3 exigem percentual e parcela fixa válidos. Modelos legados e v2
continuam válidos sem parcela fixa; `null` nesses pedidos históricos equivale a
zero apenas para leitura e recomposição histórica.

A tabela `product_financial_settings` permanece apenas para compatibilidade com
pedidos e versões anteriores; o fluxo v3 não a consulta.

A migration preenche todos os Experts existentes com `549` e `39`. Ela não
reescreve pedidos, pagamentos, ledgers ou repasses anteriores. A coluna
`products.platform_fee_basis_points_override` permanece temporariamente no
banco para compatibilidade de rollback, mas deixa de ser lida e escrita por
novas operações. Sua remoção física fica para uma migration posterior, depois
do rollout estabilizado.

Restrições de banco e validação da aplicação garantem:

- percentual entre `0` e `10.000` basis points;
- parcela fixa maior ou igual a zero;
- taxa final nunca maior que o valor bruto;
- taxa zero em produtos gratuitos.

## Resolução e fluxo financeiro

Na criação da Aquisição:

1. Carregar Produto e proprietário.
2. Se o proprietário for um Expert, carregar a taxa do `expert_profiles`.
3. Se o proprietário for o Automatize, resolver `0` basis points e `0`
   centavos sem consultar configuração externa.
4. Congelar percentual e parcela fixa no `product_orders`.
5. Gerar o checkout usando o preço bruto sem alterar o valor cobrado do
   comprador.
6. Na aprovação, calcular a taxa com os snapshots do pedido, registrar custo do
   provedor e calcular coprodução e recebíveis sobre o bruto menos a taxa.

O cálculo de liquidação nunca consulta a taxa atual do Expert. Webhooks
duplicados reutilizam o mesmo pedido e os mesmos snapshots.

## Experiência no backoffice

Na criação e edição do Expert, exibir um bloco compacto **Taxa da plataforma**:

- campo percentual com máscara `%`, preenchido inicialmente com `5,49%`;
- campo monetário preenchido inicialmente com `R$0,39`;
- texto de apoio com simulação: `Em uma venda de R$100,00, a taxa é R$5,88.`

Na tabela de Experts, exibir a taxa como `5,49% + R$0,39` para facilitar a
auditoria. O salvamento mostra estado de carregamento e mantém o formulário
aberto quando houver erro.

Na criação e edição de Produto, remover o controle de taxa customizada. O
formulário apenas informa que o Produto herda a taxa do Expert proprietário ou,
quando próprio, não paga Taxa da Plataforma.

A configuração global antiga deixa de aparecer no backoffice porque não é
consultada por novas Aquisições.

## APIs e validação

As APIs administrativas de Expert passam a aceitar e retornar:

- `platformFeePercent` como número decimal entre 0 e 100;
- `platformFeeFixedCentavos` como inteiro não negativo.

Os endpoints de Produto deixam de aceitar `platformFeePercentOverride`. Durante
o rollout, um cliente antigo que ainda envie o campo não altera a taxa efetiva;
o servidor ignora o valor em vez de persistir um novo override.

Mensagens de erro devem distinguir percentual inválido, parcela fixa inválida e
Expert sem configuração financeira consistente. Falha ao resolver a taxa
impede a criação do checkout; não existe fallback silencioso para uma taxa de
Produto.

## Compatibilidade e rollout

1. Aplicar a mesma migration compartilhada pelos schemas do frontend e do
   backoffice.
2. Publicar o backoffice com edição por Expert e sem override por Produto.
3. Publicar o frontend com resolução por Expert e snapshots v3.
4. Confirmar uma compra Pix e uma compra por cartão em ambiente controlado.
5. Conferir pedido, pagamento, custo do provedor, receita da plataforma, Base de
   Coprodução, ledger e acesso.
6. Monitorar erros de criação de checkout e divergências financeiras antes de
   remover a coluna legada de override.

O rollout deve ser compatível com pedidos em aberto: pedidos criados antes da
mudança mantêm o modelo e os snapshots antigos mesmo quando forem aprovados
depois do deploy.

## Testes e critérios de aceite

- Produto de Expert resolve `549` basis points e `39` centavos a partir do
  Expert proprietário.
- Dois Produtos do mesmo Expert usam a mesma configuração.
- Alterar a taxa do Expert não modifica pedido já criado.
- Produto do Automatize usa taxa zero e registra como receita líquida o bruto
  menos o custo do provedor.
- Produto gratuito gera taxa zero.
- R$100,00 com 5,49% + R$0,39 gera taxa de R$5,88 e Base de Coprodução de
  R$94,12.
- A taxa é limitada ao bruto em preços muito baixos.
- Pedido v2 sem parcela fixa preserva o cálculo histórico percentual.
- Coprodução divide apenas a Base de Coprodução.
- Custo do provedor reduz somente a receita da plataforma.
- Webhook repetido não duplica pagamento, ledger ou acesso.
- Criação e edição de Expert validam, persistem e retornam os dois componentes.
- Formulário de Produto não apresenta nem envia override de taxa.
- Tabela de Experts exibe a taxa configurada em formato legível.

Os testes abrangem o cálculo financeiro, a resolução da configuração, os
snapshots do pedido, os parsers administrativos e a liquidação. Não será usado
comando de build.
