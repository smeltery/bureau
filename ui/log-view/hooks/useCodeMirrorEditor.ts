import { useEffect, useRef } from "react";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { autocompletion, closeBrackets } from "@codemirror/autocomplete";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { oneDark } from "@codemirror/theme-one-dark";
import { languageExtension, type Tab } from "../editor-model.ts";

export function useCodeMirrorEditor({
  mode,
  mobile,
  tabs,
  activePath,
  setTabsAndPersist,
}: {
  mode: string;
  mobile: boolean;
  tabs: Tab[];
  activePath: string | null;
  setTabsAndPersist: (updater: (prev: Tab[]) => Tab[]) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const activePathRef = useRef<string | null>(null);
  activePathRef.current = activePath;
  const langCompartmentRef = useRef<Compartment>(new Compartment());
  const themeCompartmentRef = useRef<Compartment>(new Compartment());
  const readonlyCompartmentRef = useRef<Compartment>(new Compartment());
  // Tracks the language currently installed in the lang compartment so the
  // sync effect only reconfigures when the buffer's language actually changes.
  const installedLangRef = useRef<string | null>(null);

  // Initialize the CodeMirror EditorView once. We swap content in and out
  // via dispatch when the active tab changes; no remount.
  useEffect(() => {
    if (!containerRef.current) return;

    const updateListener = EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;
      const path = activePathRef.current;
      if (!path) return;
      const text = update.state.doc.toString();
      setTabsAndPersist((prev) =>
        prev.map((t) => {
          if (t.path !== path) return t;
          if (t.content === text) return t;
          return { ...t, content: text, dirty: true };
        }),
      );
    });

    // Mobile gets a leaner extension set: no gutter (eats ~40px on a 390px
    // screen), no autocompletion popup (lands off-screen with the soft
    // keyboard up), and contentAttributes that turn off iOS text assistance.
    const view = new EditorView({
      parent: containerRef.current,
      state: EditorState.create({
        doc: "",
        extensions: [
          ...(mobile ? [] : [lineNumbers()]),
          highlightActiveLine(),
          history(),
          highlightSelectionMatches(),
          ...(mobile ? [] : [autocompletion()]),
          closeBrackets(),
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
          EditorView.lineWrapping,
          ...(mobile
            ? [
                EditorView.contentAttributes.of({
                  autocorrect: "off",
                  autocapitalize: "off",
                  spellcheck: "false",
                }),
              ]
            : []),
          langCompartmentRef.current.of([]),
          themeCompartmentRef.current.of(mode === "dark" ? oneDark : syntaxHighlighting(defaultHighlightStyle)),
          readonlyCompartmentRef.current.of([]),
          updateListener,
        ],
      }),
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When theme mode toggles, swap the theme compartment without rebuilding state.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: themeCompartmentRef.current.reconfigure(mode === "dark" ? oneDark : syntaxHighlighting(defaultHighlightStyle)),
    });
  }, [mode]);

  // Sync the editor view whenever the active tab's content or language
  // changes; covers tab switches, content arrival from server, and external
  // reloads. Equality checks avoid feedback with the update listener.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (!activePath) {
      if (view.state.doc.length > 0) {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "" } });
      }
      if (installedLangRef.current !== null) {
        view.dispatch({ effects: langCompartmentRef.current.reconfigure([]) });
        installedLangRef.current = null;
      }
      return;
    }
    const tab = tabs.find((t) => t.path === activePath);
    if (!tab) return;
    const current = view.state.doc.toString();
    if (current !== tab.content) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: tab.content } });
    }
    if (installedLangRef.current !== tab.language) {
      view.dispatch({ effects: langCompartmentRef.current.reconfigure(languageExtension(tab.language)) });
      installedLangRef.current = tab.language;
    }
  }, [tabs, activePath]);

  return { containerRef, viewRef, activePathRef };
}
