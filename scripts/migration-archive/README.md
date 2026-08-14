# Migration archive

Arquivos `.sql` que existiam em `lib/db/migrations/` **sem entrada correspondente
no `meta/_journal.json`** — o migrador do drizzle nunca os executa (ele só roda o
que está no journal), e os prefixos numéricos duplicados quebravam o
`drizzle-kit generate` ("snapshot collision").

Movidos para cá em 2026-06-09 durante a regularização dos snapshots. O conteúdo é
preservado por histórico; os hashes registrados em `drizzle.__drizzle_migrations`
não dependem destes arquivos.

| Arquivo | Situação |
|---|---|
| `0007_dear_wolverine.sql` | Órfão; o journal referencia `0007_masterclass_courses_lessons` para o idx 7. |
| `0008_remarkable_giant_girl.sql` | Órfão; o journal referencia `0008_reflective_supernaut` para o idx 8. |

Obs.: `0014_staging_backoffice_schema_repair.sql` também não está no journal
(aplicado manualmente com hash registrado direto no banco — repair de
2026-06-07). Desde então saiu de `lib/db/migrations/` e vive em
`scripts/orphaned-migrations/`, junto com os outros `.sql` mantidos fora do
caminho do migrador.

Obs.: em 2026-08-14 os dois órfãos que restavam em `lib/db/migrations/` —
`0040_payments_reversal.sql` e `0041_referral_program_v2.sql` — seguiram o
caminho oposto: em vez de arquivados, ganharam entrada no journal
(`when` 1792250000000 e 1792300000000). São cópias byte-idênticas de
`frontend/0043_payments_reversal` e `frontend/0044_referral_program_v2`, e o
hash das duas já estava em `drizzle.__drizzle_migrations` de staging E produção
— entram como `applied`, sem nada para executar.

Não mova arquivos de volta para `lib/db/migrations/` sem criar a entrada no
journal — e só faça isso se tiver certeza de que o SQL é idempotente e ainda
não aplicado em todos os ambientes.
