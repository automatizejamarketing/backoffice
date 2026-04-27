import "server-only";
import Stripe from "stripe";

let stripeInstance: Stripe | null = null;

if (process.env.STRIPE_SECRET_KEY) {
  stripeInstance = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: "2026-02-25.clover",
    typescript: true,
  });
}

export const stripe = stripeInstance;

export type { Stripe };
