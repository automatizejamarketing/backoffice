import type { NextAuthConfig } from "next-auth";

export const authConfig = {
  pages: {
    signIn: "/login",
  },
  providers: [
    // Added in auth.ts to avoid issues with Edge runtime
  ],
} satisfies NextAuthConfig;

