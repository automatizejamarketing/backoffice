# Backoffice: Pix Automático Efí

Preparação de 01/10/2026, branch `codex/efi-pix-automatico`.

- Identificação do provedor Efí no financeiro, clientes e assinaturas.
- Pix Automático ativo impede emitir uma segunda assinatura por Pix avulso.
- Ações específicas de Stripe/Mercado Pago não são oferecidas para um mandato Efí.
- Líquido sem tarifa real fica pendente, identificado como Efí; nenhuma taxa é estimada.
- Migração `lib/db/migrations/0125_efi_pix_automatico.sql` é idêntica à
  `0132_efi_pix_automatico.sql` do frontend, inclusive hash e timestamp do journal.

O banco é compartilhado. Aplicar a migração por um projeto e auditar pelo outro;
não aplicar as duas entradas como SQL independente. Habilitar
`EFI_PIX_AUTOMATIC_STORAGE_READY=true` neste projeto somente após confirmar os objetos
da migração. Esta flag habilita a guarda contra geração de Pix avulso enquanto existe
mandato Efí em criação, pendente, aprovado ou em revisão.

Checkout, consentimento, cancelamento, webhooks, conciliação e instruções mensais
pertencem ao frontend. As tarifas Efí são reconciliadas pelo frontend; o botão existente
de backfill do backoffice mantém essas linhas pendentes se a tarifa não estiver disponível.

Validação: 54 testes de políticas e financeiro passaram. Checagem global de TypeScript
comparada à base: nenhum erro novo; erros globais preexistentes continuam presentes.
Sem build, alteração em banco compartilhado ou implantação.

Staging do frontend consultado: o deploy atual ainda não contém a integração Efí.
Publicação e migração no banco de testes autorizadas pelo titular; checkout segue desligado
até concluir a configuração. Login, chave Pix e conta recebedora confirmados na Efí.

Guia principal: `../frontend/EFI_PIX_AUTOMATICO.md` no workspace com os dois repositórios.
