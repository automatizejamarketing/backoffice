const FINANCE_ACCESS_EMAILS = new Set([
  "joaopedro@layback.trade",
  "contato@infinitegrowth.com.br",
  "lucashaddadm@gmail.com",
  "rafael@layback.me",
  "gustavo@layback.trade",
  "educacaoleg@gmail.com",
]);

export function canAccessFinance(email: string | null | undefined): boolean {
  if (!email) return false;
  return FINANCE_ACCESS_EMAILS.has(email.trim().toLowerCase());
}
