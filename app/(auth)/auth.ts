import NextAuth, { type DefaultSession } from "next-auth";
import type { DefaultJWT } from "next-auth/jwt";
import Google from "next-auth/providers/google";
import { canBackofficeEmailSignIn } from "@/lib/auth/backoffice-users";
import { BACKOFFICE_MAGIC_SESSION_MAX_AGE_SECONDS } from "@/lib/auth/magic-session-constants";
import { authConfig } from "./auth.config";

declare module "next-auth" {
  interface Session extends DefaultSession {
    user: {
      id: string;
      email: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    id: string;
  }
}

export const {
  handlers: { GET, POST },
  auth,
  signIn,
  signOut,
} = NextAuth({
  ...authConfig,
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
  ],
  session: {
    strategy: "jwt",
    maxAge: BACKOFFICE_MAGIC_SESSION_MAX_AGE_SECONDS,
  },
  jwt: {
    maxAge: BACKOFFICE_MAGIC_SESSION_MAX_AGE_SECONDS,
  },
  callbacks: {
    async signIn({ user }) {
      // Backoffice access is granted by DB role or admin email bootstrap.
      if (!(await canBackofficeEmailSignIn(user.email))) {
        // Redirect to login with error
        return "/login?error=unauthorized";
      }
      return true;
    },
    jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
      }
      return session;
    },
  },
});
