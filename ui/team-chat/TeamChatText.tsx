import { useMemo, type ReactNode } from "react";
import { Lexer, defaults, type Token } from "marked";

function renderInline(tokens: Token[]): ReactNode[] {
  return tokens.map((token, index) => {
    switch (token.type) {
      case "strong":
        if (!token.tokens) return token.raw;
        return <strong key={index}>{renderInline(token.tokens)}</strong>;
      case "em":
        if (!token.tokens) return token.raw;
        return <em key={index}>{renderInline(token.tokens)}</em>;
      case "link": {
        if (!token.tokens) return token.raw;
        let protocol: string;
        try {
          protocol = new URL(token.href).protocol;
        } catch {
          return token.raw;
        }
        if (!["http:", "https:", "mailto:"].includes(protocol)) return token.raw;
        return (
          <a key={index} href={token.href} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>
            {renderInline(token.tokens)}
          </a>
        );
      }
      case "escape":
        return token.text;
      default:
        // Human messages never execute the log renderer's HTML or diagram hooks.
        return token.raw;
    }
  });
}

export function TeamChatText({ content }: { content: string }) {
  const nodes = useMemo(() => renderInline(Lexer.lexInline(content, { ...defaults, gfm: true, breaks: false })), [content]);
  return <>{nodes}</>;
}
