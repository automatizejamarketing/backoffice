export const COMPANY_PRODUCT_CODES = [
  "traffic",
  "menu_orders",
  "inventory_cmv",
] as const;

export const COMPANY_OFFER_CODES = [
  "menu_orders",
  "inventory_cmv",
  "operation_complete",
] as const;

export const COMPANY_CAPABILITIES = [
  "company:manage",
  "billing:manage",
  "members:manage",
  "menu:view",
  "menu:manage_base",
  "menu:manage_unit",
  "orders:view",
  "orders:operate",
  "whatsapp:manage",
  "inventory:view",
  "inventory:operate",
  "inventory:manage",
  "purchasing:view",
  "purchasing:operate",
  "cmv:view",
] as const;

export type CompanyProductCode = (typeof COMPANY_PRODUCT_CODES)[number];
export type CompanyOfferCode = (typeof COMPANY_OFFER_CODES)[number];
export type CompanyCapability = (typeof COMPANY_CAPABILITIES)[number];
export type CompanyCapabilityAuthority = CompanyProductCode | "company";

export const COMPANY_PRODUCT_DISPLAY_NAMES = {
  traffic: "Tráfego",
  menu_orders: "Cardápio & Pedidos",
  inventory_cmv: "Estoque & CMV",
} as const satisfies Record<CompanyProductCode, string>;

export const COMPANY_OFFER_DISPLAY_NAMES = {
  menu_orders: "Cardápio & Pedidos",
  inventory_cmv: "Estoque & CMV",
  operation_complete: "Operação Completa",
} as const satisfies Record<CompanyOfferCode, string>;

export const COMPANY_CAPABILITY_DISPLAY_NAMES = {
  "company:manage": "Gerenciar empresa",
  "billing:manage": "Gerenciar cobrança",
  "members:manage": "Gerenciar equipe",
  "menu:view": "Ver cardápio",
  "menu:manage_base": "Gerenciar cardápio base",
  "menu:manage_unit": "Gerenciar cardápio por unidade",
  "orders:view": "Ver pedidos",
  "orders:operate": "Operar pedidos",
  "whatsapp:manage": "Gerenciar WhatsApp",
  "inventory:view": "Ver estoque",
  "inventory:operate": "Operar estoque",
  "inventory:manage": "Gerenciar estoque",
  "purchasing:view": "Ver compras",
  "purchasing:operate": "Operar compras",
  "cmv:view": "Ver CMV",
} as const satisfies Record<CompanyCapability, string>;

const OFFER_PRODUCTS = {
  menu_orders: ["menu_orders"],
  inventory_cmv: ["inventory_cmv"],
  operation_complete: ["menu_orders", "inventory_cmv"],
} as const satisfies Record<CompanyOfferCode, readonly CompanyProductCode[]>;

const CAPABILITY_AUTHORITIES = {
  "company:manage": "company",
  "billing:manage": "company",
  "members:manage": "company",
  "menu:view": "menu_orders",
  "menu:manage_base": "menu_orders",
  "menu:manage_unit": "menu_orders",
  "orders:view": "menu_orders",
  "orders:operate": "menu_orders",
  "whatsapp:manage": "menu_orders",
  "inventory:view": "inventory_cmv",
  "inventory:operate": "inventory_cmv",
  "inventory:manage": "inventory_cmv",
  "purchasing:view": "inventory_cmv",
  "purchasing:operate": "inventory_cmv",
  "cmv:view": "inventory_cmv",
} as const satisfies Record<CompanyCapability, CompanyCapabilityAuthority>;

export function productsForOffer(offer: CompanyOfferCode) {
  return OFFER_PRODUCTS[offer];
}

export function productForCapability(capability: CompanyCapability) {
  return CAPABILITY_AUTHORITIES[capability];
}
