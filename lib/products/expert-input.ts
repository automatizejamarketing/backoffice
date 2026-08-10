import { z } from "zod";
import { normalizeBrazilianPhone } from "@/lib/phone";

const schema = z.object({
  displayName: z.string().trim().min(2).max(120),
  phone: z.string().trim().optional().nullable(),
  pixKey: z.string().trim().min(1).max(255),
  profileImageUrl: z.string().trim().optional().nullable(),
  platformFeePercent: z.number().finite().min(0).max(100).optional(),
  platformFeeFixedCentavos: z.number().int().min(0).optional(),
  marketplaceFeePercent: z.number().finite().min(0).max(100).optional(),
  status: z.enum(["active", "inactive"]).default("active"),
});

function parseProfileImageUrl(value: string | null | undefined) {
  if (!value) return null;
  const [pathname, query = ""] = value.split("?");
  const objectKey = new URLSearchParams(query).get("key");
  if (
    pathname !== "/api/products/assets" ||
    !objectKey?.startsWith("r2/expert-avatars/") ||
    objectKey.includes("..")
  ) {
    throw new Error("Foto de perfil do expert inválida");
  }
  return value;
}

export function parseExpertAdminInput(input: unknown) {
  const parsed = schema.parse(input);
  const phone = normalizeBrazilianPhone(parsed.phone);

  if (phone && phone.length !== 10 && phone.length !== 11) {
    throw new Error("WhatsApp deve ter DDD e 8 ou 9 dígitos");
  }

  return {
    displayName: parsed.displayName,
    phone,
    pixKey: parsed.pixKey,
    profileImageUrl: parseProfileImageUrl(parsed.profileImageUrl),
    status: parsed.status,
    ...(parsed.platformFeePercent === undefined
      ? {}
      : {
          platformFeeBasisPoints: Math.round(
            parsed.platformFeePercent * 100,
          ),
        }),
    ...(parsed.platformFeeFixedCentavos === undefined
      ? {}
      : { platformFeeFixedCentavos: parsed.platformFeeFixedCentavos }),
    ...(parsed.marketplaceFeePercent === undefined
      ? {}
      : {
          marketplaceFeeBasisPoints: Math.round(
            parsed.marketplaceFeePercent * 100,
          ),
        }),
  };
}
