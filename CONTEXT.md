# Administração de produtos digitais

O contrato de domínio canônico está no repositório `automatize-frontend`, em
`CONTEXT.md`. Este backoffice compartilha as mesmas tabelas e deve manter os
tipos de Produto, Conteúdo, Expert, Aquisição, Pagamento, Acesso, Ledger e Saque
sincronizados.

O backoffice é responsável por:

- vincular Experts a usuários do Automatize;
- gerenciar a identidade pública do Expert, incluindo sua Foto de Perfil;
- criar e publicar Produtos e Conteúdos;
- consultar Aquisições e Pagamentos;
- consultar as Taxas da Plataforma e de Marketplace dos modelos anteriores;
  ambas têm valor efetivo zero na regra vigente de divisão sobre o líquido;
- distinguir o Canal do Checkout da base financeira da divisão;
- distinguir custo do Mercado Pago, receita de gateway, coprodução, recebível
  do Expert e receita de Produtos próprios;
- administrar a Participação do Automatize por Produto, com o percentual
  complementar para o Expert Proprietário e preservação da condição de cada
  Aquisição; outros Experts como Coprodutores não são admitidos nesta entrega;
- tratar o Reembolso Integral da Cobrança, abrangendo principal e ofertas
  adicionais pagas juntas e apresentando todos os itens e o total da devolução;
  a confirmação integral pelo Mercado Pago revoga os Acessos dessas Aquisições,
  sem revogá-los por processamento, falha ou incerteza da devolução e preservando
  outras origens válidas de Acesso; respeitar Suspensão por Contestação existente;
  custos remanescentes seguem o rateio aprovado, distinto do reembolso;
- revisar e registrar Saques manuais.

Assinaturas e cobrança: vocabulário canônico em `automatize-frontend/CONTEXT.md`,
seção "Assinaturas e cobrança". Decisão de gateway: ADR 0031 no frontend
(`docs/adr/0031-stripe-cobranca-direta-mercadopago-pix.md`).

Ele não inicia assinatura, não calcula acesso por plano e não executa Split
Payments.

Nas novas vendas de Produtos, Pix e cartão usam Mercado Pago, com Split
Inicial entre Expert e Automatize sobre o Líquido da Venda. Cobranças Legadas
preservam Stripe ou Pix com Repasse Manual e suas condições originais.
Assinaturas e Packs permanecem fora dessa mudança. A especificação canônica
da entrega está no tracker local do frontend, na iniciativa
mercado-pago-produtos-split; seus tickets podem envolver os dois projetos.

## Vocabulário da divisão de novas vendas

**Conta Mercado Pago do Expert**: conta de recebimento autorizada pelo próprio
Expert para suas vendas de Produtos. O vínculo válido é obrigatório para
habilitar novas vendas pagas, conforme o glossário canônico do frontend.

**Reconexão da Conta Mercado Pago**: renovação pelo Expert da autorização da
mesma conta, disponível diretamente em seu painel.

**Troca da Conta Recebedora**: substituição por outra conta Mercado Pago, com
liberação do backoffice e autorização do Expert, pausando novas cobranças até
a resolução confirmada das pendentes na conta anterior. Afeta somente novas
cobranças; pagamentos anteriores preservam a conta original.

**Disponibilidade do Meio de Pagamento**: condição da conta recebedora para
aceitar cobranças por Pix ou cartão, distinta de uma recusa individual. Com
conexão válida, manter vendas pelo meio disponível e apto à divisão.

**Canal do Checkout**: origem da Aquisição pelo link direto do Expert ou pelo
catálogo do Automatize, preservada para atribuição e relatórios. A Participação
do Automatize no Produto é a mesma nos dois canais.

**Participação do Automatize**: percentual escolhido expressamente por Produto
sobre o Líquido da Venda, de 0% a 99,99% com até duas casas decimais, sem valor
padrão e obrigatório antes de habilitar vendas de novos Produtos pagos de
Expert. O Expert recebe o complementar, conforme a condição preservada na
Aquisição.

**Rateio do Custo do Provedor**: distribuição da tarifa da cobrança
proporcionalmente ao valor comercial de cada Produto, sem Juros do Comprador.
Cada Produto mantém sua participação sobre o líquido individual, conforme o
glossário canônico do frontend.

**Arredondamento da Divisão**: regra canônica de maiores frações no rateio, com
desempate fixo, e parcela do Expert arredondada ao centavo mais próximo, com
meio centavo a seu favor. O Automatize recebe o complementar do líquido de
cada Produto, preservando os totais.

**Mínimo Monetário da Participação**: R$0,01 por Produto pago de Expert para
cada parte com percentual positivo, após rateio e arredondamento. O 0%
escolhido expressamente para o Automatize é isento desse mínimo.

