// Renegociação de acordo — a escolha que o operador é obrigado a tomar
// (ticket 13).
//
// Trocar as regras de um afiliado é operação normal: ele passa a trazer volume,
// ou o acordo inicial se mostra caro demais. O que NÃO é normal é a troca
// decidir sozinha o que acontece com quem já foi indicado.
//
// Por isso o Indicado aponta para o acordo de forma explícita, em vez de
// derivá-lo por data (ADR 0026): derivar por data tomaria essa decisão sozinha,
// e sempre da mesma forma. Este módulo é o outro lado dessa escolha — ele
// recusa a renegociação que chega sem ela.
//
// Três coisas que ele NÃO faz, de propósito:
//
//   1. **Não tem default.** `undefined` não vira "manter"; vira recusa. Um
//      default silencioso aqui é exatamente o que o ticket existe para impedir.
//   2. **Não reprecifica nada.** Comissões já geradas carregam o snapshot da
//      regra que as produziu e não são tocadas — a escolha vale da próxima
//      fatura em diante, porque a fatura seguinte lê o acordo APONTADO pelo
//      Indicado.
//   3. **Não apaga o acordo antigo.** Ele é marcado como superado e permanece:
//      é o que explica as comissões passadas.
//
// Função pura — sem rede, sem banco. O que grava vive em `queries.ts`.

/**
 * O que acontece com os indicados que já existem.
 *
 * `migrate` — passam a apontar para o acordo novo, e a próxima fatura de cada
 * um já usa a regra nova.
 * `keep` — continuam apontando para o acordo antigo, que segue vivo (superado,
 * mas nunca apagado) justamente para continuar regendo-os.
 */
export const REFERRAL_MIGRATION_CHOICE_VALUES = ["migrate", "keep"] as const;
export type ReferralMigrationChoice =
  (typeof REFERRAL_MIGRATION_CHOICE_VALUES)[number];

export type ParsedReferralMigrationChoice =
  | { ok: true; choice: ReferralMigrationChoice }
  | { ok: false; error: string };

/**
 * Lê a escolha vinda da interface. Só `"migrate"` e `"keep"` passam; a ausência
 * é recusada com a mesma mensagem de um valor inválido, porque para quem opera
 * as duas situações são a mesma: a decisão não foi tomada.
 */
export function parseReferralMigrationChoice(
  input: unknown,
): ParsedReferralMigrationChoice {
  if (
    typeof input === "string" &&
    REFERRAL_MIGRATION_CHOICE_VALUES.includes(
      input as ReferralMigrationChoice,
    )
  ) {
    return { ok: true, choice: input as ReferralMigrationChoice };
  }

  return {
    ok: false,
    error:
      "Escolha o que acontece com os indicados existentes: migrar para o acordo novo ou mantê-los na regra antiga.",
  };
}

/** `true` quando os indicados existentes devem passar a apontar para o acordo novo. */
export function migratesExistingCustomers(
  choice: ReferralMigrationChoice,
): boolean {
  return choice === "migrate";
}

/**
 * A frase que descreve a escolha para o operador e para o log administrativo.
 * O número entra na frase porque "migrar" sem saber quantos é uma decisão
 * tomada no escuro.
 */
export function describeMigrationChoice(
  choice: ReferralMigrationChoice,
  customerCount: number,
): string {
  if (customerCount === 0) {
    return choice === "migrate"
      ? "Nenhum indicado existente para migrar — a escolha só vale para o que já existisse."
      : "Nenhum indicado existente — todos os futuros já nascem no acordo novo.";
  }

  const singular = customerCount === 1;
  const indicados = singular ? "1 indicado" : `${customerCount} indicados`;

  return choice === "migrate"
    ? `${indicados} ${singular ? "passa" : "passam"} a ser ${singular ? "regido" : "regidos"} pelo acordo novo a partir da próxima fatura.`
    : `${indicados} ${singular ? "continua" : "continuam"} no acordo antigo; só os novos nascem no acordo novo.`;
}
