// The pure decisions in front of the handshake: WHO may reach an app, WHICH
// requests may start the sign-in round trip, and WHERE a browser may be sent
// back to afterwards. No I/O, no tables, no clock — every answer here is a
// function of its arguments, which is why this is the file the tests pin
// case-by-case.
//
// Consumed by server/apps/host/auth.ts and, through it, by
// server/apps/host/dispatch.ts.

import type { AppRecord } from "../../../shared/apps.ts";
import type { UserRole } from "../../../shared/types.ts";
import { MAX_RETURN_PATH_LENGTH } from "./auth-cookie.ts";

// --- who may reach an app ---------------------------------------------------

// The office identity a permit decision is made against: the user the OFFICE
// session resolves to, never anything the app host said about itself. `null`
// means there is no live office session, which is the same as "not signed in".
export interface AppViewer {
  userId: string;
  role: UserRole;
}

// An app hostname is reachable by the app's OWNER and by office owners, and by
// nobody else. The decision table, in the order the code below asks it:
//
//   no live office session          -> NO   (there is no identity to permit)
//   role === "owner"                -> YES  (office owners reach every app)
//   app.userId === viewer.userId    -> YES  (the app's own owner)
//   app.userId is some other user   -> NO
//   app.userId === null             -> NO for a member; YES only via the owner
//                                     arm above. An unowned app is one
//                                     registered from a loopback shell, so it
//                                     belongs to the box rather than to a
//                                     member.
//
// This is the same rule the /api/apps routes apply when deciding which apps a
// caller may SEE (`visibleApps`: office owners and the box owner see all,
// everyone else sees the apps their user owns). Keeping the two identical is the
// point — an app a user cannot see in the Apps tab must not be one they can open
// by typing its hostname, and a hostname is guessable in a way an API listing is
// not.
//
// A refusal here is reported as ABSENCE (the neutral 404), never as "forbidden":
// that another user has an app called `hello` is not this caller's business.
//
// Re-asked on EVERY request rather than only at sign-in, because the answer can
// change under a live app session: an office owner who is demoted to member
// loses every app that was not theirs, at once, without waiting for a cookie to
// expire.
export function mayReachApp(app: Pick<AppRecord, "userId">, viewer: AppViewer | null): boolean {
  if (viewer === null) return false;
  if (viewer.role === "owner") return true;
  return app.userId !== null && app.userId === viewer.userId;
}

// --- where a browser may be sent back to ------------------------------------

// `r` is a path on the app host and nothing else. The rules exist so that a
// crafted value cannot turn the handshake into an open redirect, and so that the
// value can be put in a `Location` header without any further escaping:
//
//   - one leading `/`, never two: `//evil.example` is a protocol-relative URL
//     and a browser would leave the app host entirely.
//   - no backslash anywhere: some browsers have historically read `/\evil` and
//     `\\evil` as authority forms.
//   - printable ASCII only, so CR and LF cannot split the response header and no
//     percent-decoding surprise reaches the wire. Browsers percent-encode
//     everything else already.
//   - no `#`: a real fragment never reaches a server, so one arriving here was
//     hand-written.
//
// Returns the path unchanged, or null for "refuse". Absent means `/`. An invalid
// value is REFUSED rather than quietly rewritten to `/`: our own bounce always
// builds a valid one, so an invalid one is either hand-crafted or a bug on our
// side, and a silent rewrite would hide both.
export function validateReturnPath(raw: string | null): string | null {
  if (raw === null) return "/";
  if (raw.length === 0 || raw.length > MAX_RETURN_PATH_LENGTH) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    // 0x20 (space) is excluded along with the controls: a space in a Location
    // header is not something to pass along.
    if (code <= 0x20 || code >= 0x7f) return null;
  }
  if (raw.includes("\\") || raw.includes("#")) return null;
  return raw;
}

// --- which requests may start the handshake ---------------------------------

// Only a request that could actually FINISH the handshake is sent into it, and
// the first half of that is about correctness rather than security:
//
//   - a 302 on a POST loses the method and the body, so an unauthenticated form
//     submission would arrive at the app as a GET with nothing in it;
//   - a subresource or an XHR cannot complete a handshake that ends in a cookie
//     plus a navigation. It would fail as an opaque CORS error instead of showing
//     the user a sign-in;
//   - HEAD is out too: it could start the flow but the callback is GET-only, so a
//     client that preserved the method across the redirect would land on a 404
//     halfway through. Better to refuse at the first hop than to strand it at the
//     second.
//
// GET, then, and one of two positive signals:
//
//   1. `Sec-Fetch-Mode: navigate` AND `Sec-Fetch-Dest: document`, compared
//      exactly. These are browser-attested — page JavaScript cannot set them —
//      so when they are present they are evidence. Present but not that exact
//      pair (a `cors` fetch, a `script` destination, one header without the
//      other) is a request that is provably NOT a navigation, or ambiguous either
//      way: refused.
//
//   2. No Sec-Fetch metadata at all. Deliberate, and NOT because such a client is
//      safe — a browser old enough to omit Fetch Metadata can still be made to
//      issue a cross-site request and can still carry cookies. Its absence is
//      precisely why the server cannot tell that request's context apart from a
//      navigation's. Refusing it buys nothing here: the worst it enables is the
//      cross-site mint already accepted as a design consequence of
//      GET /auth/app (the code is unreadable to the attacker and the cookie it
//      yields is bound to the victim's own session, for an app that user may
//      already open), while refusing would mean a client that never sends the
//      headers cannot sign in to an app AT ALL. Strictness where evidence exists;
//      permissiveness only where evidence cannot.
export function mayInitiateHandshake(req: Request): boolean {
  if (req.method !== "GET") return false;
  const mode = req.headers.get("sec-fetch-mode");
  const dest = req.headers.get("sec-fetch-dest");
  const site = req.headers.get("sec-fetch-site");
  const user = req.headers.get("sec-fetch-user");
  // Any Sec-Fetch header at all means this client speaks Fetch Metadata, so the
  // exact pair is required. All four are checked rather than the two we read: a
  // request carrying only `Sec-Fetch-Site` is a client whose silence about mode
  // and dest is meaningful.
  if (mode === null && dest === null && site === null && user === null) {
    return true;
  }
  return mode === "navigate" && dest === "document";
}
