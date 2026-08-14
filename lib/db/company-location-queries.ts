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
  businessOperatingHours: CompanyLocationHours | null;
};
