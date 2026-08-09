// Formatting for numbers a person reads. A LEAF on purpose: it imports nothing,
// so both the server (storage reports, attachment notices) and the browser
// (storage modal) can share one answer.
//
// Why it is shared rather than convenient-per-file: bureau had four byte
// formatters and they disagreed. Two capped at MB, so a 50 GB office read
// "51200.0 MB" in the Storage modal while `/bureau-storage` said "50 GB" for the
// same bytes — the same figure, two answers, and the misleading one was the one
// in the UI. A fourth copy had no callers at all. Size formatting is exactly the
// kind of thing that looks too small to share right up until the surfaces
// disagree in front of a user.

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/**
 * A byte count as a person reads it: `0 B`, `512 B`, `1.5 KB`, `50 GB`.
 *
 * Scales all the way to TB, because storage reports are where large numbers
 * actually turn up and a unit cap turns a readable figure into arithmetic.
 *
 * Precision is chosen rather than fixed: no decimal for whole numbers, for bytes
 * (a third of a byte means nothing), or once the value reaches double digits
 * where a tenth is noise — otherwise one decimal, which is where it carries
 * information. So `1 KB`, not `1.0 KB`; `1.5 KB`; `10 KB`, not `10.2 KB`.
 *
 * A non-finite or negative count is reported as unknown rather than coerced to
 * `0 B`: those inputs mean "we could not measure this", and printing a confident
 * zero would hide a bug behind a plausible number.
 */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "unknown size";
  if (bytes === 0) return "0 B";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const precision = unit === 0 || value >= 10 || Number.isInteger(value) ? 0 : 1;
  return `${value.toFixed(precision)} ${UNITS[unit]}`;
}
