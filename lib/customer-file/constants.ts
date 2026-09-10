/** Exclusive executor lease. Expiry does not free the audience for another operation. */
export const CUSTOMER_FILE_LEASE_MS = 15 * 60 * 1000;

/** Temporary contact material is discarded 24h after receipt; retries do not restart this. */
export const CUSTOMER_FILE_RETENTION_MS = 24 * 60 * 60 * 1000;
