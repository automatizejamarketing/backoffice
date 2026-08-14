import { useQuery } from "@tanstack/react-query";
import type { CompanyLocationRow } from "@/lib/db/company-location-queries";

export function useCompanyProfile(userId: string | null) {
  return useQuery({
    queryKey: ["company-locations", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const response = await fetch(`/api/users/${userId}/company-locations`);
      if (!response.ok) {
        throw new Error("Não foi possível carregar as unidades do cliente.");
      }
      return (await response.json()) as {
        company: {
          id: string;
          name: string;
          niche: string | null;
          websiteUrl: string | null;
        } | null;
        locations: CompanyLocationRow[];
      };
    },
  });
}

export function useCompanyLocations(userId: string | null) {
  const query = useCompanyProfile(userId);
  return {
    ...query,
    data: query.data?.locations ?? [],
  };
}
