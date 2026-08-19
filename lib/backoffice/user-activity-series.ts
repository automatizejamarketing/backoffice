import {
  USER_ACTIVITY_SERIES_KEYS,
  type UserActivitySeriesKey,
} from "./user-activity-dashboard";

export const USER_ACTIVITY_SERIES_STORAGE_KEY =
  "automatize-backoffice.user-activity-series.v1";

export type UserActivitySeriesVisibility = Record<UserActivitySeriesKey, boolean>;

export const DEFAULT_USER_ACTIVITY_SERIES_VISIBILITY: UserActivitySeriesVisibility =
  {
    newUsers: true,
    users: true,
    activeUsers: true,
  };

export function parseUserActivitySeriesVisibility(
  raw: string | null | undefined,
): UserActivitySeriesVisibility {
  if (!raw) return { ...DEFAULT_USER_ACTIVITY_SERIES_VISIBILITY };

  try {
    const parsed = JSON.parse(raw) as Partial<UserActivitySeriesVisibility>;
    const visibility = { ...DEFAULT_USER_ACTIVITY_SERIES_VISIBILITY };

    for (const key of USER_ACTIVITY_SERIES_KEYS) {
      if (typeof parsed[key] === "boolean") {
        visibility[key] = parsed[key];
      }
    }

    return visibility;
  } catch {
    return { ...DEFAULT_USER_ACTIVITY_SERIES_VISIBILITY };
  }
}

export function serializeUserActivitySeriesVisibility(
  visibility: UserActivitySeriesVisibility,
): string {
  return JSON.stringify(visibility);
}
