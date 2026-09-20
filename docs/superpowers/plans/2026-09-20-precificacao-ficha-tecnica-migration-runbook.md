# Consolidação das migrações de retenção, precificação e estoque

O frontend e o backoffice compartilham o mesmo PostgreSQL e a tabela `drizzle.__drizzle_migrations`. A aplicação das três features em 20/09/2026 usou somente os SQL aditivos abaixo, em uma transação por ambiente. Os arquivos de retenção e precificação são idênticos entre os dois repositórios após normalizar CRLF para LF; foram executados uma única vez por banco. O estoque tem SQL somente no frontend e schema espelhado no backoffice.

| Ordem | Frontend | Backoffice | `when` staging | `when` main/produção |
| --- | --- | --- | ---: | ---: |
| 1 | `0122_cancellation_retention.sql` | `0117_cancellation_retention.sql` | 1800110000000 | 1800500000000 |
| 2 | `0123_pricing.sql` | `0118_pricing.sql` | 1800120000000 | 1800600000000 |
| 3 | `0124_smart_stock.sql` | schema espelhado | 1800130000000 | 1800700000000 |
| 4 | `0125_smart_stock_ingredient_edit_keys.sql` | schema espelhado | 1800140000000 | 1800800000000 |

SHA-256 canônico, com finais de linha LF, na mesma ordem: `17924ffe28792faaf3854ccfb0e376ca9c49db68a0ecc48b52112c50eb0419e2`, `1ad422ecb99ca2f72f538ca05c74878d8e58ff7de699c2e2c1f7fdd7db129cf0`, `c661efd060c031667797f341df1038c228ed38d8d4ab9c29f41b8b43d69aefb7`, `81c40694c08223694c6081e646b958946277ac0344944402ba82565c132e3d53`. O journal registra o hash dos bytes do checkout que executou a migração; a auditoria aceita LF e CRLF.

## Execução e conferência

Os dois bancos não tinham objetos dessas features antes da aplicação. O processo conferiu o projeto Supabase, a marca d'água do journal, a ausência dos novos objetos e a identidade dos SQL de frontend/backoffice. Cada transação executou apenas `CREATE TABLE`, `CREATE INDEX` ou `ALTER TABLE ... ADD COLUMN/CONSTRAINT`, inseriu os hashes no journal e comparou o catálogo completo de colunas e a contagem de linhas de `users`, `payments` e `mercadopago_payment_links` antes do commit. Não houve `DROP`, `DELETE`, `TRUNCATE` ou `UPDATE`.

| Banco | Projeto Supabase | Marca inicial | Marca final | Colunas antigas preservadas | Linhas antes/depois (`users`, `payments`, `mercadopago_payment_links`) |
| --- | --- | ---: | ---: | ---: | --- |
| Staging | `wsbsnzgzqiehqnklzchm` | 1800000000000 | 1800140000000 | 2721 | 135, 16, 8 |
| Produção | `hosjqwtfjjtmphchsuqf` | 1800300000000 | 1800800000000 | 2605 | 1002, 340, 176 |

Em cada banco foram criadas 15 tabelas e seis colunas. Uma leitura independente após o commit confirmou os hashes, as colunas de retenção e as tabelas de retenção e precificação. Em staging, os três índices da migração histórica `backoffice/0112_playbook_alert_dashboard_indexes.sql` já existiam com a definição esperada; o hash dessa migração foi registrado em `when=1800100000000` antes das quatro migrações novas.

Não execute `db:push` nem o `db:migrate` genérico para repetir esta entrega. Os dois repositórios compartilham uma marca d'água única e têm sequências diferentes; o migrador genérico pode pular entradas antigas silenciosamente. Para qualquer ambiente adicional, confira os objetos físicos e aplique somente os SQL pendentes, em ordem e em transação, registrando seus hashes após a execução.

O `drizzle-kit check` continua encontrando colisões entre snapshots históricos (`0016`/`0020` no frontend e `0017`/`0024` no backoffice), anteriores a esta integração. Os snapshots finais destas features foram gerados do schema completo de cada branch; os do frontend incluem as sete tabelas de estoque.
