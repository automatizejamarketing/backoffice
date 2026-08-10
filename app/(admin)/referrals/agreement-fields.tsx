"use client";

// Os campos do Acordo de Comissão.
//
// Um único componente porque um único formulário: aprovar um pedido da fila e
// recrutar alguém que não pediu passam pelas MESMAS regras e pela mesma rota.
// Carência e base de cálculo não aparecem aqui de propósito — são globais ao
// programa, não termos negociáveis com um afiliado (ADR 0026).

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type AgreementFormState = {
  format: "percentage" | "fixed";
  /** Percentual como digitado, em % (aceita vírgula). */
  percentage: string;
  /** Valor fixo como digitado, em reais (aceita vírgula). */
  fixedAmount: string;
  duration: "lifetime" | "n_cycles" | "first_sale";
  durationCycles: string;
};

export const EMPTY_AGREEMENT_FORM: AgreementFormState = {
  format: "percentage",
  percentage: "",
  fixedAmount: "",
  duration: "lifetime",
  durationCycles: "",
};

/**
 * O formulário já preenchido com um acordo que existe — o ponto de partida de
 * uma renegociação. Renegociar quase nunca é reescrever tudo: é mexer num
 * número. Começar do formulário vazio faria o operador redigitar a duração e o
 * formato que ele não quis mudar, e é assim que uma vitalícia vira 3 ciclos por
 * distração.
 */
export function agreementFormFromAgreement(agreement: {
  format: "percentage" | "fixed";
  percentageBps: number | null;
  fixedAmountCentavos: number | null;
  duration: "lifetime" | "n_cycles" | "first_sale";
  durationCycles: number | null;
}): AgreementFormState {
  return {
    format: agreement.format,
    percentage:
      agreement.percentageBps === null
        ? ""
        : formatDecimal(agreement.percentageBps / 100),
    fixedAmount:
      agreement.fixedAmountCentavos === null
        ? ""
        : formatDecimal(agreement.fixedAmountCentavos / 100),
    duration: agreement.duration,
    durationCycles:
      agreement.durationCycles === null ? "" : String(agreement.durationCycles),
  };
}

/** Ponto vira vírgula, e o inteiro perde o ",00" que ninguém digita. */
function formatDecimal(value: number): string {
  return (Number.isInteger(value) ? String(value) : value.toFixed(2)).replace(
    ".",
    ",",
  );
}

export type AgreementPayload = {
  format: "percentage" | "fixed";
  percentageBps?: number;
  fixedAmountCentavos?: number;
  duration: "lifetime" | "n_cycles" | "first_sale";
  durationCycles?: number;
};

function parseDecimal(raw: string): number | null {
  const normalized = raw.trim().replace(/\./g, "").replace(",", ".");
  if (!normalized) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/**
 * Traduz o que foi digitado para o corpo da requisição. Dinheiro e percentual
 * viram inteiros aqui — centavos e basis points — porque é assim que o banco
 * os guarda, e arredondar uma vez só é o que impede um acordo de 12,5% virar
 * 12,499%.
 */
export function agreementFormToPayload(
  state: AgreementFormState,
): { ok: true; payload: AgreementPayload } | { ok: false; error: string } {
  const payload: AgreementPayload = {
    format: state.format,
    duration: state.duration,
  };

  if (state.format === "percentage") {
    const percentage = parseDecimal(state.percentage);
    if (percentage === null) {
      return { ok: false, error: "Informe o percentual da comissão" };
    }
    payload.percentageBps = Math.round(percentage * 100);
  } else {
    const amount = parseDecimal(state.fixedAmount);
    if (amount === null) {
      return { ok: false, error: "Informe o valor fixo da comissão" };
    }
    payload.fixedAmountCentavos = Math.round(amount * 100);
  }

  if (state.duration === "n_cycles") {
    const cycles = parseDecimal(state.durationCycles);
    if (cycles === null || !Number.isInteger(cycles)) {
      return { ok: false, error: "Informe a quantidade de ciclos" };
    }
    payload.durationCycles = cycles;
  }

  return { ok: true, payload };
}

export function AgreementFields({
  value,
  onChange,
}: {
  value: AgreementFormState;
  onChange: (next: AgreementFormState) => void;
}) {
  const update = (patch: Partial<AgreementFormState>) =>
    onChange({ ...value, ...patch });

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="agreement-format">Formato</Label>
          <Select
            value={value.format}
            onValueChange={(format) =>
              update({ format: format as AgreementFormState["format"] })
            }
          >
            <SelectTrigger id="agreement-format">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="percentage">
                Percentual sobre o líquido
              </SelectItem>
              <SelectItem value="fixed">Valor fixo por fatura</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {value.format === "percentage" ? (
          <div className="space-y-2">
            <Label htmlFor="agreement-percentage">Percentual (%)</Label>
            <Input
              id="agreement-percentage"
              inputMode="decimal"
              placeholder="10"
              value={value.percentage}
              onChange={(event) =>
                update({ percentage: event.target.value })
              }
            />
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="agreement-fixed">Valor por fatura (R$)</Label>
            <Input
              id="agreement-fixed"
              inputMode="decimal"
              placeholder="50,00"
              value={value.fixedAmount}
              onChange={(event) =>
                update({ fixedAmount: event.target.value })
              }
            />
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="agreement-duration">Duração</Label>
          <Select
            value={value.duration}
            onValueChange={(duration) =>
              update({
                duration: duration as AgreementFormState["duration"],
                durationCycles:
                  duration === "n_cycles" ? value.durationCycles : "",
              })
            }
          >
            <SelectTrigger id="agreement-duration">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="lifetime">Vitalícia</SelectItem>
              <SelectItem value="n_cycles">Por N ciclos</SelectItem>
              <SelectItem value="first_sale">Somente a primeira venda</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {value.duration === "n_cycles" && (
          <div className="space-y-2">
            <Label htmlFor="agreement-cycles">Ciclos</Label>
            <Input
              id="agreement-cycles"
              inputMode="numeric"
              placeholder="3"
              value={value.durationCycles}
              onChange={(event) =>
                update({ durationCycles: event.target.value })
              }
            />
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        A comissão percentual incide sempre sobre o valor líquido — a carência de
        30 dias e a base de cálculo são regras globais do programa, não deste
        acordo.
      </p>
    </div>
  );
}
