import { useQuery } from "@tanstack/react-query";
import type { CompanyLocationsResponse } from "@/lib/db/company-location-queries";

export function useCompanyProfile(userId: string | null) {
  return useQuery({
    queryKey: ["company-locations", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const response = await fetch(`/api/users/${userId}/company-locations`);
      if (!response.ok) {
        throw new Error("Não foi possível carregar as unidades do cliente.");
      }
      return (await response.json()) as CompanyLocationsResponse;
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
