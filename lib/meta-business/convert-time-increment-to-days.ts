import { TimeIncrement } from "./types";

export function convertTimeIncrementToDays(
  timeIncrement: TimeIncrement
): string {
  switch (timeIncrement) {
    case "day":
      return "1";
    case "week":
      return "7";
    case "month":
      return "30";
    case "quarterly":
      return "90";
    default:
      return "all_days";
  }
}
