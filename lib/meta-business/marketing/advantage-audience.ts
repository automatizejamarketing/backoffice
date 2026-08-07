/**
 * Advantage+ audience — reading and clearing the manual targeting signals.
 *
 * Meta does NOT delete age/gender/detailed targeting when Advantage+ audience is
 * switched on: `mergeAdSetTargeting` keeps them and declares
 * `targeting_relaxation_types`, which downgrades them from limits to signals the
 * delivery system may go beyond. That is faithful to Meta, but it makes for a
 * dishonest screen — a greyed-out age field that still steers delivery.
 *
 * So the editors clear those signals as they lock them, and warn first. What the
 * manager sees then matches what the ad set does: nothing manual is narrowing it.
 *
 * Custom audiences are deliberately NOT cleared. They are the intended seed for
 * Advantage+ (Meta expands *from* them), and silently dropping someone's
 * remarketing list would destroy work rather than simplify it.
 */

/** Meta's on-the-wire shape: `targeting_automation.advantage_audience` is 0 | 1. */
export type AdvantageAudienceTargeting = {
  targeting_automation?: { advantage_audience?: number | boolean } | null;
  age_min?: number | null;
  age_max?: number | null;
  genders?: readonly unknown[] | null;
  flexible_spec?: readonly unknown[] | null;
};

/** Meta's defaults — the values that mean "no age constraint". */
export const DEFAULT_AGE_MIN = 18;
export const DEFAULT_AGE_MAX = 65;

export function isAdvantageAudienceOn(
  targeting: AdvantageAudienceTargeting | null | undefined,
): boolean {
  const value = targeting?.targeting_automation?.advantage_audience;
  return value === 1 || value === true;
}

/**
 * Whether switching Advantage+ on would discard anything the user configured.
 * Drives the confirmation warning — no warning when there is nothing to lose.
 */
export function hasManualAudienceSignals(
  targeting: AdvantageAudienceTargeting | null | undefined,
): boolean {
  if (!targeting) return false;
  const ageMin = targeting.age_min ?? DEFAULT_AGE_MIN;
  const ageMax = targeting.age_max ?? DEFAULT_AGE_MAX;
  return (
    ageMin !== DEFAULT_AGE_MIN ||
    ageMax !== DEFAULT_AGE_MAX ||
    Boolean(targeting.genders?.length) ||
    Boolean(targeting.flexible_spec?.length)
  );
}

/** The targeting values an editor snaps to when Advantage+ is switched on. */
export const CLEARED_AUDIENCE_SIGNALS = {
  ageMin: DEFAULT_AGE_MIN,
  ageMax: DEFAULT_AGE_MAX,
  /** Empty = every gender; Meta drops the field entirely. */
  genders: [] as number[],
} as const;
