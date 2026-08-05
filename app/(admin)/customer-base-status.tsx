import type { CustomerBaseStatus } from "@/lib/backoffice/customer-base-status";
import { formatFinanceNumber } from "@/lib/backoffice/finance-format";
import { CustomerBaseStatusUsersDialog } from "./customer-base-status-users-dialog";

type CustomerBaseStatusPanelProps = {
  status: CustomerBaseStatus;
};

function ChurnProviderBreakdown({
  card,
  pix,
  total,
}: CustomerBaseStatus["churn"]) {
  if (total === 0) {
    return null;
  }

  const other = Math.max(total - card - pix, 0);
  const cardShare = Math.round((card / total) * 1000) / 10;
  const pixShare = Math.round((pix / total) * 1000) / 10;
  const otherShare = Math.round((other / total) * 1000) / 10;

  return (
    <div className="mt-3 space-y-2">
      <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">
        {card > 0 ? (
          <div
            className="h-full bg-chart-1"
            style={{ width: `${cardShare}%` }}
            title={`Cartão: ${cardShare}%`}
          />
        ) : null}
        {pix > 0 ? (
          <div
            className="h-full bg-emerald-500/80"
            style={{ width: `${pixShare}%` }}
            title={`PIX: ${pixShare}%`}
          />
        ) : null}
        {other > 0 ? (
          <div
            className="h-full bg-muted-foreground/30"
            style={{ width: `${otherShare}%` }}
            title={`Outros: ${otherShare}%`}
          />
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-3 text-[11px] tabular-nums text-muted-foreground">
        <span>
          Cartão{" "}
          <span className="font-medium text-foreground">
            {formatFinanceNumber(card)}
          </span>
        </span>
        <span>
          PIX{" "}
          <span className="font-medium text-foreground">
            {formatFinanceNumber(pix)}
          </span>
        </span>
      </div>
    </div>
  );
}

export function CustomerBaseStatusPanel({ status }: CustomerBaseStatusPanelProps) {
  return (
    <section aria-labelledby="customer-status-title" className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="customer-status-title" className="text-sm font-semibold">
          Situação atual da base
        </h2>
        <p className="text-[11px] text-muted-foreground">
          Estes números não mudam com o período selecionado.
        </p>
      </div>

      <dl className="grid overflow-hidden rounded-xl border bg-card shadow-xs divide-y md:grid-cols-4 md:items-stretch md:divide-x md:divide-y-0">
        <div className="flex h-full flex-col p-5 md:px-4 xl:p-5">
          <dt className="text-xs font-medium text-muted-foreground">
            Clientes pagantes
          </dt>
          <dd className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
            {formatFinanceNumber(status.activePaying)}
          </dd>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            Pagamento aprovado e acesso vigente.
          </p>
          <div className="mt-auto pt-3">
            <CustomerBaseStatusUsersDialog
              category="activePaying"
              title="Clientes pagantes"
              count={status.activePaying}
            />
          </div>
        </div>
        <div className="flex h-full flex-col p-5 md:px-4 xl:p-5">
          <dt className="text-xs font-medium text-muted-foreground">Em trial</dt>
          <dd className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
            {formatFinanceNumber(status.trial)}
          </dd>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            Acesso vigente sem pagamento aprovado.
          </p>
          <div className="mt-auto pt-3">
            <CustomerBaseStatusUsersDialog
              category="trial"
              title="Em trial"
              count={status.trial}
            />
          </div>
        </div>
        <div className="flex h-full flex-col p-5 md:px-4 xl:p-5">
          <dt className="text-xs font-medium text-muted-foreground">Churn</dt>
          <dd className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
            {formatFinanceNumber(status.churn.total)}
          </dd>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            Clientes que expiraram após pagar.
          </p>
          <ChurnProviderBreakdown {...status.churn} />
          <div className="mt-auto pt-3">
            <CustomerBaseStatusUsersDialog
              category="churn"
              title="Churn"
              count={status.churn.total}
            />
          </div>
        </div>
        <div className="flex h-full flex-col p-5 md:px-4 xl:p-5">
          <dt className="text-xs font-medium text-muted-foreground">
            Pra cancelar
          </dt>
          <dd className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
            {formatFinanceNumber(status.scheduledCancel)}
          </dd>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            Pagamento aprovado, acesso vigente e cancelamento agendado.
          </p>
          <div className="mt-auto pt-3">
            <CustomerBaseStatusUsersDialog
              category="scheduledCancel"
              title="Pra cancelar"
              count={status.scheduledCancel}
            />
          </div>
        </div>
      </dl>
    </section>
  );
}
