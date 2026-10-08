/** Only the MCP consent page may be a post-login destination; anything else falls back to home. */
export function safeLoginReturn(value: string | null | undefined): string | null {
  return value?.startsWith("/oauth/authorize?") ? value : null;
}

export function loginUrlWithReturn(path: string): string {
  return `/login?${new URLSearchParams({ next: path })}`;
}
