export type ActivatableUser = {
  authProvider: string;
  emailVerified: Date | string | null;
};

export function canManageUserActivation(user: ActivatableUser): boolean {
  return user.authProvider === "credentials" && !user.emailVerified;
}

export function buildUserActivationUrl(
  token: string,
  frontendOrigin: string,
): string {
  const url = new URL("/ativar", frontendOrigin.trim());
  url.searchParams.set("token", token);
  return url.toString();
}
