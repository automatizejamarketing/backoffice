// Minimal ambient types for Bun's test runner so `tsc`/`next build` type-check
// the `bun:test` suites without pulling in the full `@types/bun` (which would
// drag Bun's global DOM/lib overrides into the Next.js app). Only what the
// suites actually use is declared; extend as tests adopt more matchers.
declare module "bun:test" {
  interface Matchers {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toStrictEqual(expected: unknown): void;
    toHaveLength(length: number): void;
    toHaveProperty(keyPath: string | readonly string[], value?: unknown): void;
    toContain(expected: unknown): void;
    toMatch(expected: string | RegExp): void;
    toMatchObject(expected: unknown): void;
    toThrow(expected?: unknown): void;
    toBeNull(): void;
    toBeUndefined(): void;
    toBeDefined(): void;
    toBeTruthy(): void;
    toBeFalsy(): void;
    toBeInstanceOf(expected: unknown): void;
    toBeGreaterThan(expected: number): void;
    toBeGreaterThanOrEqual(expected: number): void;
    toBeLessThan(expected: number): void;
    toBeLessThanOrEqual(expected: number): void;
    readonly not: Matchers;
    readonly resolves: Matchers;
    readonly rejects: Matchers;
  }

  export function describe(name: string, fn: () => void): void;
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function beforeEach(fn: () => void | Promise<void>): void;
  export function afterEach(fn: () => void | Promise<void>): void;
  export const expect: (actual?: unknown) => Matchers;
}
