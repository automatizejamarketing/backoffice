// Task 6 (referral-manual-customer-link): verificação ponta a ponta do motor de
// comissão sobre Indicados vinculados manualmente pelo backoffice. STAGING ONLY.
// Só chama processReferralCommissionForPayment para os pagamentos elegíveis dos
// userIds passados — nunca runReferralCommissionEngine nem o cron.
//
// Uso:
//   APP_ENV=staging bun scripts/with-env.ts bun --conditions=react-server \
//     scripts/_rml-verify-commissions.ts <saida.json> <userId...>

// (cabeçalho copiado de scripts/verify-commission-engine-staging.ts: loadAppEnv + asserts de staging)
import { loadAppEnv } from "../lib/env/load-env";

loadAppEnv();

const STAGING_PROJECT_REF = "wsbsnzgzqiehqnklzchm";

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

import { writeFileSync } from "node:fs";

const [outputPath, ...userIds] = process.argv.slice(2);
if (!outputPath || userIds.length === 0) {
  console.error("uso: _rml-verify-commissions.ts <saida.json> <userId...>");
  process.exit(1);
}

const { sql } = await import("drizzle-orm");
const { db } = await import("@/lib/db/executor");
const { findPaymentsPendingCommission } = await import("@/lib/referral/queries");
const { processReferralCommissionForPayment } = await import("@/lib/referral/commission-service");

type Row = Record<string, unknown>;
const rows = async (query: ReturnType<typeof sql>) => [...(await db.execute(query))] as Row[];

const report: Row[] = [];
let failures = 0;

const pending = new Set(await findPaymentsPendingCommission(1000));

for (const userId of userIds) {
  const [customer] = await rows(sql`
    select c.id, c.affiliate_id, a.percentage_bps, a.fixed_amount_centavos, a.format
    from referral_customers c join referral_agreements a on a.id = c.agreement_id
    where c.user_id = ${userId}`);
  if (!customer) {
    failures += 1;
    report.push({ userId, error: "não é indicado" });
    continue;
  }
  const eligible = await rows(sql`
    select id, net_amount from payments
    where user_id = ${userId} and status = 'succeeded'
      and (purpose is null or purpose = 'subscription')
      and external_id is not null and coalesce(gross_amount, amount) > 0
    order by created_at asc`);

  for (const paymentRow of eligible) {
    const paymentId = String(paymentRow.id);
    const pickedBySweep = pending.has(paymentId);
    // Numa nova tentativa desta tarefa a comissão já existe e o pagamento saiu
    // da fila da varredura — isso também é sucesso, não falha.
    const [before] = await rows(sql`
      select rc.id from referral_commissionable_events e
      join referral_commissions rc on rc.event_id = e.id
      where e.payment_id = ${paymentId}`);
    const existedBefore = Boolean(before);
    const first = await processReferralCommissionForPayment(paymentId);
    const second = await processReferralCommissionForPayment(paymentId);
    const [commission] = await rows(sql`
      select rc.id, rc.amount_centavos, rc.status, rc.releases_at, rc.agreement_snapshot,
             e.status as event_status, e.net_centavos, e.kind,
             (select count(*)::int from referral_ledger_entries l where l.commission_id = rc.id) as ledger_entries
      from referral_commissionable_events e
      left join referral_commissions rc on rc.event_id = e.id
      where e.payment_id = ${paymentId}`);
    const net = paymentRow.net_amount === null ? null : Number(paymentRow.net_amount);
    const expected =
      net === null
        ? null
        : customer.format === "fixed"
          ? Number(customer.fixed_amount_centavos)
          : Math.round((net * Number(customer.percentage_bps)) / 10_000);
    const actual = commission?.amount_centavos == null ? null : Number(commission.amount_centavos);
    const pass =
      (pickedBySweep || existedBefore) &&
      second.created === false &&
      (expected === null
        ? commission?.event_status === "awaiting_settlement"
        : actual === expected && Number(commission?.ledger_entries) === 1);
    if (!pass) failures += 1;
    report.push({ userId, paymentId, pickedBySweep, existedBefore, net, expected, actual, first, secondCreated: second.created, commission, pass });
  }
}

writeFileSync(outputPath, JSON.stringify({ ranAt: new Date().toISOString(), failures, report }, null, 2));
console.log(JSON.stringify({ failures, checked: report.length }));
process.exit(failures === 0 ? 0 : 1);
