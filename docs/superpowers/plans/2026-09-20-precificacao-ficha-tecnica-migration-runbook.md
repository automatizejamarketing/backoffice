# Precificação — runbook de migração compartilhada

Este recurso usa o journal PostgreSQL compartilhado por `automatize-frontend` e `backoffice`. As migrations são aditivas e devem ser aplicadas nesta ordem, primeiro a retenção e depois a precificação. Este documento registra a sequência de deploy; nenhuma migration de staging ou produção foi executada nesta tarefa.

## Ordem e identidade

1. **Retenção**
   - frontend: `lib/db/migrations/0122_cancellation_retention.sql`
   - backoffice: `lib/db/migrations/0117_cancellation_retention.sql`
   - `when`: `1800500000000`
   - SHA-256 canônico (SQL normalizado para LF): `17924FFE28792FAAF3854CCFB0E376CA9C49DB68A0ECC48B52112C50EB0419E2`

2. **Precificação**
   - frontend: `lib/db/migrations/0123_pricing.sql`
   - backoffice: `lib/db/migrations/0118_pricing.sql`
   - `when`: `1800600000000`
   - SHA-256: `468B6B3726904FBAE0928F8B1F11317961C5483A877CD17855AF416FB936077D`

As cópias frontend/backoffice devem permanecer byte idênticas depois de normalizar os finais de linha. Em checkouts Windows, a migration de retenção pode aparecer com CRLF e gerar `96E5D4581941ABAC46E5F43AEE7CA7635B5B4294FBC335FE483B1410D34A9945` quando o hash for calculado sobre os bytes físicos; o hash canônico acima é o valor usado para comparar o SQL do journal.

## Comandos de deploy

Com o banco compartilhado apontado por `POSTGRES_URL`, execute em cada repositório, nesta ordem:

```powershell
# automatize-frontend
bun run db:migrate
bun run db:migrate:status

# backoffice
bun run db:migrate
bun run db:migrate:status
```

Depois, confirme no journal que a retenção (`1800500000000`) aparece antes da precificação (`1800600000000`), que os tags são `0122_cancellation_retention`/`0123_pricing` no frontend e `0117_cancellation_retention`/`0118_pricing` no backoffice, e que os hashes correspondem aos valores acima. O backoffice mantém seu executor `scripts/drizzle-migrate-with-baseline.ts` por trás de `bun run db:migrate`; não use `db:push`.

Em desenvolvimento local, valide as migrations no banco QA descartável antes de qualquer deploy. Não execute esses comandos apontando para staging ou produção durante esta tarefa.
