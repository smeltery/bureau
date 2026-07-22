const ELEMENTS = new Map(
  [
    "svg",
    "g",
    "defs",
    "symbol",
    "use",
    "title",
    "desc",
    "path",
    "rect",
    "circle",
    "ellipse",
    "line",
    "polyline",
    "polygon",
    "text",
    "tspan",
    "textPath",
    "linearGradient",
    "radialGradient",
    "stop",
    "pattern",
    "marker",
    "clipPath",
    "mask",
  ].map((name) => [name.toLowerCase(), name]),
);

const ATTRS = new Map(
  [
    "id",
    "class",
    "role",
    "xmlns",
    "xmlns:xlink",
    "x",
    "y",
    "x1",
    "y1",
    "x2",
    "y2",
    "cx",
    "cy",
    "r",
    "rx",
    "ry",
    "width",
    "height",
    "d",
    "points",
    "dx",
    "dy",
    "rotate",
    "transform",
    "viewBox",
    "preserveAspectRatio",
    "gradientUnits",
    "gradientTransform",
    "offset",
    "markerWidth",
    "markerHeight",
    "refX",
    "refY",
    "orient",
    "fill",
    "fill-opacity",
    "fill-rule",
    "stroke",
    "stroke-width",
    "stroke-linecap",
    "stroke-linejoin",
    "stroke-dasharray",
    "stroke-dashoffset",
    "stroke-opacity",
    "opacity",
    "color",
    "display",
    "visibility",
    "overflow",
    "clip-path",
    "mask",
    "marker-start",
    "marker-mid",
    "marker-end",
    "stop-color",
    "stop-opacity",
    "vector-effect",
    "shape-rendering",
    "text-anchor",
    "dominant-baseline",
    "font-family",
    "font-size",
    "font-style",
    "font-weight",
    "text-decoration",
    "href",
    "xlink:href",
  ].map((name) => [name.toLowerCase(), name]),
);

const RAW_TEXTLESS = new Set(["script", "foreignobject", "animate", "animatemotion", "animatetransform", "set"]);
const URL_ATTRS = new Set(["href", "xlink:href"]);
const CSS_URL_ATTRS = new Set(["fill", "stroke", "clip-path", "mask", "marker-start", "marker-mid", "marker-end"]);
const SAFE_CSS_FUNCS = new Set(["rgb", "rgba", "hsl", "hsla"]);

const MARKUP = /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<[!?][^>]*>|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
const ATTR = /([^\s=/>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]*))?/g;

export function sanitizeSvg(input: string): string {
  let out = "";
  let last = 0;
  const stack: string[] = [];
  const dropped: string[] = [];

  for (const match of input.matchAll(MARKUP)) {
    const index = match.index ?? 0;
    if (dropped.length === 0) out += escapeText(input.slice(last, index));
    last = index + match[0].length;

    const closeName = match[1]?.toLowerCase();
    const openName = match[2]?.toLowerCase();

    if (closeName) {
      if (dropped.length > 0) {
        if (dropped.at(-1) === closeName) dropped.pop();
        continue;
      }
      const pos = stack.lastIndexOf(closeName);
      if (pos < 0) continue;
      for (let i = stack.length - 1; i >= pos; i--) {
        const name = stack.pop()!;
        out += `</${ELEMENTS.get(name)}>`;
      }
      continue;
    }

    if (!openName) continue;
    if (dropped.length > 0) {
      if (RAW_TEXTLESS.has(openName)) dropped.push(openName);
      continue;
    }
    if (RAW_TEXTLESS.has(openName)) {
      dropped.push(openName);
      continue;
    }
    const tag = ELEMENTS.get(openName);
    if (!tag) continue;

    const attrSource = match[3] ?? "";
    const selfClosing = /\/\s*$/.test(attrSource);
    out += `<${tag}${sanitizeAttrs(attrSource)}${selfClosing ? "/" : ""}>`;
    if (!selfClosing) stack.push(openName);
  }

  if (dropped.length === 0) out += escapeText(input.slice(last));
  while (stack.length > 0) out += `</${ELEMENTS.get(stack.pop()!)}>`;
  return out;
}

function sanitizeAttrs(source: string): string {
  let out = "";
  for (const match of source.matchAll(ATTR)) {
    const rawName = match[1];
    if (!rawName || rawName === "/") continue;
    const lower = rawName.toLowerCase();
    if (lower.startsWith("on") || lower === "style") continue;

    const name = ATTRS.get(lower) ?? (/^(?:aria|data)-[\w-]+$/.test(lower) ? lower : null);
    if (!name) continue;

    let value = match[2] ?? "";
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (URL_ATTRS.has(lower) && !value.replace(/[\t\n\r ]+/g, "").startsWith("#")) continue;
    if (CSS_URL_ATTRS.has(lower) && !safeCssValue(value)) continue;

    out += ` ${name}="${escapeAttr(value)}"`;
  }
  return out;
}

function safeCssValue(value: string): boolean {
  if (value.includes("\\")) return false;
  for (const match of value.matchAll(/([a-zA-Z-]*)\(/g)) {
    const fn = match[1].toLowerCase();
    if (SAFE_CSS_FUNCS.has(fn)) continue;
    if (fn === "url" && /^\s*["']?\s*#/.test(value.slice((match.index ?? 0) + match[0].length))) continue;
    return false;
  }
  return true;
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;");
}
