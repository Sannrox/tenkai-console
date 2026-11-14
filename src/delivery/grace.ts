/**
 * Exposure grace windows as declared on environments and channels
 * (Sannrox/tenkai#1277). Its own module: the environment page loads up front,
 * and the exposure helpers should not ride along with it.
 */

const GRACE_UNITS = [
  ["d", 86_400_000],
  ["h", 3_600_000],
  ["m", 60_000],
  ["s", 1_000],
] as const;

/** A declared grace window in the largest unit that divides it; unset reads as such. */
export const graceWindow = (ms: number | undefined): string => {
  if (ms === undefined) {
    return "not set";
  }
  const unit = GRACE_UNITS.find(([, size]) => ms % size === 0);
  return unit ? `${ms / unit[1]}${unit[0]}` : `${ms}ms`;
};
