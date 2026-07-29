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
