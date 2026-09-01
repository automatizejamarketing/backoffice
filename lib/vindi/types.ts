export type VindiMoney = string;

export type VindiCustomer = {
  id: number;
  name: string;
  email?: string | null;
  registry_code?: string | null;
  code?: string | null;
  status: "active" | "inactive" | "archived";
  metadata?: Record<string, string>;
};

export type VindiCharge = {
  id: number;
  amount: VindiMoney;
  status: string;
  last_transaction?: {
    status?: string;
    gateway_response_fields?: Record<string, string | undefined>;
  } | null;
};

export type VindiBill = {
  id: number;
  amount: VindiMoney;
  status: string;
  charges?: VindiCharge[];
  metadata?: Record<string, string>;
};

export type VindiProduct = {
  id: number;
  name: string;
  code?: string | null;
};

export type VindiCustomerResponse = { customer: VindiCustomer };
export type VindiBillResponse = { bill: VindiBill };
export type VindiProductsResponse = { products: VindiProduct[] };
