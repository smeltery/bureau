// Unix-domain admin socket. Bound at ~/.bureau/admin.sock by default. It mints
// a short-lived owner sign-in URL for account recovery.
//
// Agents, terminal panels and apps normally run as the Bureau OS user, so this
// socket must not trust "same uid" filesystem access. It checks the connecting
// peer and answers only root or BUREAU_RECOVERY_UID, never the server's own uid.

import { chmodSync, existsSync, statSync, unlinkSync } from "fs";
import { ADMIN_SOCKET_FILE } from "../persistence/paths.ts";
import { buildPublicOrigin, mintInvite } from "./auth.ts";
import { getUserByName, hasOwner } from "../users.ts";
import { httpResponse, parseHttpRequest, readPeerCredentials, socketFileDescriptor, type ParsedRequest } from "./unix-socket-server.ts";

// 15 minutes: shell access + immediate hand-off to a browser. Tight enough
// that a forgotten URL on a shared screen expires quickly, loose enough to
// cover device-switching friction.
const OWNER_LOGIN_TTL_MS = 15 * 60 * 1000;
const MAX_REQUEST_BYTES = 64 * 1024;

export interface AdminSocketOptions {
  socketPath?: string;
  serverUid?: number;
  recoveryUidSetting?: string;
  readPeerUid?: (fd: number) => number | null;
}

interface ConnectionData {
  peerUid: number | null;
  buffer: Buffer;
  handled: boolean;
}

export function resolveAllowedPeerUids(serverUid: number, recoveryUidSetting: string | undefined): Set<number> {
  const allowed = new Set<number>([0]);
  const setting = recoveryUidSetting?.trim();
  if (setting) {
    const uid = /^\d+$/.test(setting) ? Number(setting) : NaN;
    if (!Number.isSafeInteger(uid)) {
      console.error(`[admin-socket] BUREAU_RECOVERY_UID=${JSON.stringify(setting)} is not a uid; the setting is ignored.`);
    } else if (uid === serverUid) {
      console.error(`[admin-socket] BUREAU_RECOVERY_UID=${uid} is the server's own uid, which every agent shares; the setting is ignored.`);
    } else {
      allowed.add(uid);
    }
  }
  if (allowed.delete(serverUid)) {
    console.error("[admin-socket] the server runs as root, which every agent shares, so the admin socket refuses root.");
  }
  return allowed;
}

export function startAdminSocket(options: AdminSocketOptions = {}): { stop(): void } | null {
  const socketPath = options.socketPath ?? ADMIN_SOCKET_FILE;
  const allowed = resolveAllowedPeerUids(options.serverUid ?? process.getuid?.() ?? -1, "recoveryUidSetting" in options ? options.recoveryUidSetting : process.env.BUREAU_RECOVERY_UID);
  const readPeerUid = options.readPeerUid ?? ((fd) => readPeerCredentials(fd)?.uid ?? null);
  // Refuse to start if the path is occupied by something other than a stale
  // Unix socket. A regular file there means the operator (or a misconfigured
  // deployment) put something else at the path — touching it could destroy
  // data.
  if (existsSync(socketPath)) {
    let isSocket = false;
    try {
      isSocket = statSync(socketPath).isSocket();
    } catch (err) {
      console.error(`[admin-socket] could not stat ${socketPath}: ${(err as Error).message}; admin socket will be unavailable`);
      return null;
    }
    if (!isSocket) {
      console.error(`[admin-socket] ${socketPath} exists and is not a socket; refusing to overwrite. Move it aside and restart bureau to re-enable the admin socket.`);
      return null;
    }
    try {
      unlinkSync(socketPath);
    } catch (err) {
      console.error(`[admin-socket] could not remove stale socket ${socketPath}: ${(err as Error).message}; admin socket will be unavailable`);
      return null;
    }
  }
  const prevUmask = process.umask(0o077);
  let server: ReturnType<typeof Bun.listen<ConnectionData>>;
  try {
    server = Bun.listen<ConnectionData>({
      unix: socketPath,
      data: { peerUid: null, buffer: Buffer.alloc(0), handled: false },
      socket: {
        open: (socket) => {
          const fd = socketFileDescriptor(socket);
          socket.data = { peerUid: fd === null ? null : readPeerUid(fd), buffer: Buffer.alloc(0), handled: false };
        },
        data: (socket, chunk) => {
          if (socket.data.handled) return;
          socket.data.buffer = Buffer.concat([socket.data.buffer, Buffer.from(chunk)]);
          let request: ParsedRequest | null;
          try {
            if (socket.data.buffer.length > MAX_REQUEST_BYTES) throw new Error("request too large");
            request = parseHttpRequest(socket.data.buffer, MAX_REQUEST_BYTES);
          } catch {
            socket.data.handled = true;
            socket.end(jsonBytes(400, { ok: false, error: "bad request" }));
            return;
          }
          if (!request) return;
          socket.data.handled = true;
          const peerUid = socket.data.peerUid;
          if (peerUid === null || !allowed.has(peerUid)) {
            console.error(`[admin-socket] refused a connection from uid ${peerUid ?? "unknown"}`);
            socket.end(jsonBytes(403, { ok: false, error: refusal(allowed) }));
            return;
          }
          void handleParsed(request)
            .then(toHttpAsync)
            .then(
              (bytes) => socket.end(bytes),
              () => socket.end(jsonBytes(500, { ok: false, error: "internal error" })),
            );
        },
      },
    });
  } catch (err) {
    console.error(`[admin-socket] failed to bind ${socketPath}: ${(err as Error).message}; admin socket will be unavailable`);
    return null;
  } finally {
    process.umask(prevUmask);
  }
  const mode = [...allowed].some((uid) => uid !== 0) ? 0o666 : 0o600;
  try {
    chmodSync(socketPath, mode);
  } catch (err) {
    console.error(`[admin-socket] chmod ${mode.toString(8)} ${socketPath} failed: ${(err as Error).message}`);
  }
  return {
    stop: () => {
      server.stop(true);
      try {
        unlinkSync(socketPath);
      } catch {}
    },
  };
}

