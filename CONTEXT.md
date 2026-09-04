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
- configurar a Taxa da Plataforma do Expert, composta por percentual e valor
  fixo e aplicada somente a novas Aquisições; Produtos de Expert herdam
  exclusivamente a configuração do seu proprietário e Produtos do Automatize
  não pagam Taxa da Plataforma;
- configurar a Taxa de Marketplace do Expert (padrão 3%), somada ao percentual
  da Taxa da Plataforma apenas em Aquisições cujo Canal do Checkout é
  `marketplace` (descoberta por dentro do Automatize); vendas pela URL direta
  do produto (`direct`) pagam só a taxa base. O canal e o componente de
  marketplace ficam congelados no pedido (`checkout_channel` e
  `marketplace_fee_basis_points`) e aparecem na tabela de Vendas;
- distinguir custo do Mercado Pago, receita de gateway, coprodução, recebível
  do Expert e receita de Produtos próprios;
- cadastrar um Coprodutor opcional — Automatize ou outro Expert — mantendo o
  proprietário com 100% quando a coprodução estiver desativada;
- registrar reembolso integral — apenas registro: a devolução ao cliente é
  feita manualmente via Pix, fora do sistema, sem chamada de reembolso ao
  provedor. O registro revoga o Acesso, estorna o repasse do Expert no ledger
  e zera a receita líquida da Automatize (e os recebíveis de expert) no
  Pagamento; o valor bruto e o Custo do Provedor permanecem, porque o custo do
  gateway foi pago e não retorna;
- revisar e registrar Saques manuais.

Assinaturas e cobrança: vocabulário canônico em `automatize-frontend/CONTEXT.md`,
seção "Assinaturas e cobrança". Decisão de gateway: ADR 0031 no frontend
(`docs/adr/0031-stripe-cobranca-direta-mercadopago-pix.md`).

Ele não inicia assinatura, não calcula acesso por plano e não executa Split
Payments.

Pix de produto de Expert: saldo liberado na aprovação (**Repasse Manual**, ADR
004). Cartão de produto de Expert com **Conta Stripe do Expert** habilitada:
**Repasse pelo Gateway** — o líquido entra na Stripe do Expert, sem saldo a
pagar no ledger. O **Custo do Provedor** é a tarifa efetiva do gateway (Stripe
ou Mercado Pago) e não reduz o recebível do Expert no modelo `gateway_net_v1`.

## Armazenamento de arquivos

Novas capas, Fotos de Perfil de Expert, PDFs e arquivos são enviados diretamente
para um bucket privado do Cloudflare R2 por uma URL assinada de cinco minutos. O backoffice usa credencial
de leitura e escrita limitada ao bucket; o frontend usa outra credencial,
somente de leitura. Ambos precisam de `CLOUDFLARE_R2_ACCOUNT_ID`,
`PRODUCT_ASSETS_R2_BUCKET`, `PRODUCT_ASSETS_R2_ACCESS_KEY_ID` e
`PRODUCT_ASSETS_R2_SECRET_ACCESS_KEY`.
