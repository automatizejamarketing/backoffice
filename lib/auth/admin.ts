import type { Session } from "next-auth";
import { isAdminEmail } from "@/lib/config";

export function isAdminSession(session: Session | null): boolean {
  return Boolean(session?.user?.email && isAdminEmail(session.user.email));
}
