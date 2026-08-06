import { AlertCircle, CheckCheck, Mail, MousePointerClick } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requirePagePermission } from "@/lib/auth/rbac";
import { getEmailHistory } from "@/lib/backoffice/email-history";
import {
  isEmailDeliveryStatus,
  summarizeEmailHistory,
  type EmailDeliveryStatus,
} from "@/lib/backoffice/email-history-model";
import { formatShortDateTimeInSaoPaulo } from "@/lib/backoffice/datetime-format";

export const dynamic = "force-dynamic";

type EmailSearchParams = {
  q?: string;
  status?: string;
};

const STATUS_LABELS: Record<EmailDeliveryStatus, string> = {
  bounced: "Rejeitado",
  canceled: "Cancelado",
  clicked: "Clicado",
  complained: "Spam",
  delivered: "Entregue",
  delivery_delayed: "Atrasado",
  failed: "Falhou",
  opened: "Aberto",
  queued: "Na fila",
  scheduled: "Agendado",
  sent: "Enviado",
  suppressed: "Suprimido",
};

function statusVariant(
  status: EmailDeliveryStatus,
): "default" | "destructive" | "secondary" {
  if (["delivered", "opened", "clicked"].includes(status)) return "default";
  if (["failed", "bounced", "complained", "suppressed"].includes(status)) {
    return "destructive";
  }
  return "secondary";
}

function formatSentAt(value: string) {
  return formatShortDateTimeInSaoPaulo(value);
}

function Metric({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: typeof Mail;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card p-4 shadow-xs">
      <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xl font-semibold tabular-nums">{value}</p>
      </div>
    </div>
  );
}

export default async function EmailsPage({
  searchParams,
}: {
  searchParams: Promise<EmailSearchParams>;
}) {
  const [, params] = await Promise.all([
    requirePagePermission("emails:view"),
    searchParams,
  ]);
  const history = await getEmailHistory();
  const query = params.q?.trim().toLowerCase() ?? "";
  const selectedStatus = isEmailDeliveryStatus(params.status)
    ? params.status
    : undefined;
  const filteredEmails = history.emails.filter((email) => {
    const matchesQuery =
      !query ||
      email.subject.toLowerCase().includes(query) ||
      email.to.some((recipient) => recipient.toLowerCase().includes(query));
    return matchesQuery && (!selectedStatus || email.status === selectedStatus);
  });
  const summary = summarizeEmailHistory(history.emails);

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-6">
      <header>
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <span className="size-1.5 rounded-full bg-chart-3" />
          Histórico transacional
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
          Emails
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Acompanhe os emails enviados pela AutomatizeJá e identifique falhas de
          entrega sem sair do Backoffice.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Últimos envios" value={summary.total} icon={Mail} />
        <Metric label="Entregues" value={summary.delivered} icon={CheckCheck} />
        <Metric
          label="Abertos ou clicados"
          value={summary.engaged}
          icon={MousePointerClick}
        />
        <Metric label="Problemas" value={summary.problems} icon={AlertCircle} />
      </section>

      <section className="overflow-hidden rounded-xl border bg-card shadow-xs">
        <div className="border-b p-4 sm:p-5">
          <form className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Input
              name="q"
              defaultValue={params.q ?? ""}
              placeholder="Buscar destinatário ou assunto"
              className="sm:max-w-sm"
            />
            <select
              name="status"
              defaultValue={selectedStatus ?? ""}
              aria-label="Filtrar por status"
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <option value="">Todos os status</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <Button type="submit" variant="secondary">
              Filtrar
            </Button>
          </form>
        </div>

        {!history.ok ? (
          <div className="flex min-h-56 flex-col items-center justify-center gap-2 px-6 text-center">
            <AlertCircle className="size-5 text-muted-foreground" />
            <p className="text-sm font-medium">Histórico indisponível</p>
            <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
              {history.error === "not_configured"
                ? "A integração com o provedor de email ainda não está configurada neste ambiente."
                : "Não foi possível consultar o provedor de email agora. Tente novamente em instantes."}
            </p>
          </div>
        ) : filteredEmails.length === 0 ? (
          <div className="flex min-h-56 flex-col items-center justify-center gap-2 px-6 text-center">
            <Mail className="size-5 text-muted-foreground" />
            <p className="text-sm font-medium">Nenhum email encontrado</p>
            <p className="text-xs text-muted-foreground">
              Ajuste os filtros ou aguarde os próximos envios.
            </p>
          </div>
        ) : (
          <div className="overflow-auto">
            <Table className="min-w-[860px]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Destinatário</TableHead>
                  <TableHead>Assunto</TableHead>
                  <TableHead>Remetente</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Enviado em</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEmails.map((email) => (
                  <TableRow key={email.id}>
                    <TableCell className="max-w-60 truncate font-medium">
                      {email.to.join(", ")}
                    </TableCell>
                    <TableCell className="max-w-80 truncate">
                      {email.subject}
                    </TableCell>
                    <TableCell className="max-w-60 truncate text-muted-foreground">
                      {email.from}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(email.status)}>
                        {STATUS_LABELS[email.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right text-muted-foreground">
                      {formatSentAt(email.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
