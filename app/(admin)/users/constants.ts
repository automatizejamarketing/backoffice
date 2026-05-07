// Shared constants for the Users admin page. Kept in a neutral (non-"use
// client") module so both the Server Component (`page.tsx`) and the Client
// Component (`users-table-toolbar.tsx`) can import them safely. Re-exporting
// values from a "use client" module turns them into client-reference proxies
// on the server, which would break things like `new Set(PAGE_SIZE_OPTIONS)`.

export const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;
export const DEFAULT_PAGE_SIZE = 10;
export const MIN_SEARCH_LENGTH = 3;
