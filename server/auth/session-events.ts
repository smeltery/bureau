let onSessionsChangedHook: () => void = () => {};

export function setOnSessionsChanged(cb: () => void): void {
  onSessionsChangedHook = cb;
}

export function fireSessionsChangedHook(): void {
  try {
    onSessionsChangedHook();
  } catch (err) {
    console.error("[auth] onSessionsChangedHook threw:", err);
  }
}
