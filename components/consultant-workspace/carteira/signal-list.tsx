"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { SeverityDot } from "@/components/consultant-workspace/shared/primitives";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/consultant-workspace/metrics";
import { entityLabel } from "@/components/consultant-workspace/common/signal-helpers";
import {
  SEVERITY_WEIGHT,
  groupSignals,
  type Signal,
  type SignalGroup as Group,
} from "@/components/consultant-workspace/common/model";

/* Sinais da mesma regra viram uma linha "× N". */

export function SignalList({
  signals,
  dashed,
  now,
  onFix,
}: {
  signals: Signal[];
  dashed?: boolean;
  now: number;
  onFix?: (fix: "nota" | "meta") => void;
}) {
  const groups = groupSignals(signals);
  return (
    <ol className={cn("divide-y rounded-lg border", dashed && "border-dashed")}>
      {groups.map((group) => (
        <SignalGroupRow key={group.id} group={group} now={now} onFix={onFix} />
      ))}
    </ol>
  );
}

function SignalGroupRow({ group, now, onFix }: { group: Group; now: number; onFix?: (fix: "nota" | "meta") => void }) {
  const [open, setOpen] = useState(false);
  const [first, ...rest] = group.signals;
  const worst = group.signals.reduce(
    (acc, s) => (SEVERITY_WEIGHT[s.severity] > SEVERITY_WEIGHT[acc.severity] ? s : acc),
    first,
  );
  const entity = entityLabel(first);
  return (
    <li className="flex gap-3 px-3 py-2.5">
      <span className="pt-1.5">
        <SeverityDot severity={worst.severity} />
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <p className="text-sm font-medium">
            {first.title}
            {rest.length > 0 ? <span className="ml-1.5 text-muted-foreground">× {group.signals.length}</span> : null}
          </p>
          {entity && rest.length === 0 ? <span className="truncate text-xs text-muted-foreground">{entity}</span> : null}
          {first.since ? (
            <span className="ml-auto text-[11px] text-muted-foreground">{formatRelative(first.since, now)}</span>
          ) : null}
        </div>
        <p className="line-clamp-3 text-[13px] text-muted-foreground">{first.evidence}</p>
        {first.recommendation ? (
          <p className="text-xs">
            <span className="font-medium">O que fazer: </span>
            <span className="text-muted-foreground">{first.recommendation}</span>
            {first.fix && onFix ? (
              <button
                type="button"
                onClick={() => onFix(first.fix!)}
                className="ml-1.5 text-primary hover:underline"
              >
                {first.fix === "meta" ? "Definir meta (m)" : "Registrar contato (n)"}
              </button>
            ) : null}
          </p>
        ) : null}
        {rest.length > 0 ? (
          <div>
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              {open ? "Esconder" : `Ver os outros ${rest.length}`}
              <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
            </button>
            {open ? (
              <ul className="mt-1.5 space-y-1.5 border-l pl-3">
                {rest.map((signal) => (
                  <li key={signal.key} className="text-xs">
                    <span className="font-medium">{entityLabel(signal) ?? signal.title}</span>
                    <span className="text-muted-foreground"> — {signal.evidence}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}
