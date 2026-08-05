export type ProductOwnerSelection = {
  ownerType: "automatize" | "expert";
  expertId: string;
};

export function getProductOwnerSelectionValue(
  ownerType: ProductOwnerSelection["ownerType"],
  expertId: string,
): string {
  return ownerType === "expert" && expertId
    ? `expert:${expertId}`
    : "automatize";
}

export function parseProductOwnerSelection(
  value: string,
): ProductOwnerSelection {
  if (value === "automatize") {
    return { ownerType: "automatize", expertId: "" };
  }

  const expertId = value.startsWith("expert:") ? value.slice(7) : "";
  if (!expertId) throw new Error("Expert inválido");

  return { ownerType: "expert", expertId };
}
