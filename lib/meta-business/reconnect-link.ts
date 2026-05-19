export type ReconnectInfo = {
  url: string;
  instructions: string;
};

/**
 * Builds the link an admin sends to the END USER so they can reconnect their
 * Facebook account. It points at the protected frontend marketing page (not
 * the raw OAuth endpoint): the OAuth callback attaches the new token to the
 * logged-in frontend `session.user.id`, so the user must reach it through a
 * logged-in session — deep-linking the auth endpoint while logged out drops
 * the token at /login.
 */
export function buildReconnectInfo(): ReconnectInfo {
  const redirectUri = process.env.NEXT_PUBLIC_META_MARKETING_REDIRECT_URI;
  let origin = "https://www.automatizemarketing.com";
  if (redirectUri) {
    try {
      origin = new URL(redirectUri).origin;
    } catch {
      // keep the fallback origin
    }
  }

  return {
    url: `${origin}/app/marketing`,
    instructions:
      "Envie este link para o próprio usuário. Ele precisa estar logado na conta dele no site e reconectar o Facebook na página de Marketing. A reconexão precisa ser feita pelo usuário — um admin não consegue renovar este token.",
  };
}