**Operador de Reembolso**: integrante autorizado da equipe do Automatize
que executa devoluções pelo backoffice. O Expert acompanha o resultado de
suas próprias vendas no painel, sem executar a devolução diretamente.

**Reembolso Integral da Cobrança**: devolução de todas as Aquisições pagas
juntas, incluindo principal e ofertas adicionais. É a única modalidade iniciada
pelo Automatize nesta versão: sem item isolado, valor parcial ou complemento
de cobrança previamente parcialmente devolvida.

**Solicitação de Reembolso**: pedido do comprador para devolver integralmente
a cobrança, com todos os itens pagos juntos, registrado junto à compra no
Automatize com protocolo, data e hora e confirmação imediata de recebimento.
O comprador acompanha seu andamento e a equipe autorizada conduz a devolução
pelo backoffice. O pedido não equivale a dinheiro devolvido nem revoga Acesso;
a consulta da própria compra e do pedido permanece após seu encerramento.

**Prazo de Solicitação de Reembolso**: janela uniforme de sete dias corridos
para pedir a devolução integral por desistência, desde a data mais recente
entre pagamento confirmado e disponibilização efetiva do acesso aos itens
da cobrança. Vale para Produtos próprios e de Experts em ambos os meios
e canais. Abertura ou download não elimina a possibilidade; vale a data
da solicitação, preservando outros direitos após o prazo. Não é o prazo
de processamento financeiro da devolução.

**Reembolso Parcial Externo**: devolução de parte da cobrança iniciada fora
do Automatize e confirmada pelo provedor, registrada pelo valor efetivo e
acumulado e encaminhada como exceção à equipe. Mantém os Acessos enquanto
parcial, respeitando outros bloqueios; não identifica um item cancelado nem
dispara devolução do restante. Impede nova emissão de reembolso pelo Automatize
nesta versão. Total devolvido confirmado aplica a revogação integral dos
Acessos dessa cobrança.

**Custo Remanescente da Reversão**: custo efetivo do provedor que permanece
após reembolso integral ou chargeback definitivamente perdido, descontados
créditos referentes ao mesmo custo. Expert e Automatize o repartem pelos
percentuais originais da Aquisição, sem dupla cobrança. Diferenças nos débitos
efetivos são tratadas pelo Acerto de Custos de Pós-venda.

**Rateio dos Custos de Reversão**: atribuição dos custos comuns aos Produtos
proporcionalmente aos seus valores comerciais originais, preservando custos
e créditos específicos. Cada Aquisição aplica seus percentuais originais;
centavos entre itens seguem maiores frações e desempate fixo. O custo do Expert
é arredondado ao centavo mais próximo, para baixo no empate de meio centavo;
o Automatize assume o complementar, conservando o custo total.

**Acerto de Custos de Pós-venda**: transferência manual entre Expert e Automatize
para liquidar a diferença entre o custo remanescente de responsabilidade de
cada parte e o que ela efetivamente suportou, revisada e registrada no backoffice
com comprovante e confirmação. Não corrige o Split Inicial nem compensa vendas
futuras ou adianta a parcela devida pelo Expert.

**Pendência de Reembolso por Saldo**: devolução integral não concluída por falta
de saldo, acompanhada pela equipe autorizada com aviso imediato e meta de
regularização de 24 horas corridas desde a primeira falha confirmada. A parte
responsável regulariza sua própria conta para nova tentativa, sem adiantamento
automático da parte do Expert pelo Automatize.

**Pausa de Vendas por Reembolso Pendente**: impedimento de novas cobranças pagas
dos Produtos do Expert quando a falta de saldo de sua responsabilidade persistir
após as 24 horas de regularização, com prioridade de resolução pela equipe.
A retomada exige reembolsos motivadores confirmados e liberação do backoffice.
Falta de saldo do Automatize não gera essa pausa; outros bloqueios permanecem.

**Revogação por Reembolso**: retirada dos Acessos das Aquisições da cobrança
após confirmação do reembolso integral pelo Mercado Pago. Processamento,
falha ou incerteza não provocam essa revogação nem removem uma Suspensão por
Contestação; outras origens válidas são preservadas.

**Contestação de Cartão**: disputa da cobrança apresentada pelo comprador ao
banco, com abertura e desfecho acompanhados pelo Mercado Pago. A equipe autorizada
do Automatize conduz o acompanhamento e a defesa, com informações complementares
do Expert.

**Contestação Parcial de Cartão**: disputa confirmada pelo provedor como
restrita a parte da cobrança. Mantém os Acessos das Aquisições durante a
análise e após perda apenas parcial, respeitando outros bloqueios, com
acompanhamento pela equipe e visibilidade ao Expert envolvido. O valor
isolado não identifica um item cancelado; falta de informação não comprova
parcialidade. Se abranger toda a cobrança, aplica-se Suspensão por Contestação.

