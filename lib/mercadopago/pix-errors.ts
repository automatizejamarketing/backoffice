const PIX_ERROR_MESSAGES: Record<string, string> = {
  "Pix is not enabled for this Mercado Pago account. Register a Pix key or use credentials from an account with Pix enabled.":
    "Pix não está habilitado na conta do Mercado Pago configurada. Cadastre uma chave Pix ou use credenciais de uma conta com Pix ativo.",
  "MERCADOPAGO_ACCESS_TOKEN is not configured":
    "Token do Mercado Pago não está configurado no backoffice.",
  "Usuário tem assinatura Stripe ativa.":
    "Este usuário possui assinatura Stripe ativa.",
  "Unauthorized use of live credentials":
    "O token do Mercado Pago não tem permissão para criar pagamentos Pix via API. Habilite o escopo payment no app do Mercado Pago.",
  "Payment not found":
    "Pagamento Pix anterior expirou ou é inválido. Tente gerar novamente.",
};

function parseMercadoPagoErrorMessage(message: string): string {
  const trimmed = message.trim();
  if (!trimmed.startsWith("{")) return trimmed;

  try {
    const parsed = JSON.parse(trimmed) as {
      message?: string;
      cause?: Array<{ description?: string }>;
    };
    return parsed.cause?.[0]?.description ?? parsed.message ?? trimmed;
  } catch {
    return trimmed;
  }
}

export function formatMercadoPagoPixError(message: string): string {
  const parsedMessage = parseMercadoPagoErrorMessage(message);
  if (!parsedMessage) return "Não foi possível gerar o link Pix.";

  return PIX_ERROR_MESSAGES[parsedMessage] ?? parsedMessage;
}
