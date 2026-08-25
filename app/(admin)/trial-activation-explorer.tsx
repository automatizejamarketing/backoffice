"use client";

import { useState } from "react";
import { UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  TRIAL_DAILY_GOAL,
  formatActivationDelay,
  goalStatus,
  type DailyTrialActivation,
  type GoalStatus,
} from "@/lib/backoffice/trial-activation";
import {
  formatInSaoPaulo,
  parseCalendarDate,
} from "@/lib/backoffice/datetime-format";
import { cn } from "@/lib/utils";
import { TrialActivationChart } from "./trial-activation-chart";
import { TrialActivationUsersDialog } from "./trial-activation-users-dialog";

const numberFormatter = new Intl.NumberFormat("pt-BR");

function formatNumber(value: number) {
  return numberFormatter.format(value);
}

function formatTableDate(value: string) {
  return formatInSaoPaulo(parseCalendarDate(value), {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  });
}

const GOAL_LABEL = `${TRIAL_DAILY_GOAL.min}–${TRIAL_DAILY_GOAL.max}`;

const GOAL_STATUS_COPY: Record<GoalStatus, string> = {
  below: "abaixo da meta",
  on: "dentro da meta",
  above: "acima da meta",
};

function GoalDot({ status }: { status: GoalStatus }) {
  return (
    <span
      className={cn(
        "inline-block size-1.5 rounded-full",
        status === "on" && "bg-chart-3",
        status === "above" && "bg-chart-5",
        status === "below" && "bg-border",
      )}
    >
      <span className="sr-only">{GOAL_STATUS_COPY[status]}</span>
    </span>
  );
}

function DailyTrialTable({
  data,
  onSelect,
}: {
  data: DailyTrialActivation[];
  onSelect: (day: DailyTrialActivation) => void;
}) {
  return (
    <div className="max-h-[480px] overflow-auto rounded-lg border">
      <Table className="min-w-[560px]">
        <TableHeader className="sticky top-0 z-10 bg-background/95 backdrop-blur">
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-10 whitespace-nowrap">Dia</TableHead>
            <TableHead className="h-10 whitespace-nowrap text-right">
              Trials
            </TableHead>
            <TableHead className="h-10 whitespace-nowrap text-right">
              Cadastro do dia
            </TableHead>
            <TableHead className="h-10 whitespace-nowrap text-right">
              Conta antiga
            </TableHead>
            <TableHead className="h-10 whitespace-nowrap text-right">
              Tempo até ativar
            </TableHead>
            <TableHead className="h-10 w-10">
              <span className="sr-only">Ver usuários</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[...data].reverse().map((row) => {
            const hasUsers = row.activations > 0;
            return (
              <TableRow
                key={row.date}
                className={cn(hasUsers && "cursor-pointer")}
                onClick={hasUsers ? () => onSelect(row) : undefined}
              >
                <TableCell className="py-3 font-medium whitespace-nowrap capitalize">
                  {formatTableDate(row.date)}
                </TableCell>
                <TableCell className="py-3 text-right">
                  <span className="inline-flex items-center gap-2">
                    <GoalDot status={goalStatus(row.activations)} />
                    <span className="font-mono font-medium tabular-nums">
                      {formatNumber(row.activations)}
                    </span>
                  </span>
                </TableCell>
                <TableCell className="py-3 text-right font-mono tabular-nums">
                  {formatNumber(row.sameDay)}
                </TableCell>
                <TableCell className="py-3 text-right font-mono tabular-nums">
                  {formatNumber(row.existingAccount)}
                </TableCell>
                <TableCell className="py-3 text-right font-mono tabular-nums whitespace-nowrap">
                  {formatActivationDelay(row.avgDelaySeconds)}
                </TableCell>
                <TableCell className="py-2 pr-2 text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-muted-foreground"
                    disabled={!hasUsers}
                    aria-label={`Ver usuários de ${formatTableDate(row.date)}`}
                    title={hasUsers ? "Ver usuários" : "Nenhum trial neste dia"}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect(row);
                    }}
                  >
                    <UsersRound className="size-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export function TrialActivationExplorer({
  daily,
}: {
  daily: DailyTrialActivation[];
}) {
  const [selectedDay, setSelectedDay] = useState<DailyTrialActivation | null>(
    null,
  );

  return (
    <>
      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(600px,0.9fr)]">
        <div className="min-w-0 rounded-xl border bg-card p-4 shadow-xs sm:p-6">
          <div className="mb-5">
            <h3 className="text-sm font-semibold">Evolução diária</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              A faixa tracejada é a meta interna de {GOAL_LABEL} trials por
              dia. Cada barra separa quem criou a conta naquele dia de quem já
              tinha conta. Clique em um dia para ver quem ativou.
            </p>
          </div>
          <TrialActivationChart data={daily} onSelectDay={setSelectedDay} />
        </div>

        <div className="min-w-0 space-y-4">
          <div>
            <h3 className="text-sm font-semibold">Detalhe por dia</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Tempo médio do cadastro até o trial entre quem ativou naquele
              dia. Clique na linha para ver os usuários.
            </p>
          </div>
          <DailyTrialTable data={daily} onSelect={setSelectedDay} />
        </div>
      </section>

      <TrialActivationUsersDialog
        day={selectedDay}
        onOpenChange={(open) => {
          if (!open) setSelectedDay(null);
        }}
      />
    </>
  );
}
