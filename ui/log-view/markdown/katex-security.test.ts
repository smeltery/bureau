import { expect, test } from "bun:test";

test("math renderers ignore inherited trust options", () => {
  // Isolate prototype pollution from the test runner and other renderers.
  const result = Bun.spawnSync(
    [
      process.execPath,
      "--eval",
      `
      import { createRequire } from "node:module";
      import { expect } from "bun:test";
      const require = createRequire(process.cwd() + "/package.json");
      const diagramRequire = createRequire(require.resolve("mermaid/package.json"));
      for (const renderer of [require("katex"), diagramRequire("katex")]) {
        const ordinary = renderer.renderToString(String.raw\`\\frac{1}{2}\`);
        expect(ordinary).toContain("katex");
        Object.prototype.trust = true;
        try {
          const output = renderer.renderToString(String.raw\`\\href{javascript:alert(1)}{click}\`, {throwOnError:false});
          expect(output).not.toContain('href="javascript:');
        } finally {
          delete Object.prototype.trust;
        }
      }
    `,
    ],
    { stdout: "pipe", stderr: "pipe", timeout: 10000 },
  );
  expect(result.exitCode, result.stderr.toString()).toBe(0);
});
