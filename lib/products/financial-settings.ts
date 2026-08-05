import { z } from "zod";

const schema = z.object({
  platformFeePercent: z.number().finite().min(0).max(100),
});

export function parseProductFinancialSettingsInput(input: unknown) {
  const parsed = schema.parse(input);
  return {
    platformFeeBasisPoints: Math.round(parsed.platformFeePercent * 100),
  };
}
