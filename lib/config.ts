// Admin email allowlist - only these emails can access the backoffice
export const ADMIN_EMAILS = [
  "joaopedrocorrea14@gmail.com",
  "joaopedro@layback.trade",
  "educacaoleg@gmail.com",
  "gustavoomarcelinoo@gmail.com",
  "gustavo@layback.trade"
  // Add more admin emails here
] as const;

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email as (typeof ADMIN_EMAILS)[number]);
}

