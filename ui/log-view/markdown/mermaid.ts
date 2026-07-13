// Lazy singleton: mermaid is ~1MB minified, so we only fetch it the first
// time a message containing a mermaid block reaches the renderer.
let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;
// Monotonically-unique per-render id. Mermaid uses the id we pass to render()
// as a prefix for internal SVG defs/markers/clipPath etc., and same-document
// id collisions cause url(#...) refs to resolve to the wrong element.
let mermaidIdCounter = 0;

function getMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((mod) => {
      const m = mod.default;
      const mode = document.documentElement.getAttribute("data-theme-mode") === "dark" ? "dark" : "default";
      m.initialize({
        startOnLoad: false,
        theme: mode,
        securityLevel: "strict",
        fontFamily: "DM Sans, sans-serif",
      });
      return m;
    });
  }
  return mermaidPromise;
}

export function renderMermaidBlocks(root: HTMLElement): () => void {
  const nodes = Array.from(root.querySelectorAll<HTMLElement>(".mermaid:not([data-processed])"));
  if (nodes.length === 0) return () => {};
  const sources = nodes.map((n) => n.getAttribute("data-mermaid-source") ?? "");
  let cancelled = false;
  const markError = (node: HTMLElement, prefix: string, msg: string, src: string) => {
    const wrapper = node.closest<HTMLElement>(".mermaid-wrapper");
    if (wrapper) wrapper.setAttribute("data-mermaid-error", "true");
    node.textContent = `${prefix}: ${msg}\n\n${src}`;
    node.setAttribute("data-processed", "true");
  };
  getMermaid()
    .then(async (m) => {
      if (cancelled) return;
      for (let i = 0; i < nodes.length; i++) {
        if (cancelled) return;
        const node = nodes[i];
        try {
          const id = `mmd-${++mermaidIdCounter}`;
          const { svg } = await m.render(id, sources[i]);
          node.innerHTML = svg;
          node.setAttribute("data-processed", "true");
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          markError(node, "Mermaid error", msg, sources[i]);
        }
      }
    })
    .catch((e: unknown) => {
      if (cancelled) return;
      const msg = e instanceof Error ? e.message : String(e);
      nodes.forEach((node, i) => {
        markError(node, "Failed to load mermaid", msg, sources[i]);
      });
    });
  return () => {
    cancelled = true;
  };
}
