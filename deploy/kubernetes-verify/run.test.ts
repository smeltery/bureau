import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = new URL("./run.sh", import.meta.url).pathname;

function run(mode: string, command = "up") {
  const directory = mkdtempSync(join(tmpdir(), "bureau-kube-cleanup-"));
  const bin = join(directory, "bin");
  const work = join(directory, "work");
  mkdirSync(bin);
  mkdirSync(work);
  writeFileSync(join(work, "ca.pem"), "fixture");
  writeFileSync(join(work, "setup-key"), "fixture");
  const log = join(directory, "calls");
  writeFileSync(log, "");
  const stub = (name: string, body: string) => {
    const path = join(bin, name);
    writeFileSync(path, `#!/usr/bin/env bash\nprintf '%s\\n' "${name} $*" >> "$CALL_LOG"\n${body}\n`);
    chmodSync(path, 0o755);
  };
  stub("k3d", `case "$1 $2" in
    'cluster list')
      [[ $TEST_MODE != list-fails ]] || exit 31
      [[ $TEST_MODE != exists ]] || echo 'bureau-verify 1/1 0/0 true'
      exit 0 ;;
    'cluster create') touch "$CALL_LOG.created"; [[ $TEST_MODE != create-fails && $TEST_MODE != orphan-network ]] || exit 17 ;;
    'cluster delete') [[ $TEST_MODE != cleanup-fails ]] || exit 9 ;;
  esac
  exit 0`);
  stub("kubectl", `if [[ "$*" == *'rollout status'* ]]; then
    case "$TEST_MODE" in
      rollout-fails|cleanup-fails) exit 23 ;;
      interrupted) kill -TERM "$PPID" ;;
    esac
  fi
  exit 0`);
  stub("docker", `if [[ "$1 $2" == 'network inspect' ]]; then
    [[ $TEST_MODE == existing-network || ( $TEST_MODE == orphan-network && -f $CALL_LOG.created ) ]]
    exit $?
  fi
  exit 0`);
  stub("openssl", "echo 'Unexpected certificate generation' >&2; exit 99");
  stub("git", `destination="\${!#}/deploy/kubernetes-latest"
  mkdir -p "$destination"
  printf '#!/bin/sh\\nexit 0\\n' > "$destination/deploy.sh"
  chmod +x "$destination/deploy.sh"`);
  try {
    const result = spawnSync("bash", [script, command], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CALL_LOG: log, TEST_MODE: mode, BUREAU_VERIFY_DIR: work },
      encoding: "utf8", timeout: 10_000,
    });
    if (result.error) throw result.error;
    return { status: result.status, stderr: result.stderr, calls: readFileSync(log, "utf8").trim().split("\n") };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test.each([["orphan-network", 17], ["create-fails", 17], ["rollout-fails", 23], ["interrupted", 143], ["cleanup-fails", 23]] as const)("failed setup cleans its cluster and preserves status: %s", (mode, status) => {
  const result = run(mode);
  expect(result.status).toBe(status);
  expect(result.calls.filter((call) => call === "k3d cluster delete bureau-verify")).toHaveLength(1);
  if (mode === "orphan-network") expect(result.calls).toContain("docker network rm k3d-bureau-verify");
  if (mode === "cleanup-fails") expect(result.stderr).toContain("run '");
});

test.each([["exists", 1], ["list-fails", 31]] as const)("does not create or delete a cluster without a clear preflight: %s", (mode, status) => {
  const result = run(mode);
  expect(result.status).toBe(status);
  expect(result.calls).toEqual(["k3d cluster list --no-headers"]);
});

test("successful setup retains the cluster until explicit teardown", () => {
  const result = run("success");
  expect(result.status).toBe(0);
  expect(result.calls).not.toContain("k3d cluster delete bureau-verify");
  expect(result.stderr).toContain("is ready");
  expect(run("success", "down").calls).toEqual(["k3d cluster delete bureau-verify"]);
});


test("a pre-existing verification network is left untouched", () => {
  const result = run("existing-network");
  expect(result.status).toBe(1);
  expect(result.calls).toEqual(["k3d cluster list --no-headers", "docker network inspect k3d-bureau-verify"]);
});
