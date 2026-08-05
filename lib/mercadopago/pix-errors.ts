const PIX_ERROR_MESSAGES: Record<string, string> = {
  "Pix is not enabled for this Mercado Pago account. Register a Pix key or use credentials from an account with Pix enabled.":
    "Pix não está habilitado na conta do Mercado Pago configurada. Cadastre uma chave Pix ou use credenciais de uma conta com Pix ativo.",
  "MERCADOPAGO_ACCESS_TOKEN is not configured":
    "Token do Mercado Pago não está configurado no backoffice.",
  "Usuário tem assinatura Stripe ativa.":
    "Este usuário possui assinatura Stripe ativa.",
};

export function formatMercadoPagoPixError(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) return "Não foi possível gerar o link Pix.";

  return PIX_ERROR_MESSAGES[trimmed] ?? trimmed;
}
