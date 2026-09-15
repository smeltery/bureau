let katexPromise: Promise<typeof import("katex").default> | null = null;

function getKatex() {
  if (!katexPromise) katexPromise = import("katex").then((mod) => mod.default);
  return katexPromise;
}

function ensureKatexStylesheet() {
  if (document.querySelector("link[data-katex-stylesheet]")) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.dataset.katexStylesheet = "";
  const demoPath = location.pathname === "/demo" || location.pathname.startsWith("/demo/");
  link.href = `${demoPath ? "/demo" : ""}/katex/katex.min.css`;
  document.head.appendChild(link);
}

/** Lazy-render `.katex-math` placeholders. Returns a cancel function. */
export function renderKatexBlocks(root: HTMLElement): () => void {
  const nodes = Array.from(root.querySelectorAll<HTMLElement>(".katex-math:not([data-processed])"));
  if (nodes.length === 0) return () => {};
  ensureKatexStylesheet();
  let cancelled = false;
  getKatex()
    .then((katex) => {
      if (cancelled) return;
      for (const node of nodes) {
        const source = node.dataset.katexSource ?? "";
        try {
          node.innerHTML = katex.renderToString(source, {
            displayMode: node.dataset.katexDisplay === "true",
            throwOnError: false,
            trust: false,
            output: "htmlAndMathml",
          });
        } catch {
          node.dataset.katexError = "";
        } finally {
          node.dataset.processed = "";
        }
      }
    })
    .catch(() => {
      // Leave the TeX source visible if the chunk cannot load.
    });
  return () => {
    cancelled = true;
  };
}
