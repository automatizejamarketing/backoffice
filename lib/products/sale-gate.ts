export type ProductOfferingInput = {
  status: "draft" | "published" | "archived";
  salesEnabled: boolean;
};

/** Gate de venda: o produto está **à venda** só quando está publicado e
 * com vendas habilitadas. Não depende de dono (Expert ou Automatize) nem
 * de gateway. O cartão na **Conta Stripe do Expert** é um requisito extra
 * do checkout (ticket 17), não deste gate. */
export function isProductOfferedForSale(input: ProductOfferingInput): boolean {
  return input.status === "published" && input.salesEnabled;
}
