# Harness de verificação — Biblioteca de mídias

Usado por toda tarefa de UI do plano `../2026-10-13-media-library.md` e pela avaliação final.
Tudo roda contra o banco de **STAGING** (`wsbsnzgzqiehqnklzchm`) e um S3 **local** (LocalStack)
no lugar do R2. **Produção nunca.**

```bash
FE=/d/automatize-marketing/.worktrees/media-library/automatize-frontend
BO=/d/automatize-marketing/.worktrees/media-library/backoffice
SCRATCH="C:/Users/rafae/AppData/Local/Temp/claude/D--automatize-marketing/e4b12813-4a56-4b63-80c0-6f66a437c3a9/scratchpad"
FIX="$SCRATCH/verification/fixtures"          # produto-roxo.png, produto-teste.jpg, video-curto.mp4, imagem-grande.png (17 MB)
EVID_FE="$FE/docs/superpowers/plans/2026-10-13-media-library/evidence"
EVID_BO="$BO/docs/superpowers/plans/2026-10-13-media-library/evidence"
```

## 1. S3 local (LocalStack no lugar do R2)

```bash
docker ps --filter name=automatize-media-s3 --format '{{.Status}}'      # precisa dizer "Up"
# se não existir:
docker run -d --name automatize-media-s3 -p 127.0.0.1:4566:4566 -e SERVICES=s3 -e DISABLE_CORS_CHECKS=1 -e DISABLE_CUSTOM_CORS_S3=1 localstack/localstack:4.4
# se estiver parado: docker start automatize-media-s3
cd $FE && bun docs/superpowers/plans/2026-10-13-media-library/support/setup-local-s3.ts   # bucket + CORS (idempotente; o LocalStack perde o bucket ao reiniciar)
```

Os `.env.staging` das duas worktrees (ignorados pelo git) já têm o bloco
`MEDIA_R2_ENDPOINT=http://localhost:4566`, `MEDIA_R2_BUCKET=automatize-media-local`,
`MEDIA_PUBLIC_BASE_URL=http://automatize-media-local.s3.localhost.localstack.cloud:4566` e chaves
fictícias. `MEDIA_R2_ENDPOINT` só tem efeito depois da Tarefa 3.

Se os fixtures sumirem, regenere:
```bash
mkdir -p "$FIX" && cd "$FIX"
ffmpeg -loglevel error -y -f lavfi -i "color=c=0x4C49BE:s=800x800" -frames:v 1 produto-roxo.png
ffmpeg -loglevel error -y -f lavfi -i "testsrc=s=1080x1080" -frames:v 1 -q:v 3 produto-teste.jpg
ffmpeg -loglevel error -y -f lavfi -i "testsrc=s=720x1280:r=24" -t 3 -pix_fmt yuv420p -c:v libx264 video-curto.mp4
ffmpeg -loglevel error -y -f lavfi -i "nullsrc=s=2600x2600,geq=random(1)*255:128:128" -frames:v 1 imagem-grande.png
```

## 2. App do cliente (frontend) — porta 3000

Conta de teste (allowlist): `viniciushack@layback.trade` (id `384f3178-3946-4fe5-b686-7f30adf16999`),
onboarding completo, acesso até 2026-10-24. A impersonação em modo `env` já está gravada em
`$FE/.env.impersonation.local` (sem cookie; refazer com
`cd $FE && bun scripts/impersonate-user.ts --env staging --user viniciushack@layback.trade`).

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/auth/session   # 200 = já está no ar
# senão (em background, com run_in_background):
cd $FE && DISABLE_EVE=true DISABLE_WORKFLOW=true APP_ENV=staging bun scripts/with-env.ts bun node_modules/next/dist/bin/next dev --webpack -p 3000
```
Turbopack quebra no Windows — sempre `--webpack`. A primeira compilação de cada rota leva ~1 min; o
primeiro acesso pode dar `CONNECT_TIMEOUT` no pooler e passar no seguinte. O dev server reescreve
`next-env.d.ts`: `git checkout -- next-env.d.ts` antes de commitar.

## 3. Backoffice — porta 3006

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3006/login   # 200 = no ar
cd $BO && bun run dev:staging          # em background. NUNCA `bun dev` (aponta para outro banco)
# cookie de sessão sem Google (grava em arquivo, nunca imprime o token):
cd $BO && APP_ENV=staging bun scripts/with-env.ts bun .scratch/media-library/bo-magic-session.ts educacaoleg@gmail.com "$SCRATCH/verification/bo-session.token"
```

