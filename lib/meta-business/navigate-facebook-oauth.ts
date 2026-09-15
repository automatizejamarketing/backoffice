/**
 * Facebook OAuth pages send X-Frame-Options: DENY. Navigating an iframe
 * (user-detail sheet, Cursor browser, any embed) shows
 * "www.facebook.com refused to connect." Always leave the frame.
 */
export function navigateToFacebookOAuth(authUrl: string): void {
  const top = window.top;
  if (top && top !== window) {
    try {
      top.location.assign(authUrl);
      return;
    } catch {
      window.open(authUrl, "_blank", "noopener,noreferrer");
      return;
    }
  }
  window.location.assign(authUrl);
}
