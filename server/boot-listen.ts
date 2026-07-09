import { hostname as osHostname, userInfo } from "os";

function readArgValue(name: string): string | null {
  const prefix = `${name}=`;
  for (let i = 2; i < Bun.argv.length; i++) {
    const arg = Bun.argv[i];
    if (arg === name) return Bun.argv[i + 1] ?? null;
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return null;
}

export function resolveListenOptions(): { socketPath: string | null; port: number } {
  const socketPath = readArgValue("--socket");
  const portArg = readArgValue("--port");
  const envPort = process.env.PORT;
  const port = parseInt(portArg || process.env.PORT || "4000");

  if (socketPath && (portArg || envPort)) {
    throw new Error("--socket is mutually exclusive with --port/PORT");
  }

  process.env.PORT = String(port);
  return { socketPath, port };
}

export function printStartupBanner(input: { socketPath: string | null; port: number; publicOrigin: string; preClaim: boolean }) {
  const listenTarget = input.socketPath ? `unix:${input.socketPath}` : `http://localhost:${input.port}`;
  console.log(`Bureau running at ${listenTarget}`);
  console.log(`Bureau public origin: ${input.publicOrigin}`);

  if (!input.preClaim) return;

  // Pre-claim banner. The tokenless claim form is bound to 127.0.0.1, so
  // off-box operators have to SSH-tunnel in. Print a template with the
  // detected local user/host so the operator can copy-paste; the values
  // are hints (the operator may SSH as a different user).
  const detectedUser = (() => {
    try {
      return userInfo().username;
    } catch {
      return "user";
    }
  })();
  const detectedHost = (() => {
    try {
      return osHostname();
    } catch {
      return "host";
    }
  })();
  const port = String(input.port);
  console.log(`
================================================================
  Bureau: no owner has been set up for this office yet.

  TO CLAIM OWNERSHIP from THIS machine:
    Open http://localhost:${port} in your browser.

  TO CLAIM OWNERSHIP from another machine:
    1. On that machine, open a tunnel to this box:
         ssh -L ${port}:localhost:${port} <user>@<host>
       (this machine reports ${detectedUser}@${detectedHost}; use whatever you actually SSH as)
    2. Open http://localhost:${port} in that browser.

  After you claim, the Access pane (User Settings) lets you enable
  external access so everyday use doesn't need the SSH tunnel.
================================================================
`);
}