## 4. agent-browser (headless; o Browser pane escondido trava o Suspense)

```bash
agent-browser open about:blank
agent-browser cookies set backoffice_magic_session "$(cat "$SCRATCH/verification/bo-session.token")" --url http://localhost:3006 --httpOnly
agent-browser set viewport 1440 900          # celular: agent-browser set viewport 375 812
agent-browser open "http://localhost:3000/app/biblioteca-de-midias"
agent-browser wait 4000
agent-browser screenshot "$EVID_FE/<tarefa>-<estado>.png"
agent-browser snapshot                        # árvore com refs @eN para clicar
agent-browser upload 'input[type=file]' "$FIX/produto-roxo.png" "$FIX/video-curto.mp4"
agent-browser click '@e12'                    # ou seletor CSS
agent-browser eval "document.documentElement.scrollWidth <= window.innerWidth"   # sem scroll horizontal
```
`wait 'text=...'` não funciona na 0.38.1 — use `wait <ms>` ou seletor CSS. Para simular status
4xx/5xx sem `network route` (que só devolve 200), embrulhe `window.fetch` via `eval`.

Backoffice — cliente de teste no hub: `http://localhost:3006/users/384f3178-3946-4fe5-b686-7f30adf16999?tab=marketing`.
Fluxo de IA do backoffice: `http://localhost:3006/marketing/ai?userId=384f3178-3946-4fe5-b686-7f30adf16999&accountId=act_2102201707319672`.
O classificador do auto mode já negou avançar o fluxo de IA além do objetivo: abrir o seletor de
mídia é permitido; **publicar nunca**.

## 5. Estados da biblioteca (conta de teste na staging)

```bash
cd $BO
APP_ENV=staging bun scripts/with-env.ts bun .scratch/media-library/set-test-expiration.ts grace    # expirou há 10 dias
APP_ENV=staging bun scripts/with-env.ts bun .scratch/media-library/set-test-expiration.ts closed   # expirou há 40 dias
APP_ENV=staging bun scripts/with-env.ts bun .scratch/media-library/set-test-expiration.ts restore  # OBRIGATÓRIO no fim
```
O original (`2026-10-24T19:57:52.463Z`) fica em `.scratch/media-library/.original-expiration.json`.
O JWT do app guarda `expirationDate`; depois de mudar o estado, recarregue o app.

### ☠️ Cron de retenção contra a staging: só `?dryRun=1`

A staging tem `BYPASS_STRIPE=false` e o S3 local aceita apagar chave inexistente: uma chamada
real ao `/api/cron-job/media-library/retention` marcaria como excluídas linhas de OUTROS usuários
de staging. Sempre `...retention?dryRun=1`.

## 6. Suítes (portão de "nenhuma falha nova")

```bash
PG=postgres://postgres:referral@localhost:55452/referral_test
docker start automatize-referral-test-55452
cd $FE && POSTGRES_URL=$PG POSTGRES_URL_NON_POOLING=$PG BACKOFFICE_ROOT=$BO bun test --timeout 30000 --reporter=junit --reporter-outfile="$SCRATCH/fe-now.xml" ./agent ./app ./apps ./components ./lib ./tests ./proxy-signed-out.test.ts ./proxy.test.ts
python $FE/docs/superpowers/plans/2026-10-13-media-library/support/compare-junit.py $EVID_FE/baseline/fe.xml "$SCRATCH/fe-now.xml"
cd $BO && POSTGRES_URL=$PG POSTGRES_URL_NON_POOLING=$PG FRONTEND_ROOT=$FE bun test --timeout 30000 --reporter=junit --reporter-outfile="$SCRATCH/bo-now.xml"
python $FE/docs/superpowers/plans/2026-10-13-media-library/support/compare-junit.py $EVID_BO/baseline/bo.xml "$SCRATCH/bo-now.xml"
```
`tsc`: `bunx tsc --noEmit -p .` em cada repo, comparado com a base em `evidence/baseline/*-tsc.txt`;
depois `git checkout -- tsconfig.tsbuildinfo`.
