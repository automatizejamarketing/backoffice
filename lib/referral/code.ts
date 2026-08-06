// Código do afiliado do programa v2.
//
// Os códigos são GERADOS aqui e nenhuma string do v1 é portada (ADR 0024): um
// link já divulgado com um código antigo deixa de atribuir, e essa é a
// consequência escolhida. Nada neste arquivo lê a tabela `affiliates` do v1.
//
// Módulo espelhado byte a byte em `automatize-frontend/lib/referral/code.ts` e
// `backoffice/lib/referral/code.ts`: os dois projetos criam afiliados — o
// usuário pedindo, o administrador recrutando — e o código precisa ter a mesma
// forma nos dois.

// Alfabeto sem os pares ambíguos (0/O, 1/I/L): o código é lido em voz alta,
// ditado por telefone e digitado à mão.
export const REFERRAL_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const REFERRAL_CODE_LENGTH = 8;

// 31^8 ≈ 8.5e11 combinações. A unicidade real é garantida pelo índice único de
// `referral_affiliates.code`; o tamanho existe para que a colisão seja rara o
// bastante para que o retry quase nunca aconteça.
const REFERRAL_CODE_PATTERN = new RegExp(
  `^[${REFERRAL_CODE_ALPHABET}]{${REFERRAL_CODE_LENGTH}}$`,
);

export function isReferralCode(value: string | null | undefined): boolean {
  if (!value) return false;
  return REFERRAL_CODE_PATTERN.test(value);
}

/**
 * Sorteia um índice em [0, max) sem viés de módulo, usando a fonte
 * criptográfica da plataforma (disponível em Node e no edge runtime).
 */
function secureRandomIndex(max: number): number {
  const limit = Math.floor(0xff_ff_ff_ff / max) * max;
  const buffer = new Uint32Array(1);
  let value = 0;
  do {
    globalThis.crypto.getRandomValues(buffer);
    value = buffer[0];
  } while (value >= limit);
  return value % max;
}

/**
 * Gera um código candidato. A fonte de aleatoriedade é injetável para que o
 * teste possa provar a forma do código sem depender de sorte.
 */
export function generateReferralCode(
  randomIndex: (max: number) => number = secureRandomIndex,
): string {
  let code = "";
  for (let position = 0; position < REFERRAL_CODE_LENGTH; position += 1) {
    code += REFERRAL_CODE_ALPHABET.charAt(
      randomIndex(REFERRAL_CODE_ALPHABET.length),
    );
  }
  return code;
}
