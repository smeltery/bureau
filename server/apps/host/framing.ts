import { buildPublicOrigin } from "../../auth/auth.ts";

export function allowOfficeFrame(headers: Headers): void {
  headers.delete("X-Frame-Options");
  const policies = (headers.get("Content-Security-Policy") ?? "").split(",");
  headers.set(
    "Content-Security-Policy",
    policies
      .map((policy) => {
        const directives = policy
          .split(";")
          .map((value) => value.trim())
          .filter((value) => value && !/^frame-ancestors(?:\s|$)/i.test(value));
        directives.push(`frame-ancestors ${buildPublicOrigin().origin}`);
        return directives.join("; ");
      })
      .join(", "),
  );
}

export function appFrameNeedsSession(): Response {
  const officeOrigin = buildPublicOrigin().origin;
  const headers = new Headers({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  allowOfficeFrame(headers);
  return new Response(
    `<p>App sign-in required. Use Reconnect app in the office page.</p><script>parent.postMessage("bureau:app-session-required",${JSON.stringify(officeOrigin).replaceAll("<", "\\u003c")});</script>`,
    { status: 401, headers },
  );
}
