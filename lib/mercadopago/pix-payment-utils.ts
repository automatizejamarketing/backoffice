type MercadoPagoPixPaymentLike = {
  point_of_interaction?: {
    transaction_data?: {
      qr_code?: string;
    };
  };
};

export function extractPixCopyPasteCode(
  payment: MercadoPagoPixPaymentLike,
): string | null {
  const qrCode = payment.point_of_interaction?.transaction_data?.qr_code?.trim();
  return qrCode || null;
}
