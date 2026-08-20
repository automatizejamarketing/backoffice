export function shortActId(accountId: string): string {
  const digits = accountId.replace(/^act_/i, "");
  if (digits.length <= 6) return accountId;
  return `act_…${digits.slice(-4)}`;
}

export function accountDigits(accountId: string): string {
  return accountId.replace(/^act_/i, "");
}

export function buildAccountLabels(
  accounts: Array<{ accountId: string; name: string | null }>,
): Record<string, string> {
  const names = accounts.map(
    (account) => account.name?.trim().toLowerCase() ?? "",
  );
  const namedCount = names.filter(Boolean).length;
  const uniqueNames = new Set(names.filter(Boolean));
  const collide = accounts.length > 1 && uniqueNames.size < namedCount;

  const labels: Record<string, string> = {};
  for (const account of accounts) {
    const name = account.name?.trim();
    if (collide) {
      labels[account.accountId] = name
        ? `${name} · ${shortActId(account.accountId)}`
        : account.accountId;
      continue;
    }
    labels[account.accountId] = name || account.accountId;
  }
  return labels;
}

export function campaignActionHint(campaign: {
  delivery: "active" | "pending" | "inactive" | "completed";
  tag: "ATIVA" | "PAUSADA" | "EM ANÁLISE";
  compras: number;
}): string {
  if (campaign.delivery === "completed") {
    return "Não reativar. Avalie duplicar/estender 30–45 dias se a amostra for suficiente.";
  }
  if (campaign.delivery === "inactive" || campaign.tag === "PAUSADA") {
    return "Pausada/inativa: investigue o motivo antes de retomar ou duplicar. Não diga reativar sem esse contexto.";
  }
  if (campaign.delivery === "active" && campaign.compras === 0) {
    return "Já está ATIVA. Não diga reativar. Monitore por gasto, compras e objetivo; não invente prazo de 2–3 dias.";
  }
  return "Manter, ajustar ou testar com justificativa nas métricas da tabela.";
}