function refusal(allowed: Set<number>): string {
  if (allowed.size === 0) return "Refused: this socket answers no caller while the server runs as root.";
  const names = [...allowed].map((uid) => (uid === 0 ? "root" : `uid ${uid}`));
  return `Refused: this socket answers only ${names.join(" and ")}.`;
}

function handleParsed(request: ParsedRequest): Promise<Response> {
  const hasBody = request.method !== "GET" && request.body.length > 0;
  return handleAdmin(new Request(request.url, { method: request.method, headers: request.headers, body: hasBody ? request.body.toString("utf8") : undefined }));
}

function jsonBytes(status: number, body: unknown): Buffer {
  return httpResponse(status, JSON.stringify(body), "application/json");
}

async function toHttpAsync(response: Response): Promise<Buffer> {
  return httpResponse(response.status, Buffer.from(await response.arrayBuffer()), response.headers.get("content-type") ?? "application/json");
}

async function handleAdmin(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (req.method !== "POST" || url.pathname !== "/admin/owner-login") {
    return jsonResponse(404, { ok: false, error: "not found" });
  }
  let payload: { name?: unknown };
  try {
    payload = (await req.json()) as { name?: unknown };
  } catch {
    return jsonResponse(400, { ok: false, error: "invalid JSON body" });
  }
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  if (!name) {
    return jsonResponse(400, { ok: false, error: "--name is required" });
  }
  // Refuse pre-claim. The tokenless form is the right path before an owner
  // exists; pretending to "recover" an account that doesn't exist would be
  // confusing.
  if (!hasOwner()) {
    const port = process.env.PORT || "4000";
    return jsonResponse(400, {
      ok: false,
      error: `No owner exists yet. Claim the office first by opening http://localhost:${port}/ on this machine (or via ssh -L from another). Once an owner is set, this command can mint a login URL.`,
    });
  }
  const user = getUserByName(name);
  if (!user) {
    return jsonResponse(404, { ok: false, error: `No user named "${name}" in this office.` });
  }
  if (user.role !== "owner") {
    return jsonResponse(400, {
      ok: false,
      error: `User "${name}" is a member, not an owner. The owner-login CLI is for owner recovery; have an owner mint a normal invite from the Access pane.`,
    });
  }
  const minted = await mintInvite({
    username: name,
    role: "owner",
    createdBy: "(admin-cli)",
    allowExisting: true,
    // Replace any prior unconsumed invite for this user so we don't pile up
    // owner-login URLs in invites.json on repeated CLI runs.
    replacePriorForUsername: true,
    ttlMsOverride: OWNER_LOGIN_TTL_MS,
  });
  if (!minted.ok) {
    return jsonResponse(500, { ok: false, error: minted.error });
  }
  const { origin } = buildPublicOrigin();
  return jsonResponse(200, {
    ok: true,
    url: `${origin}/i/${minted.rawToken}`,
    expiresAt: minted.invite.expiresAt,
    ttlMs: OWNER_LOGIN_TTL_MS,
  });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
