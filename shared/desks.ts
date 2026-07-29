export const DESK_SLOTS = [
  { row: 0, col: 0 },
  { row: 0, col: 1 },
  { row: 1, col: 0 },
  { row: 1, col: 1 },
  { row: 2, col: 0 },
  { row: 2, col: 1 },
  { row: 3, col: 0 },
  { row: 3, col: 1 },
];

export const DESK_COUNT = DESK_SLOTS.length;

export function isValidDesk(desk: number): boolean {
  return Number.isInteger(desk) && desk >= 0 && desk < DESK_COUNT;
}
