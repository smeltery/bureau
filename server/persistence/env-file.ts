import { readFileSync, existsSync } from "fs";

// Minimal dotenv parser. Supports KEY=VALUE, comments (#), export prefix,
// single/double-quoted values (\n escape inside double quotes). Blank lines ignored.
// Throws with "line N" context if a non-blank line can't be parsed.
export function parseDotenv(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const raw = line;
    // Strip BOM from the first line
    if (i === 0 && line.charCodeAt(0) === 0xfeff) line = line.slice(1);
    const stripped = line.trim();
    if (!stripped || stripped.startsWith("#")) continue;
    let working = stripped.startsWith("export ") ? stripped.slice(7).trimStart() : stripped;
    const eqIdx = working.indexOf("=");
    if (eqIdx <= 0) {
      throw new Error(`parse error at line ${i + 1}: ${JSON.stringify(raw)}`);
    }
    const key = working.slice(0, eqIdx).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`parse error at line ${i + 1}: invalid key ${JSON.stringify(key)}`);
    }
    let value = working.slice(eqIdx + 1).trim();
    if (value.length >= 2 && value[0] === '"' && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    } else if (value.length >= 2 && value[0] === "'" && value.endsWith("'")) {
      value = value.slice(1, -1);
    } else if (value[0] === '"' || value[0] === "'") {
      throw new Error(`parse error at line ${i + 1}: unterminated quoted value`);
    } else {
      // Strip inline comment (only if preceded by whitespace)
      const hashMatch = value.match(/\s+#/);
      if (hashMatch && hashMatch.index !== undefined) value = value.slice(0, hashMatch.index);
      value = value.trim();
    }
    result[key] = value;
  }
  return result;
}

// Read and parse an env file. Returns the key/value map on success,
// throws a descriptive error on failure (missing, unreadable, parse error).
export function readEnvFile(path: string): Record<string, string> {
  if (!path.startsWith("/")) {
    throw new Error("env file path must be absolute");
  }
  if (!existsSync(path)) {
    throw new Error(`file not found: ${path}`);
  }
  let content: string;
  try {
    content = readFileSync(path, "utf-8");
  } catch (err: any) {
    throw new Error(`unreadable: ${err.message || String(err)}`);
  }
  return parseDotenv(content);
}
