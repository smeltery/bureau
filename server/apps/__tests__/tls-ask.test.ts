import { describe, expect, test } from "bun:test";
import { decideTlsAsk, handleTlsAsk, TLS_ASK_PATH, tlsAskResponse, type TlsAskDeps } from "../tls-ask.ts";
import type { CertAdmission } from "../registry.ts";

function deps(overrides: Partial<TlsAskDeps> = {}): TlsAskDeps & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    domain: "office.example",
    admit: (label) => {
      asked.push(label);
      return "admitted";
    },
    ...overrides,
  };
}

function ask(query: string, d: TlsAskDeps): Response {
  return handleTlsAsk(new URL(`http://localhost:4000${TLS_ASK_PATH}${query}`), d);
}

describe("decideTlsAsk", () => {
  test("a live app's label is admitted, and an already-admitted one is free forever", () => {
    for (const verdict of ["admitted", "already"] as CertAdmission[]) {
      expect(decideTlsAsk("hello.office.example", deps({ admit: () => verdict }))).toBe("allow");
    }
  });

  test("the office's own host passes without touching the registry", () => {
    const d = deps();
    expect(decideTlsAsk("office.example", d)).toBe("allow");
    expect(d.asked).toEqual([]);
  });

  test("an office with no app-host domain refuses everything", () => {
    expect(decideTlsAsk("hello.office.example", deps({ domain: null }))).toBe("deny");
  });

  test("a name outside the domain, or deeper than one label, spends no budget", () => {
    const d = deps();
    expect(decideTlsAsk("hello.evil.test", d)).toBe("deny");
    expect(decideTlsAsk("a.b.office.example", d)).toBe("deny");
    expect(decideTlsAsk("[::1]", d)).toBe("deny");
    expect(decideTlsAsk("héllo.office.example", d)).toBe("deny");
    // A stranger pointing names at this box cannot cause a write.
    expect(d.asked).toEqual([]);
  });

  test("a label with no live app is denied; over the cap is reported apart", () => {
    expect(decideTlsAsk("gone.office.example", deps({ admit: () => "not_live" }))).toBe("deny");
    expect(decideTlsAsk("hello.office.example", deps({ admit: () => "capped" }))).toBe("capped");
  });

  test("normalization is shared with routing: a name is asked about by its label", () => {
    const d = deps();
    decideTlsAsk("HELLO.Office.Example.", d);
    expect(d.asked).toEqual(["hello"]);
  });
});

describe("tlsAskResponse", () => {
  test("allow is a 2xx, and both refusals are distinguishable to an operator", async () => {
    const allow = tlsAskResponse("allow");
    expect(allow.status).toBe(200);
    expect(await allow.text()).toBe("ok\n");
    expect(tlsAskResponse("capped").status).toBe(429);
    expect(tlsAskResponse("deny").status).toBe(403);
  });

  test("never cached: a cached ok would outlive the app it vouched for", () => {
    expect(tlsAskResponse("allow").headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("handleTlsAsk", () => {
  test("exactly one non-empty domain parameter is answered", () => {
    expect(ask("?domain=hello.office.example", deps()).status).toBe(200);
  });

  test("zero, empty or repeated subjects are refused rather than guessed", () => {
    const d = deps();
    expect(ask("", d).status).toBe(403);
    expect(ask("?domain=", d).status).toBe(403);
    // Answering the first of two names is how a gate vouches for the other one.
    expect(ask("?domain=hello.office.example&domain=evil.test", d).status).toBe(403);
    expect(d.asked).toEqual([]);
  });

  test("unrelated parameters are ignored: the terminator may add its own", () => {
    expect(ask("?domain=hello.office.example&reason=cold-load", deps()).status).toBe(200);
  });

  test("a registry that cannot answer refuses, including for established labels", () => {
    const res = ask(
      "?domain=hello.office.example",
      deps({
        admit: () => {
          throw new Error("apps.json unreadable");
        },
      }),
    );

    expect(res.status).toBe(403);
  });

  test("the endpoint lives under the namespace an app can never claim", () => {
    expect(TLS_ASK_PATH).toBe("/__bureau/tls-ask");
  });
});