**Histórico de Evidências da Compra**: registros das condições e do pagamento,
da concessão de Acesso, da abertura autenticada da área do Produto e das
solicitações autorizadas de materiais, com usuário, data e hora. Cada registro
descreve a ação observada, sem presumir consumo integral do Conteúdo.

**Retenção de Evidências**: guarda de cada registro detalhado por 12 meses desde
o evento e das evidências de contestação durante o caso e por 12 meses após
encerramento confirmado, respeitando preservações específicas. Sua expiração
não elimina compras, pagamentos ou direitos de acesso sujeitos a guarda própria.

**Defesa da Contestação**: conjunto de documentos preparado e revisado pela
equipe autorizada do Automatize para apresentar a venda ao Mercado Pago. O envio
ocorre pelo backoffice mediante ação explícita da equipe, com registro dos
documentos, operador e resultado.

**Suspensão por Contestação**: interrupção temporária dos Acessos da cobrança
com contestação integral de cartão confirmada pelo Mercado Pago, durante a análise.
Outras compras, planos válidos e a conta do comprador permanecem disponíveis.

**Suspensão por Suspeita de Fraude Pix**: interrupção temporária dos Acessos
originados pela cobrança durante bloqueio cautelar ou análise de MED por
suspeita de fraude, confirmados pelo Mercado Pago e vinculados a esse Pix.
Preserva outras compras, planos, conta e consulta do histórico. Não equivale
a devolução concluída nem a fraude comprovada de uma pessoa; reclamação
genérica ou restrição da conta do Expert não basta para aplicá-la.

**Restauração após Análise Pix**: retomada automática dos Acessos suspensos
por uma ocorrência Pix quando o Mercado Pago confirma seu encerramento sem
fraude e a compra continua válida, sem anulação nem devolução integral.
Remove somente a suspensão dessa ocorrência, respeitando outros bloqueios.
Liberação de saldo ou passagem de tempo isoladas não comprovam o desfecho.

**Revogação por Fraude Pix Confirmada**: retirada dos Acessos originados
por pagamento que o Mercado Pago confirmou como invalidado por fraude,
mesmo com recuperação financeira parcial ou inexistente. Preserva outras
origens válidas de Acesso e a conta do comprador. Não equivale a reembolso
integral nem elimina a pendência financeira do valor não recuperado.

**Desfecho de Acesso por Contestação**: restauração automática dos Acessos após
confirmação de que a contestação terminou com a compra ainda paga, respeitando
outros bloqueios vigentes. Anulação definitiva ou devolução integral ao comprador
revoga os Acessos dessa compra, preservando outras origens válidas.

**Produto**: oferta digital própria do Automatize ou de um único Expert,
vendida dentro da plataforma, conforme o glossário canônico do frontend.
Não inclui Assinatura da plataforma ou Pack de créditos, que pertencem ao
domínio de assinaturas e cobrança.

**Checkout de Produto**: etapa de pagamento dentro do Automatize, conforme o
glossário canônico do frontend.

**Cobrança Legada de Produto**: cobrança efetivamente emitida no provedor
antes do corte de migração, que termina no gateway, conta e condições originais.
Pode incluir cartão Stripe e Pix com Repasse Manual; pedido local antigo sem
cobrança emitida não autoriza nova emissão no modelo anterior.

**Saldo de Repasse Legado**: valor de Cobranças Legadas de Produto ainda
devido pelo Automatize ao Expert no modelo de Repasse Manual, respeitando
liberações, reversões e reservas. Não inclui recebimentos já pagos por gateway
ou pelo novo Split Inicial. Qualquer saldo disponível e positivo pode ser
solicitado integralmente, sem o mínimo anterior de R$100, mantendo revisão
e pagamento com comprovante pelo backoffice.

**Split Inicial**: termo canônico definido no CONTEXT.md do frontend; divisão
integral do Líquido da Venda entre Expert e Automatize na própria cobrança.
A decisão para novas vendas está no ADR 0032 do frontend; a viabilidade técnica
da garantia ainda está em validação no plano de marketplace.

**Parcelamento do Produto**: compra avulsa no cartão em até 12 parcelas,
com juros pagos pelo comprador. Os Juros do Comprador são separados do
Valor da Venda e da base de divisão, conforme o glossário canônico do frontend.

## Armazenamento de arquivos

Novas capas, Fotos de Perfil de Expert, PDFs e arquivos são enviados diretamente
para um bucket privado do Cloudflare R2 por uma URL assinada de cinco minutos. O backoffice usa credencial
de leitura e escrita limitada ao bucket; o frontend usa outra credencial,
somente de leitura. Ambos precisam de `CLOUDFLARE_R2_ACCOUNT_ID`,
`PRODUCT_ASSETS_R2_BUCKET`, `PRODUCT_ASSETS_R2_ACCESS_KEY_ID` e
`PRODUCT_ASSETS_R2_SECRET_ACCESS_KEY`.
