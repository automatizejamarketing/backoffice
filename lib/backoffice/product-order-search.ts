export function orderMatchesBuyerSearch(
  order: { buyerName: string; buyerEmail: string },
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;

  return (
    order.buyerName.toLowerCase().includes(needle) ||
    order.buyerEmail.toLowerCase().includes(needle)
  );
}
