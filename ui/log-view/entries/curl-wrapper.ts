type Literal = { value: string; end: number };

// Read one literal shell argument without evaluating expansions or substitutions.
function literalArgument(input: string): Literal | null {
  let quote: string | null = null;
  let value = "";
  let index = 0;
  for (; index < input.length; index++) {
    const ch = input[index]!;
    if (!quote && /\s/.test(ch)) break;
    if (ch === quote) {
      quote = null;
      continue;
    }
    if (!quote && (ch === "'" || ch === '"')) {
      quote = ch;
      continue;
    }
    if (ch === "\\" && quote !== "'") {
      const next = input[++index];
      if (!next) return null;
      if (quote === '"' && !/[$`"\\]/.test(next)) value += "\\";
      value += next;
      continue;
    }
    if (quote !== "'" && /[$`]/.test(ch)) return null;
    if (!quote && /[;&|()<>{}*?~\[\]]/.test(ch)) return null;
    value += ch;
  }
  return index > 0 && !quote ? { value, end: index } : null;
}

export function isPythonDisplayFilter(stage: string): boolean {
  const match = /^(?:python|python3)\s+-c\s+(['"][\s\S]*)$/.exec(stage);
  if (!match) return false;
  const script = literalArgument(match[1]!);
  return !!script && !match[1]!.slice(script.end).trim();
}

export function unwrapCurlFunction(command: string): string | null {
  if (!/^\s*(?:function\s+)?[A-Za-z_]\w*\s*\(/.test(command)) return command;
  if (/[\r\n]/.test(command)) return null;
  const match = /^\s*([A-Za-z_]\w*)\s*\(\s*\)\s*\{\s*(curl\s+.+);\s*\}\s*;\s*([A-Za-z_]\w*)\s+(.+)$/.exec(command);
  if (!match || match[1] !== match[3]) return null;
  if (/^(curl|python3?|jq|grep|rg|sed|sort|uniq|head|tail|cut|tr|wc|column)$/.test(match[1]!)) return null;
  const argument = literalArgument(match[4]!);
  if (!argument) return null;
  const tail = match[4]!.slice(argument.end).trim();
  if (tail && !tail.startsWith("|")) return null;
  // Only a standalone quoted first parameter may be substituted.
  const body = match[2]!;
  const withoutParameter = body.replace(/(^|\s)"\$1"(?=\s|$)/g, "$1''");
  if (/\$(?:[0-9@*#?]|\{)/.test(withoutParameter)) return null;
  let quote: string | null = null;
  for (let index = 0; index < withoutParameter.length; index++) {
    const ch = withoutParameter[index]!;
    if (ch === "\\" && quote !== "'") {
      index++;
      continue;
    }
    if (ch === quote) {
      quote = null;
      continue;
    }
    if (!quote && (ch === "'" || ch === '"')) {
      quote = ch;
      continue;
    }
    if (quote !== "'" && (ch === "`" || (ch === "$" && withoutParameter[index + 1] === "("))) return null;
    if (!quote && /[;&|()<>]/.test(ch)) return null;
  }
  if (quote) return null;
  const quoted = "'" + argument.value.replaceAll("'", "'\\''") + "'";
  return body.replace(/(^|\s)"\$1"(?=\s|$)/g, (_match, space: string) => space + quoted) + (tail ? " " + tail : "");
}
