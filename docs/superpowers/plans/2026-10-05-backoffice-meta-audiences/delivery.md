# Entrega — públicos Meta no Backoffice

PR: https://github.com/automatizejamarketing/backoffice/pull/61. Branch `feat/backoffice-audiences`, base `main`. Código revisado/corrigido em `e75828ea34579d64c5dc9a0d2877d7ff4fc80ca7`; o Frontend permanece na referência `5942cc2e`, sem mudança de produto. Worktrees preservadas em `D:/automatize-marketing/.worktrees/backoffice-audiences/`.

**Veredito independente: APROVADO.** Matriz R1–R10 PASS, sem defeitos Critical/Important restantes. O mesmo avaliador revisou a branch inteira, repetiu a suíte completa afetada após a correção e executou pessoalmente os fluxos de UI em uma sessão nova de agent-browser. A aprovação aplica o critério de comparação com a baseline aprovado no spec; as suítes completas e o TypeScript ainda retornam falhas descritas abaixo.

## Construído, mapeado ao spec

- **R1–R3:** gerenciador compartilhado na página Públicos e na campanha com IA, lista/histórico/paginação e criação com quatro origens: contatos, Instagram, site e semelhante. Apenas o formulário escolhido aparece, com voltar/cancelar e atualização após operações.
- **R4–R5:** links preservam cliente/conta e prefixo embed; normalização `act_`; conta solicitada indisponível exige escolha explícita. Loading, erro/retry, cliente ausente e ausência de contas são distintos; trocas de contexto descartam dados antigos.
- **R6–R7:** edição direcionada pela regra e capacidade, fallback de metadados para regras externas/compostas e membros desconhecidos, preservação da formação de semelhantes, revisão/confirmação/reconciliação e exclusão existentes.
- **R8–R9:** biblioteca incorporada sem aplicar segmentação automaticamente; painel, seletores e duas camadas de exclusão utilizáveis em telas estreitas; foco/teclado e ausência de overflow verificados.
- **R10:** branch commitada e enviada, PR contra main; merge reservado ao solicitante.

## Como validar

PowerShell, nas worktrees preparadas, Bun 1.3.4:

```powershell
$env:POSTGRES_URL = 'postgres://postgres:referral@127.0.0.1:55452/referral_test'
$env:FRONTEND_ROOT = 'D:/automatize-marketing/.worktrees/backoffice-audiences/automatize-frontend'
$env:BACKOFFICE_ROOT = 'D:/automatize-marketing/.worktrees/backoffice-audiences/backoffice'
Set-Location $env:BACKOFFICE_ROOT
bun test --timeout 30000
bunx tsc --noEmit -p .
bun docs/superpowers/plans/2026-10-05-backoffice-meta-audiences/evidence/browser-support/verify-fixtures.mjs
Set-Location $env:FRONTEND_ROOT
bun test --timeout 30000
bunx tsc --noEmit -p .
```

O endereço PostgreSQL local indisponível evita escrita no banco compartilhado. A reprodução de UI usa agent-browser 0.38.1, Chromium 149, app local e fixtures determinísticos; setup, entradas e limites em [evidence/README.md](evidence/README.md). Logs completos locais permanecem em `.superpowers/sdd/2026-10-05-backoffice-meta-audiences/`.

## Testes e evidências

- Backoffice, execução completa independente após correção: **1671 pass / 8 fail**, 1679 testes/225 arquivos, exit 1. Os mesmos oito nomes de falha da baseline; as duas falhas novas de contrato foram corrigidas. [Saída](evidence/logs/final-backoffice-fixed-tests.txt).
- Frontend, execução completa independente: **4194 pass / 10 skip / 12 fail / 3 errors**, exit 1. Baseline 4196/10skip/10fail/3errors; os dois adicionais foram timeouts de subprocessos de 15/20 segundos no código inalterado. Reexecução diagnóstica dos dois arquivos: **5 pass / 0 fail**, exit 0. [Completa](evidence/logs/final-frontend-tests.txt), [diagnóstico](evidence/logs/final-frontend-timeout-diagnosis.log).
- TypeScript: **42/194 linhas de diagnóstico**, idênticas às respectivas baselines; a execução final retornou exit 1, a baseline registrou exit 2. Nenhuma execução completa de tipos é declarada verde. [Backoffice](evidence/logs/final-backoffice-tsc.log), [Frontend](evidence/logs/final-frontend-tsc.log).
- Fixtures: **13 checks / 0 native fetch**, exit 0. [Saída](evidence/logs/final-fixtures.log).
- Correção residual: **20/0**, sem alterar testes; [saída](evidence/logs/final-fix-green.log), [relatório](evidence/reports/final-fix-report.md).
- Matriz e screenshots independentes: [avaliação final](final-evaluation.md). Capturas dos implementadores permanecem como evidência adicional, identificadas por `task1-`/`task2-`.

