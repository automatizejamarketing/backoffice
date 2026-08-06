// Verificação ao vivo, em STAGING, das decisões administrativas do programa de
// afiliados v2: aprovar criando o acordo na mesma transação, recusar, bloquear,
// reativar e recrutar quem não pediu.
//
// As funções chamadas aqui são as MESMAS que as rotas `/api/referrals/*`
// chamam — o script é a rota sem o HTTP, não uma segunda implementação. O lado
// do afiliado (pedir e ver o link) vive no `automatize-frontend`:
// `bun run referral:verify-staging`.
//
// Uso:
//   bun run referral:verify-staging list
//   bun run referral:verify-staging approve <affiliateId> [percentual]
//   bun run referral:verify-staging reject <affiliateId>
//   bun run referral:verify-staging block <affiliateId>
//   bun run referral:verify-staging reactivate <affiliateId>
//   bun run referral:verify-staging recruit <userId>
//   bun run referral:verify-staging renegotiate <affiliateId> <migrate|keep> [percentual]
//
// E a fila de saques (ticket 11), que é a outra metade da operação:
//   bun run referral:verify-staging payouts
//   bun run referral:verify-staging payout-approve <payoutId>
//   bun run referral:verify-staging payout-pay <payoutId> [urlDoComprovante]
//   bun run referral:verify-staging payout-deny <payoutId> [motivo]
//
// E a baixa de saldo negativo (ticket 12), a válvula do estorno que chega
// depois do repasse:
//   bun run referral:verify-staging negatives
//   bun run referral:verify-staging write-off <affiliateId> [motivo] [valorEmCentavos]
//
// E as métricas e alertas (ticket 14). `audit` existe para a CONFERÊNCIA
// MANUAL que o ticket pede: ele imprime as linhas cruas de um afiliado —
// cliques, indicados, eventos, comissões e lançamentos — junto da linha que a
// tela mostra, de modo que "os números batem" possa ser verificado em vez de
// afirmado:
//   bun run referral:verify-staging metrics [sort]
//   bun run referral:verify-staging alerts
//   bun run referral:verify-staging audit <affiliateId>
//
// Nenhum comando aqui apaga nada. A limpeza é feita pelo script do frontend,
// por id exato.

import { loadAppEnv } from "../lib/env/load-env";

loadAppEnv();

const STAGING_PROJECT_REF = "wsbsnzgzqiehqnklzchm";
const SCRIPT_ADMIN_EMAIL = "verify-script@staging.local";

if (process.env.APP_ENV !== "staging") {
  throw new Error("This command is restricted to APP_ENV=staging");
}

const postgresUrl = process.env.POSTGRES_URL;
if (!postgresUrl) throw new Error("POSTGRES_URL is not configured");
// Staging e produção compartilham o host do pooler; o project ref só aparece no
// usuário, então é ele que identifica o ambiente.
const databaseUrl = new URL(postgresUrl);
if (
  !`${databaseUrl.hostname}:${databaseUrl.username}`.includes(
    STAGING_PROJECT_REF,
  )
) {
  throw new Error("POSTGRES_URL does not match the Automatize staging project");
}

const {
  approveReferralAffiliate,
  blockReferralAffiliate,
  listReferralAffiliates,
  reactivateReferralAffiliate,
  rejectReferralAffiliate,
  renegotiateReferralAgreement,
} = await import("@/lib/referral/queries");
const { describeMigrationChoice, parseReferralMigrationChoice } = await import(
  "@/lib/referral/renegotiation"
);
const { describeAgreementDuration, describeAgreementValue } = await import(
  "@/lib/referral/agreement"
);
const { decideReferralPayout, listReferralPayoutRequests } = await import(
  "@/lib/referral/payout-queries"
);
const { formatTaxDocument, REFERRAL_PAYOUT_STATUS_LABELS } = await import(
  "@/lib/referral/payout"
);
const {
  describeWriteOff,
  listNegativeReferralBalances,
  writeOffReferralNegativeBalance,
} = await import("@/lib/referral/write-off-queries");
const { formatCentavos } = await import("@/lib/referral/write-off");
const { ReferralOperationError } = await import("@/lib/referral/queries");
const { auditReferralAffiliate, getReferralProgramMetrics } = await import(
  "@/lib/referral/metrics-queries"
);
const {
  describeReferralPartialReversal,
  formatEpc,
  formatShare,
  parseReferralMetricSort,
  REFERRAL_COMMISSION_STATUS_LABELS,
  REFERRAL_METRIC_SORT_LABELS,
} = await import("@/lib/referral/metrics");

