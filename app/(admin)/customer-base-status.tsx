import type { CustomerBaseStatus } from "@/lib/backoffice/customer-base-status";
import { formatFinanceNumber } from "@/lib/backoffice/finance-format";
import { CustomerBaseStatusUsersDialog } from "./customer-base-status-users-dialog";

type CustomerBaseStatusPanelProps = {
  status: CustomerBaseStatus;
};

type ProviderSegment = {
  label: string;
  count: number;
  barClass: string;
};

function ProviderBreakdown({
  total,
  segments,
}: {
  total: number;
  segments: ProviderSegment[];
}) {
  if (total === 0) {
    return null;
  }

  const other = Math.max(
    total - segments.reduce((sum, segment) => sum + segment.count, 0),
    0,
  );
  const bars = [
    ...segments,
    { label: "Outros", count: other, barClass: "bg-muted-foreground/30" },
  ];
  const share = (count: number) => Math.round((count / total) * 1000) / 10;

  return (
    <div className="mt-3 space-y-2">
      <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">
        {bars.map((bar) =>
          bar.count > 0 ? (
            <div
              key={bar.label}
              className={`h-full ${bar.barClass}`}
              style={{ width: `${share(bar.count)}%` }}
              title={`${bar.label}: ${share(bar.count)}%`}
            />
          ) : null,
        )}
      </div>
      <div className="flex items-center justify-between gap-3 text-[11px] tabular-nums text-muted-foreground">
        {segments.map((segment) => (
          <span key={segment.label}>
            {segment.label}{" "}
            <span className="font-medium text-foreground">
              {formatFinanceNumber(segment.count)}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

const CARD_BAR = "bg-chart-1";
const PIX_BAR = "bg-emerald-500/80";
const PIX_AUTOMATIC_BAR = "bg-violet-500/80";

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
          <ProviderBreakdown
            total={status.churn.total}
            segments={[
              { label: "Cartão", count: status.churn.card, barClass: CARD_BAR },
              { label: "PIX", count: status.churn.pix, barClass: PIX_BAR },
              ...(status.churn.pixAutomatic > 0
                ? [
                    {
                      label: "Pix Automático",
                      count: status.churn.pixAutomatic,
                      barClass: PIX_AUTOMATIC_BAR,
                    },
                  ]
                : []),
            ]}
          />
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
            {formatFinanceNumber(status.scheduledCancel.total)}
          </dd>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            Pagamento aprovado, acesso vigente e renovação cancelada no cartão
            ou no Pix Automático. Pix avulso não renova sozinho e não entra
            aqui.
          </p>
          <ProviderBreakdown
            total={status.scheduledCancel.total}
            segments={[
              {
                label: "Cartão",
                count: status.scheduledCancel.card,
                barClass: CARD_BAR,
              },
              {
                label: "Pix Automático",
                count: status.scheduledCancel.pixAutomatic,
                barClass: PIX_AUTOMATIC_BAR,
              },
            ]}
          />
          <div className="mt-auto pt-3">
            <CustomerBaseStatusUsersDialog
              category="scheduledCancel"
              title="Pra cancelar"
              count={status.scheduledCancel.total}
            />
          </div>
        </div>
      </dl>
    </section>
  );
}
