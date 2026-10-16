"use server";

import { cookies } from "next/headers";
import { safeLoginReturn } from "@/lib/auth/login-return";
import { BACKOFFICE_MAGIC_SESSION_COOKIE } from "@/lib/auth/magic-session-constants";
import { signIn, signOut } from "./auth";

export async function signInWithGoogle(formData: FormData) {
  await signIn("google", { redirectTo: safeLoginReturn(String(formData.get("next") ?? "")) ?? "/" });
}

export async function signOutAction() {
  const cookieStore = await cookies();
  cookieStore.delete(BACKOFFICE_MAGIC_SESSION_COOKIE);
  await signOut({ redirectTo: "/login" });
}