## Limites conhecidos

As falhas herdadas de banco/journals/contratos e TypeScript permanecem. O Frontend completo teve os dois timeouts ambientais descritos acima. Capacidade real de gestão de membros continua desconhecida/bloqueada; sucesso dos fixtures não prova permissões Meta, parsing/hashing de CSV/XLSX, persistência de imports/commands, geração IA ou publicação real. A exclusão incerta conserva erro genérico sem ação de reconciliação; o Close em inglês é herdado.

A entrada embed e a campanha IA são exercitadas, mas o clique exato no hub de cliente exige perfil UUID no servidor, indisponível no fixture. A autenticação local utiliza o fallback administrativo existente com banco local indisponível; lookup administrativo em banco e compatibilidade Chrome 153 permanecem sem prova. O run do navegador usa Chromium 149.

**Minor herdado:** fechar o painel avançado de IA com Escape retorna foco ao BODY, como na base. Os controles continuam utilizáveis por teclado/mouse; a nova janela de públicos restaura foco ao botão invocador. O ajuste do foco do painel de IA fica registrado para uma melhoria de acessibilidade. Os testes de reconciliação também conservam logs estruturados de erro simulado esperados.

## Rulings I made

- Ruling: Use explicitly pinned automatize-sonnet-high agent role for every subagent, including evaluator — harness workspace instruction overrides requested GPT-6 Luna/current-session model; Fast mode has no exposed parameter — cost if wrong: user's intended model comparison is unavailable, and an additional evaluation on their preferred model may be needed.
- Ruling: Use CLI worktrees for both sibling repositories — native create_worktree failed "Not a git repository" in multi-repo parent and has no repository-path argument — cost if wrong: worktrees lack native app attachment/cleanup and need manual Git management.
- Ruling: Treat self-reviewed plan as approved and do not ask a second approval — user explicitly authorized this handoff and zero questions after design — cost if wrong: plan adjustments are visible in git and may require rework.
- Ruling: Preserve existing backend/RBAC/member-capability policy, including unknown capability blockers — approved spec requests frontend experience parity and identifies this inherited limitation; granting inferred Meta permissions would change scope — cost if wrong: customer-list membership operations remain unavailable against real Meta until separately corrected.
- Ruling: Use deterministic browser fixtures and hermetic backend tests for mutations, retain artifacts — approved spec forbids mutating real Meta/shared DB for evidence and requests screenshots/ledger at delivery — cost if wrong: browser tests do not demonstrate live Meta integration and production permission issues remain possible.
- Ruling: Create draft PR after task reviews before final evaluation, mark ready only after APROVADO — R10 needs evidence of an actual PR and user authorized push/PR — cost if wrong: reviewers may see the draft while final validation is still underway.
- Ruling: Invoke Next by its installed module path through bun under with-env — direct `next` is not resolved by this Windows shell; amended the exact plan command — cost if wrong: local verification startup needs another command adjustment, with no production behavior affected.
- Ruling: After staging RSC auth began failing with shared pool CONNECT_TIMEOUT and Fast Refresh full reloads, run the local verification server with staging configuration but override POSTGRES_URL to the disconnected local test endpoint, exercising the existing allowlisted-admin recovery path — browser transport provides all synthetic data and no product auth code is changed — cost if wrong: UI evidence covers bootstrap admin fallback, not database-backed admin lookup; staging connectivity remains unverified.
- Ruling: Use a local native select for customer-list column mapping only in plain workspace presentation — the existing Radix select inside the workspace Dialog repeatedly froze the browser renderer (daemon error10060); retain disclosure presentation and operation/permission logic — cost if wrong: slight dropdown presentation divergence and later revisiting Radix compatibility.
- Ruling: Verify the actual normal Marketing→Públicos click, embedded navigation helper/component contracts, and the actual approved /embed/marketing/audiences route separately — existing embedded client hub requires a server DB UUID profile, unavailable to browser transport fixtures; no DB writes/auth bypass or product test entry are authorized for evidence — cost if wrong: the exact embedded client-hub click lacks end-to-end proof until an existing authorized profile is available. Report this limit explicitly; do not describe direct embed navigation as a hub click.
- Ruling: Use installed Chrome136 through agent-browser --executable-path for a controlled comparison — Chrome153 task-owned renderer stopped responding to Runtime/Page/Debugger with flat CPU after upload, while browser-domain requests still answered; no install or product/browser-user changes — cost if wrong: browser evidence targets an older installed Chrome and current Chrome153 compatibility remains uncertain. Revert the provisional native-select adaptation if the intended source controls work under136.
- Ruling: Standardize verification on installed Chromium149 with agent-browser native executable and identical startup options on every command — controlled149 replay succeeds with intended original Radix controls;136 comparison was invalidated by changed flags, and npm PowerShell wrapper loses stdin — cost if wrong: current Chrome153 compatibility is not proven and local command paths are machine-specific.
- Ruling: Preserve existing deletion protocol and report its generic uncertainty/error presentation — R7 asks to preserve administrative review/typed confirmation and existing recovery behavior; the existing deletion control has no reconciliation action contract, while rule/metadata operations do — cost if wrong: operators receive less guidance after uncertain deletion and a separate deletion-recovery improvement may be needed. Reviewer still evaluates this inherited concern on its merits.
- Ruling: Restore focus locally when the controlled audience workspace closes — actual keyboard verification returned focus to BODY because no DialogTrigger exists; R9 requires accessible close/navigation — cost if wrong: callback timing may need adjustment when the invoking row disappears after save; task review and final browser replay cover it.
- Ruling: Run the owned verification Next process with Bun --smol after restart — installed CLI documents lower-memory/more-GC mode; measured9GB privateallocation/381MBfree caused recurrent paging/timeouts despite sequential checks — cost if wrong: compilation may be slower and this runtime mode differs from default local startup. No production/Next config change, cache deletion, auth or DB policy change.
- Ruling: Sequence memory-heavy TypeScript/fullsuite runs and browser compilation, and close finished task-owned UI sessions — actual local memory pressure interrupted verification; independent checks cannot safely overlap here — cost if wrong: longer verification time and cold UI startup after a server restart if one becomes necessary.
- Ruling: Apply the approved spec baseline-comparison gate to inherited full-suite/TypeScript failures rather than finishing-skill stop-on-any-failure — user approved this scoped port with recorded base failures and independent no-regression verification, plus preselected push/PR and no questions — cost if wrong: existing repository failures remain unresolved and CI may still be red; delivery must report exact failures and never claim a green full suite.
- Ruling: Treat the two extra unchanged-Frontend subprocess failures as environmental startup timeouts after exact pinned-source verification and personal focused rerun5/0, preserving full4194/12/3 totals — no Frontend code fix is justified by this port — cost if wrong: the full suite may still time out under load and stable green completion of those cases is not demonstrated by the failed full run.
- Ruling: Preserve the source refresh-after-save/delete behavior without adding manual refresh/search/bulk controls — final reviewer source check and approved experience-parity scope do not request those extra controls — cost if wrong: manual refresh/discovery features need a separate change; evaluator must still prove existing post-operation refresh.
- Ruling: Leave inherited AI advanced Sheet close-to-BODY focus behavior as an explicit nonblocking Minor — sole evaluator verified same base contract and required control usability; this port restores focus for its new standalone workspace and introduces no sheet focus regression — cost if wrong: keyboard operators may need to tab back to the review control after closing advanced settings; a focused accessibility follow-up is needed.

A adaptação provisória de select nativo foi integralmente revertida após replay dos Radix originais. O ensaio Chrome 136 foi invalidado por opções diferentes entre chamadas; não é evidência de compatibilidade. As decisões históricas continuam listadas para rastreabilidade.
