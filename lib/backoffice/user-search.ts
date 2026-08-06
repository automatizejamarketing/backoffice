import { ilike, or, sql } from "drizzle-orm";
import type { BusinessPortfolioItem } from "@/lib/db/business-queries";
import { user } from "@/lib/db/schema";
import { normalizeBrazilianPhone } from "@/lib/phone";

export function extractPhoneSearchDigits(search: string): string | null {
  const digitsOnly = search.replace(/\D/g, "");
  if (digitsOnly.length < 3) return null;
  return normalizeBrazilianPhone(search) ?? digitsOnly;
}

export function buildUserListSearchCondition(trimmedSearch: string) {
  const conditions = [
    ilike(user.email, `%${trimmedSearch}%`),
    ilike(user.name, `%${trimmedSearch}%`),
    sql`EXISTS (
      SELECT 1
      FROM user_companies uc
      INNER JOIN companies c ON c.id = uc.company_id
      WHERE uc.user_id = ${user.id}
        AND c.name ILIKE ${`%${trimmedSearch}%`}
    )`,
  ];

  const phoneDigits = extractPhoneSearchDigits(trimmedSearch);
  if (phoneDigits) {
    conditions.push(ilike(user.phone, `%${phoneDigits}%`));
  }

  return or(...conditions);
}

export function matchesPortfolioSearch(
  item: Pick<
    BusinessPortfolioItem,
    | "userEmail"
    | "userPhone"
    | "companyName"
    | "consultantEmail"
    | "consultantName"
  >,
  search: string,
): boolean {
  const query = search.trim().toLowerCase();
  if (query.length === 0) return true;

  const textHaystack = [
    item.userEmail,
    item.companyName ?? "",
    item.consultantEmail ?? "",
    item.consultantName ?? "",
  ]
    .join(" ")
    .toLowerCase();
  if (textHaystack.includes(query)) return true;

  const phoneQueryDigits = extractPhoneSearchDigits(search);
  if (!phoneQueryDigits) return false;

  const itemPhone = normalizeBrazilianPhone(item.userPhone) ?? "";
  return itemPhone.includes(phoneQueryDigits);
}
