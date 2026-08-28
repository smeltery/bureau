import { describe, expect, test } from "bun:test";
import { checkProcessNetworkSafety } from "../process-network.ts";

function reason(command: string): string | null {
  return checkProcessNetworkSafety(command)?.reason ?? null;
}

describe("checkProcessNetworkSafety — outbound tunnels", () => {
  test.each([
    "cloudflared tunnel --url http://localhost:4000",
    "npx --yes ngrok http 4000",
    "bunx ngrok tcp 22",
    "ssh -R 80:localhost:4000 host.example",
    "ssh -N -D 1080 host.example",
    "tailscale funnel 4000",
    "bash -lc 'ngrok http 4000'",
  ])("blocks %s", (command) => {
    expect(reason(command)).toContain("tunnel");
  });

  test("does not block plain ssh without port forwarding", () => {
    expect(reason("ssh host.example uptime")).toBeNull();
  });
});

describe("checkProcessNetworkSafety — name-based process targets", () => {
  test.each(["pkill -f server/index.ts", "killall node", "pgrep -f bureau", "bash -c 'pkill bun'"])("blocks %s", (command) => {
    expect(reason(command)).toContain("process");
  });

  test.each(["kill 1234", "pkill -P 1234"])("allows PID-scoped %s", (command) => {
    expect(reason(command)).toBeNull();
  });

  test("does not treat quoted prose as a command", () => {
    expect(reason('echo "pkill -f bun"')).toBeNull();
  });
});