/** O comprovante padrão do roteiro — HTTPS, como a regra exige. */
const SCRIPT_PROOF_URL = "https://staging.invalid/comprovantes/verificacao.pdf";

const [command, argument, extra] = process.argv.slice(2);

if (command === "list") {
  const rows = await listReferralAffiliates({});
  if (rows.length === 0) {
    console.log("Nenhum afiliado v2 em staging.");
  }
  for (const row of rows) {
    console.log(
      [
        row.id,
        row.status.padEnd(9),
        row.code,
        row.user.email,
        row.agreement
          ? `${describeAgreementValue(row.agreement)} / ${describeAgreementDuration(row.agreement)}`
          : "sem acordo",
        `${row.customerCount} indicados`,
      ].join("  "),
    );
  }
} else if (command === "renegotiate") {
  if (!argument) throw new Error("Informe o affiliateId");
  // A escolha vem da linha de comando pelo MESMO parser que a rota usa: rodar
  // `renegotiate <id>` sem escolha tem de falhar aqui também, senão o roteiro
  // provaria menos do que a interface.
  const choice = parseReferralMigrationChoice(extra);
  if (!choice.ok) {
    console.log(`Recusado: ${choice.error}`);
    console.log("  uso: renegotiate <affiliateId> <migrate|keep> [percentual]");
    process.exit(1);
  }

  const [, , , rawPercentage] = process.argv.slice(2);
  const percentage = Number(rawPercentage ?? "20");

  try {
    const result = await renegotiateReferralAgreement({
      affiliateId: argument,
      terms: {
        format: "percentage",
        percentageBps: Math.round(percentage * 100),
        fixedAmountCentavos: null,
        duration: "lifetime",
        durationCycles: null,
      },
      choice: choice.choice,
      adminEmail: SCRIPT_ADMIN_EMAIL,
    });
    console.log("Acordo renegociado:");
    console.log(`  acordo anterior : ${result.previousAgreement.id}`);
    console.log(
      `  superado em     : ${result.previousAgreement.supersededAt?.toISOString()} (permanece no banco)`,
    );
    console.log(`  acordo vigente  : ${result.agreement.id}`);
    console.log(
      `  regra nova      : ${describeAgreementValue(result.agreement)} / ${describeAgreementDuration(result.agreement)}`,
    );
    console.log(`  autor           : ${result.agreement.createdBy}`);
    console.log(
      `  escolha         : ${result.choice} — ${result.migratedCustomerCount}/${result.totalCustomerCount} indicados migrados`,
    );
    console.log(
      `  ${describeMigrationChoice(result.choice, result.totalCustomerCount)}`,
    );
  } catch (error) {
    if (error instanceof ReferralOperationError) {
      console.log(`Recusado (${error.status}): ${error.message}`);
    } else {
      throw error;
    }
  }
} else if (command === "approve") {
  if (!argument) throw new Error("Informe o affiliateId");
  const percentage = Number(extra ?? "10");
  const result = await approveReferralAffiliate({
    affiliateId: argument,
    terms: {
      format: "percentage",
      percentageBps: Math.round(percentage * 100),
      fixedAmountCentavos: null,
      duration: "lifetime",
      durationCycles: null,
    },
    adminEmail: SCRIPT_ADMIN_EMAIL,
  });
  console.log("Aprovado na mesma transação do acordo:");
  console.log(`  affiliateId : ${result.affiliate.id}`);
  console.log(`  status      : ${result.affiliate.status}`);
  console.log(`  code        : ${result.affiliate.code}`);
  console.log(`  agreementId : ${result.agreement.id}`);
  console.log(
    `  acordo      : ${describeAgreementValue(result.agreement)} / ${describeAgreementDuration(result.agreement)}`,
  );
  console.log(`  recrutado   : ${result.recruited}`);
} else if (command === "recruit") {
  if (!argument) throw new Error("Informe o userId");
  const result = await approveReferralAffiliate({
    userId: argument,
    terms: {
      format: "fixed",
      percentageBps: null,
      fixedAmountCentavos: 5000,
      duration: "n_cycles",
      durationCycles: 3,
    },
    adminEmail: SCRIPT_ADMIN_EMAIL,
  });
  console.log("Afiliação criada sem pedido (recrutamento):");
  console.log(`  affiliateId : ${result.affiliate.id}`);
  console.log(`  code        : ${result.affiliate.code}`);
  console.log(`  agreementId : ${result.agreement.id}`);
  console.log(
    `  acordo      : ${describeAgreementValue(result.agreement)} / ${describeAgreementDuration(result.agreement)}`,
  );
  console.log(`  recrutado   : ${result.recruited}`);
} else if (command === "reject") {
  if (!argument) throw new Error("Informe o affiliateId");
  const updated = await rejectReferralAffiliate({
    affiliateId: argument,
    reason: extra ?? "Verificação em staging",
    adminEmail: SCRIPT_ADMIN_EMAIL,
  });
  console.log(`Recusado: ${updated.id} (${updated.rejectedBy})`);
} else if (command === "block") {
  if (!argument) throw new Error("Informe o affiliateId");
  const updated = await blockReferralAffiliate({
    affiliateId: argument,
    reason: extra ?? "Verificação em staging",
    adminEmail: SCRIPT_ADMIN_EMAIL,
  });
  console.log(`Bloqueado: ${updated.id} (${updated.blockedBy})`);
} else if (command === "reactivate") {
  if (!argument) throw new Error("Informe o affiliateId");
  const updated = await reactivateReferralAffiliate({
    affiliateId: argument,
    adminEmail: SCRIPT_ADMIN_EMAIL,
  });
  console.log(`Reativado: ${updated.id} (${updated.status})`);
} else if (command === "payouts") {
  const rows = await listReferralPayoutRequests({});
  if (rows.length === 0) console.log("Nenhum pedido de saque em staging.");
  for (const row of rows) {
    console.log(
      [
        row.id,
        REFERRAL_PAYOUT_STATUS_LABELS[row.status].padEnd(10),
        (row.amountCentavos / 100)
          .toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
          .padStart(12),
        // O documento do SNAPSHOT — é ele que precisa bater com o titular da
        // chave Pix, e não o cadastro de agora.
        formatTaxDocument(row.taxDocument.document, row.taxDocument.type),
        row.user.email,
        row.proofUrl ?? "sem comprovante",
      ].join("  "),
    );
  }
} else if (command === "payout-approve") {
  if (!argument) throw new Error("Informe o payoutId");
  const updated = await decideReferralPayout({
    payoutId: argument,
    status: "approved",
    adminEmail: SCRIPT_ADMIN_EMAIL,
  });
  console.log(
    `Aprovado: ${updated.id} → ${updated.status} por ${updated.adminEmail} em ${updated.reviewedAt?.toISOString()}`,
  );
  console.log("  (aprovar NÃO cria lançamento — o dinheiro ainda não saiu)");
} else if (command === "payout-pay") {
  if (!argument) throw new Error("Informe o payoutId");
  const updated = await decideReferralPayout({
    payoutId: argument,
    status: "paid",
    proofUrl: extra ?? SCRIPT_PROOF_URL,
    adminEmail: SCRIPT_ADMIN_EMAIL,
  });
  console.log(
    `Pago: ${updated.id} → ${updated.status} por ${updated.adminEmail} em ${updated.paidAt?.toISOString()}`,
  );
  console.log(`  comprovante: ${updated.proofUrl}`);
  console.log("  (é AQUI que o lançamento negativo entra no extrato)");
} else if (command === "payout-deny") {
  if (!argument) throw new Error("Informe o payoutId");
  const updated = await decideReferralPayout({
    payoutId: argument,
    status: "denied",
    reason: extra ?? "Verificação em staging",
    adminEmail: SCRIPT_ADMIN_EMAIL,
  });
  console.log(
    `Negado: ${updated.id} → ${updated.status} por ${updated.adminEmail} (${updated.denialReason})`,
  );
  console.log("  (negar não deixa lançamento nenhum)");
} else if (command === "negatives") {
  const rows = await listNegativeReferralBalances();
  if (rows.length === 0) console.log("Nenhum saldo negativo em staging.");
  for (const row of rows) {
    console.log(
      [
        row.affiliateId,
        row.affiliateCode.padEnd(10),
        formatCentavos(row.availableCentavos).padStart(14),
        `dívida ${formatCentavos(row.debtCentavos)}`,
        row.user.email,
      ].join("  "),
    );
  }
} else if (command === "write-off") {
  if (!argument) throw new Error("Informe o affiliateId");
  // O terceiro argumento, quando existe, é o valor em CENTAVOS — uma baixa
  // parcial. Sem ele, a baixa é a dívida inteira.
  const [, , , rawAmount] = process.argv.slice(2);
  const amountCentavos = rawAmount ? Number(rawAmount) : null;

  try {
    const result = await writeOffReferralNegativeBalance({
      affiliateId: argument,
      amountCentavos,
      reason: extra ?? "Chargeback recebido depois do repasse (verificação)",
      adminEmail: SCRIPT_ADMIN_EMAIL,
    });
    console.log(`Baixa lançada: ${describeWriteOff(result)}`);
    console.log(`  lançamento : ${result.entry.id} (${result.entry.type})`);
    console.log(`  autor      : ${result.entry.createdBy}`);
    console.log(`  motivo     : ${result.entry.description}`);
    console.log(
      "  (é um lançamento NOVO — nenhuma linha anterior do ledger foi tocada)",
    );
  } catch (error) {
    // A recusa também é resultado: dar baixa num saldo que não está negativo
    // precisa falhar, e é isto que o roteiro checa ao rodar o comando duas
    // vezes seguidas.
    if (error instanceof ReferralOperationError) {
      console.log(`Recusado (${error.status}): ${error.message}`);
    } else {
      throw error;
    }
  }
} else if (command === "metrics") {
  const sort = parseReferralMetricSort(argument ?? null);
  const metrics = await getReferralProgramMetrics({ sort });

  console.log(`Métricas do programa (${metrics.generatedAt})`);
  console.log("");
  console.log(
    `  receita líquida gerada : ${formatCentavos(metrics.totals.netRevenueCentavos)} (bruto ${formatCentavos(metrics.totals.grossRevenueCentavos)})`,
  );
  console.log(
    `  comissão gerada        : ${formatCentavos(metrics.totals.commissionGeneratedCentavos)}`,
  );
  console.log(
    `  comissão paga          : ${formatCentavos(metrics.totals.commissionPaidCentavos)}`,
  );
  console.log(
    `  margem líquida         : ${formatCentavos(metrics.totals.marginCentavos)}`,
  );
  console.log(
    `  passivo de comissão    : ${formatCentavos(metrics.liability.totalCentavos)} em ${metrics.liability.affiliatesOwedCount} afiliados`,
  );
  console.log(
    `    em carência          : ${formatCentavos(metrics.liability.inGraceCentavos)}`,
  );
  console.log(
    `    retido em saque      : ${formatCentavos(metrics.liability.heldInOpenPayoutsCentavos)}`,
  );
  console.log(
    `    pronto para pedir    : ${formatCentavos(metrics.liability.readyToRequestCentavos)}`,
  );
  console.log(
    `  EPC                    : ${formatEpc(metrics.totals.epcCentavos)} (${metrics.totals.clicks} cliques)`,
  );
  console.log(
    `  concentração top 10%   : ${formatShare(metrics.concentration.share)} (${metrics.concentration.topCount}/${metrics.concentration.affiliateCount} afiliados)`,
  );

  console.log("");
  console.log("  comissões pelos cinco estados:");
  for (const [status, total] of Object.entries(metrics.commissionsByStatus)) {
    console.log(
      `    ${REFERRAL_COMMISSION_STATUS_LABELS[status as keyof typeof REFERRAL_COMMISSION_STATUS_LABELS].padEnd(10)} ${String(total.count).padStart(4)}  ${formatCentavos(total.amountCentavos).padStart(14)}`,
    );
  }

  console.log("");
  console.log(`  ranking por ${REFERRAL_METRIC_SORT_LABELS[sort]}:`);
  if (metrics.affiliates.length === 0) {
    console.log("    (nenhum afiliado aprovado)");
  }
  for (const row of metrics.affiliates) {
    console.log(
      [
        `    ${row.affiliateId}`,
        row.affiliateCode.padEnd(10),
        `cliques ${String(row.clicks).padStart(5)}`,
        `líquida ${formatCentavos(row.netRevenueCentavos).padStart(14)}`,
        `comissão ${formatCentavos(row.commissionGeneratedCentavos).padStart(14)}`,
        `paga ${formatCentavos(row.commissionPaidCentavos).padStart(14)}`,
        `margem ${formatCentavos(row.marginCentavos).padStart(14)}`,
        `EPC ${formatEpc(row.epcCentavos).padStart(10)}`,
        row.user.email,
      ].join("  "),
    );
  }

  console.log("");
  console.log(
    `  alertas: ${metrics.alerts.stuckSettlements.length} liquidação presa (>${metrics.alerts.stuckSettlementDays}d) · ${metrics.alerts.partialReversals.length} estorno parcial`,
  );
} else if (command === "alerts") {
  const metrics = await getReferralProgramMetrics();

  console.log(
    `Eventos presos em aguardando liquidação há mais de ${metrics.alerts.stuckSettlementDays} dias:`,
  );
  if (metrics.alerts.stuckSettlements.length === 0) {
    console.log("  (nenhum — o reconciliador está dando conta)");
  }
  for (const row of metrics.alerts.stuckSettlements) {
    console.log(
      [
        `  ${row.eventId}`,
        row.affiliateCode.padEnd(10),
        row.provider.padEnd(12),
        formatCentavos(row.grossCentavos).padStart(14),
        `${row.daysStuck} dias`,
        row.eventKey,
      ].join("  "),
    );
  }

  console.log("");
  console.log("Estornos parciais (a política é de estorno sempre total):");
  if (metrics.alerts.partialReversals.length === 0) {
    console.log("  (nenhum)");
  }
  for (const row of metrics.alerts.partialReversals) {
    console.log(
      [
        `  ${row.paymentId}`,
        (row.affiliateCode ?? "não é indicado").padEnd(14),
        row.reversalKind.padEnd(10),
        describeReferralPartialReversal(row),
        row.userEmail,
      ].join("  "),
    );
  }
} else if (command === "audit") {
  if (!argument) throw new Error("Informe o affiliateId");
  const audit = await auditReferralAffiliate(argument);
  if (!audit) {
    console.log("Afiliado não encontrado.");
    process.exit(1);
  }

  // A conferência manual do ticket: as linhas cruas de um lado, a linha do
  // ranking do outro. Se os dois não baterem, o erro está numa das duas
  // consultas — e não em qual delas o operador resolveu acreditar.
  console.log(`Conferência manual — ${audit.affiliateCode} (${audit.affiliateId})`);
  console.log(`  cliques   : ${audit.clicks}`);
  console.log(`  indicados : ${audit.customers}`);

  console.log("");
  console.log("  eventos comissionáveis:");
  for (const row of audit.events) {
    console.log(
      [
        `    ${row.id}`,
        row.kind.padEnd(8),
        row.status.padEnd(20),
        `pagamento ${row.paymentStatus.padEnd(10)}`,
        `bruto ${formatCentavos(row.grossCentavos).padStart(14)}`,
        `líquido ${(row.netCentavos === null ? "—" : formatCentavos(row.netCentavos)).padStart(14)}`,
      ].join("  "),
    );
  }

  console.log("");
  console.log("  comissões:");
  for (const row of audit.commissions) {
    console.log(
      [
        `    ${row.id}`,
        REFERRAL_COMMISSION_STATUS_LABELS[row.status].padEnd(10),
        formatCentavos(row.amountCentavos).padStart(14),
        `libera em ${row.releasesAt}`,
      ].join("  "),
    );
  }

  console.log("");
  console.log("  lançamentos:");
  let ledgerTotal = 0;
  for (const row of audit.ledger) {
    ledgerTotal += row.amountCentavos;
    console.log(
      [
        `    ${row.id}`,
        row.type.padEnd(10),
        formatCentavos(row.amountCentavos).padStart(14),
        `disponível ${row.availableAt ?? "imediatamente"}`,
        row.description ?? "",
      ].join("  "),
    );
  }
  console.log(`    soma do ledger        : ${formatCentavos(ledgerTotal)}`);
  console.log(
    `    saques abertos        : ${formatCentavos(audit.openPayoutCentavos)}`,
  );

  const metrics = await getReferralProgramMetrics();
  const row = metrics.affiliates.find((item) => item.affiliateId === argument);
  console.log("");
  console.log("  o que a tela mostra para este afiliado:");
  if (!row) {
    console.log(
      "    (fora do ranking — só afiliados aprovados ou bloqueados entram)",
    );
  } else {
    console.log(`    cliques               : ${row.clicks}`);
    console.log(`    indicados             : ${row.customers}`);
    console.log(`    faturas comissionadas : ${row.commissionedInvoices}`);
    console.log(
      `    receita líquida       : ${formatCentavos(row.netRevenueCentavos)}`,
    );
    console.log(
      `    comissão gerada       : ${formatCentavos(row.commissionGeneratedCentavos)}`,
    );
    console.log(
      `    comissão revertida    : ${formatCentavos(row.commissionReversedCentavos)}`,
    );
    console.log(
      `    comissão paga         : ${formatCentavos(row.commissionPaidCentavos)}`,
    );
    console.log(
      `    passivo               : ${formatCentavos(row.liabilityCentavos)}`,
    );
    console.log(`    margem                : ${formatCentavos(row.marginCentavos)}`);
    console.log(`    EPC                   : ${formatEpc(row.epcCentavos)}`);
  }
} else {
  throw new Error(
    "Comandos: list | approve <id> [%] | recruit <userId> | reject <id> | block <id> | reactivate <id> | " +
      "renegotiate <id> <migrate|keep> [%] | " +
      "payouts | payout-approve <payoutId> | payout-pay <payoutId> [url] | payout-deny <payoutId> [motivo] | " +
      "negatives | write-off <affiliateId> [motivo] [valorEmCentavos] | " +
      "metrics [net_revenue|commission_paid|margin] | alerts | audit <affiliateId>",
  );
}

process.exit(0);
