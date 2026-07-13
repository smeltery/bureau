import { useCallback, useRef, useState, type RefObject } from "react";
import type { Terminal } from "@xterm/xterm";
import { applyCtrl, type SoftKey } from "../terminal-mobile.tsx";
import { useMobileKeyboardOpen } from "./useMobileKeyboardOpen.ts";

type UseTerminalSoftKeysOptions = {
  inputProxyRef: RefObject<HTMLTextAreaElement | null>;
  mobile: boolean;
  sendInput: (data: string) => void;
  termRef: RefObject<Terminal | null>;
};

export function useTerminalSoftKeys({ inputProxyRef, mobile, sendInput, termRef }: UseTerminalSoftKeysOptions) {
  const [ctrlActive, setCtrlActive] = useState(false);
  const ctrlActiveRef = useRef(false);
  const keyboardOpen = useMobileKeyboardOpen(mobile);

  const setCtrl = useCallback((value: boolean) => {
    ctrlActiveRef.current = value;
    setCtrlActive(value);
  }, []);

  const sendModifiedInput = useCallback(
    (data: string) => {
      let toSend = data;
      if (ctrlActiveRef.current) {
        toSend = applyCtrl(data);
        setCtrl(false);
      }
      sendInput(toSend);
    },
    [sendInput, setCtrl],
  );

  const doPaste = useCallback(async () => {
    let text = "";
    try {
      if (navigator.clipboard?.readText) {
        text = await navigator.clipboard.readText();
      }
    } catch {}
    if (!text) {
      const fromPrompt = window.prompt("Paste:");
      if (fromPrompt) text = fromPrompt;
    }
    if (text) termRef.current?.paste(text);
    inputProxyRef.current?.focus();
  }, [inputProxyRef, termRef]);

  const handleSoftKey = useCallback(
    (key: SoftKey) => {
      if (key.toggleCtrl) {
        setCtrl(!ctrlActiveRef.current);
        inputProxyRef.current?.focus();
        return;
      }
      if (key.action === "paste") {
        void doPaste();
        return;
      }
      if (key.arrow) {
        sendModifiedInput(key.arrow);
      } else if (key.data !== undefined) {
        sendModifiedInput(key.data);
      }
      inputProxyRef.current?.focus();
    },
    [doPaste, inputProxyRef, sendModifiedInput, setCtrl],
  );

  return {
    ctrlActive,
    ctrlActiveRef,
    handleSoftKey,
    keyboardOpen,
    sendModifiedInput,
  };
}
