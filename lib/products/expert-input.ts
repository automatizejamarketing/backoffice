import { z } from "zod";
import { normalizeBrazilianPhone } from "@/lib/phone";

const schema = z.object({
  displayName: z.string().trim().min(2).max(120),
  phone: z.string().trim().optional().nullable(),
  pixKey: z.string().trim().min(1).max(255),
  status: z.enum(["active", "inactive"]).default("active"),
});

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
    status: parsed.status,
  };
}
