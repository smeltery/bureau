/** Bound the entire metadata request, including startup and stream completion. */
export async function withOneShotDeadline<T>(run: () => Promise<T>, timeoutMs = 30_000): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(run),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Background prompt timed out")), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}
