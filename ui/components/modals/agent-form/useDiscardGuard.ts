import { useEffect } from "react";

export function useDiscardGuard(dirty: boolean, saving: boolean, onClose: () => void) {
  function confirmDiscard(): boolean {
    return !saving && (!dirty || window.confirm("Discard unsaved changes?"));
  }
  function requestClose() {
    if (confirmDiscard()) onClose();
  }
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  return { confirmDiscard, requestClose };
}
