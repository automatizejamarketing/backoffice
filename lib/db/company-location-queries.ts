export type CompanyLocationHours = {
  deliveryMode?: "all_day" | "specific_hours";
  scheduleBlocks?: Array<{
    days: number[];
    startMinute: number;
    endMinute: number;
  }>;
};

export type CompanyLocationRow = {
  id: string;
  name: string | null;
  isPrimary: boolean;
  sortOrder?: number;
  googlePlaceId?: string | null;
  businessAddress?: unknown;
  businessOperatingHours: CompanyLocationHours | null;
};

export type CompanyProfileSummary = {
  id: string;
  name: string;
  niche: string | null;
  websiteUrl: string | null;
  googlePlaceId?: string | null;
  businessAddress?: unknown;
};

export type CompanyLocationsResponse = {
  company: CompanyProfileSummary | null;
  locations: CompanyLocationRow[];
};
