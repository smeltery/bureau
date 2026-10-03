// Percent of the office weekly provider limit reserved for member-backed turns
// when the owner enables member usage pacing.
export const DEFAULT_MEMBER_SHARE = 80;

export const MEMBER_SHARE_OPTIONS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100] as const;

export function validMemberShare(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 10 && value <= 100 && value % 10 === 0;
}
