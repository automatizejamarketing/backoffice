// Backoffice keeps the correlation-id helper defined in ./with-meta-logging.
// This thin re-export exposes it under the same module path the frontend uses
// (@/lib/observability/correlation-id), so lib/meta-business/marketing/normalize-meta-error.ts
// stays byte-identical to the frontend copy (meta-primitives-parity test).
export { attachCorrelationId } from "./with-meta-logging";
