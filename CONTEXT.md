# Administração de produtos digitais

O contrato de domínio canônico está no repositório `automatize-frontend`, em
`CONTEXT.md`. Este backoffice compartilha as mesmas tabelas e deve manter os
tipos de Produto, Conteúdo, Expert, Aquisição, Pagamento, Acesso, Ledger e Saque
sincronizados.

O backoffice é responsável por:

- vincular Experts a usuários do Automatize;
- criar e publicar Produtos e Conteúdos;
- consultar Aquisições e Pagamentos;
- executar reembolso integral;
- revisar e registrar Saques manuais.

Ele não inicia assinatura, não calcula acesso por plano e não executa Split
Payments.

## Armazenamento de arquivos

Novas capas, PDFs e arquivos são enviados diretamente para um bucket privado do
Cloudflare R2 por uma URL assinada de cinco minutos. O backoffice usa credencial
de leitura e escrita limitada ao bucket; o frontend usa outra credencial,
somente de leitura. Ambos precisam de `CLOUDFLARE_R2_ACCOUNT_ID`,
`PRODUCT_ASSETS_R2_BUCKET`, `PRODUCT_ASSETS_R2_ACCESS_KEY_ID` e
`PRODUCT_ASSETS_R2_SECRET_ACCESS_KEY`.
