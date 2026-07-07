import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { codexWrapperCommandForShell } from "./native-bin.ts";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("codex wrapper follows the active bureau state root", () => {
  it("keeps the friendly ~/.bureau/bin/codex command at the default root", () => {
    if (process.env.BUREAU_HOME) return;
    expect(codexWrapperCommandForShell()).toBe("~/.bureau/bin/codex");
  });

  it("targets BUREAU_HOME for login cards and wrapper CODEX_HOME", async () => {
    const home = mkdtempSync(join(tmpdir(), "bureau-codex-home-"));
    tmpDirs.push(home);

    const child = Bun.spawn(
      [
        process.execPath,
        "-e",
        `const nativeBin = await import(process.env.__NATIVE_BIN_PATH);
         console.log(JSON.stringify(nativeBin.getCodexLoginCommands()));`,
      ],
      {
        env: {
          ...process.env,
          BUREAU_HOME: home,
          __NATIVE_BIN_PATH: join(import.meta.dir, "native-bin.ts"),
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    const stdout = (await new Response(child.stdout).text()).trim();
    const stderr = (await new Response(child.stderr).text()).trim();
    const exitCode = await child.exited;
    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });

    const commands = JSON.parse(stdout.split("\n").pop()!) as string[];
    const wrapperPath = join(home, "bin", "codex");
    const quotedWrapperPath = `'${wrapperPath}'`;
    expect(commands).toEqual([`${quotedWrapperPath} login`, `${quotedWrapperPath} login --device-auth`]);

    const wrapper = readFileSync(wrapperPath, "utf8");
    expect(wrapper).toContain(join(home, "codex-home"));
    expect(wrapper).not.toContain("$HOME/.bureau/codex-home");
    expect(wrapper).toContain('[ -n "${CODEX_HOME}" ]');
  });
});
