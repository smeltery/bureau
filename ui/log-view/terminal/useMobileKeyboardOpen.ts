import { useEffect, useState } from "react";

export function useMobileKeyboardOpen(mobile: boolean): boolean {
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  // Track keyboard-open state by comparing visualViewport.height to
  // window.innerHeight. 100px threshold ignores toolbar appear/disappear and
  // only flips when a full soft keyboard opens. Calibrated for iPhone soft
  // keyboards (>=250px tall); the iPad split / floating mini keyboard is
  // shorter and won't cross the threshold; revisit if iPad becomes a
  // first-class target.
  useEffect(() => {
    if (!mobile) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      setKeyboardOpen(window.innerHeight - vv.height > 100);
    };
    update();
    vv.addEventListener("resize", update);
    return () => vv.removeEventListener("resize", update);
  }, [mobile]);

  return keyboardOpen;
}
