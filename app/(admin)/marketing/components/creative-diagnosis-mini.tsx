"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  creativeConfidenceLabel,
  creativeDimensionLabel,
} from "@/lib/creative-analysis/labels";
import type { AdCreativeDiagnosisMini } from "@/lib/creative-analysis/playground";

type CreativeDiagnosisMiniChipProps = {
  diagnosis: AdCreativeDiagnosisMini | undefined;
};

function DiagnosisBody({ diagnosis }: { diagnosis: AdCreativeDiagnosisMini }) {
  return (
    <div className="space-y-3 text-sm">
      <p className="leading-relaxed text-foreground">{diagnosis.summary}</p>
      {diagnosis.craftGaps.length > 0 ? (
        <ul className="space-y-2">
          {diagnosis.craftGaps.map((gap, index) => (
            <li
              key={`${gap.dimension}-${index}`}
              className="rounded-md border border-orange-500/20 bg-orange-500/5 p-2"
            >
              <Badge variant="secondary">
                {creativeDimensionLabel(gap.dimension)}
              </Badge>
              <p className="mt-1.5 text-xs text-foreground">{gap.finding}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {gap.suggestion}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-[11px] text-muted-foreground">
        Hipótese da análise (confiança {creativeConfidenceLabel(diagnosis.confidence)}
        ). Conferir a peça antes de pausar.
      </p>
    </div>
  );
}

export function CreativeDiagnosisMiniChip({
  diagnosis,
}: CreativeDiagnosisMiniChipProps) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  if (!diagnosis) return null;

  const trigger = (
    <button
      type="button"
      aria-label="Criativo pode estar pesando no resultado"
      onClick={(event) => {
        event.stopPropagation();
        if (isMobile) setOpen(true);
      }}
      onPointerDown={(event) => event.stopPropagation()}
      className="inline-flex items-center gap-1 rounded-full border border-orange-500/30 bg-orange-500/10 px-2 py-0.5 text-[10px] font-medium text-orange-800 transition-colors hover:bg-orange-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-orange-200"
    >
      <AlertTriangle className="size-3" aria-hidden="true" />
      Peça
    </button>
  );

  if (isMobile) {
    return (
      <>
        {trigger}
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent
            className="max-h-[90vh] overflow-y-auto sm:max-w-[480px]"
            onClick={(event) => event.stopPropagation()}
          >
            <DialogHeader>
              <DialogTitle>Criativo pode estar pesando no resultado</DialogTitle>
            </DialogHeader>
            <DiagnosisBody diagnosis={diagnosis} />
            <div className="flex justify-end pt-2">
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
                Fechar
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        side="left"
        align="center"
        className="w-80 p-3"
        onClick={(event) => event.stopPropagation()}
      >
        <PopoverHeader>
          <PopoverTitle>Criativo pode estar pesando no resultado</PopoverTitle>
        </PopoverHeader>
        <DiagnosisBody diagnosis={diagnosis} />
      </PopoverContent>
    </Popover>
  );
}
