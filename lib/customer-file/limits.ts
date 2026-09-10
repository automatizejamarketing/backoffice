/**
 * One measure of bytes for the whole journey. The screen, the transport check
 * and the server parser all read these values from here, so "20 MB" means the
 * same number of bytes everywhere and no client-only copy can drift.
 *
 * Deliberately dependency-free: the browser imports it too.
 */

export const CUSTOMER_FILE_MAX_BYTES = 20 * 1024 * 1024;
export const CUSTOMER_FILE_MAX_ROWS = 100_000;

export function formatCustomerFileBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 1024 * 1024 ? 1 : 2)} MB`;
}
