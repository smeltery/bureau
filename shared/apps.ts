// Agent-built apps: the shared types for the app registry and its wire contract.
//
// An app is a web app an agent built and handed to bureau to run. Like a
// cronjob it is a thing bureau runs that is NOT an agent; unlike a cronjob it
// outlives the agent that made it, because it belongs to the USER. See
// docs/features/agent-apps.md.
//
// There is no separate id: the NAME is the key. A name is bound to one app for
// that app's whole life and there is no verb that changes it, so a second
// identifier would be dead weight and one more thing to disagree with itself.
// Everything derived from a name (the data directory, and the unit name once a
// supervisor exists) therefore has a stable value for as long as the app lives.
// Deleting an app frees the name for the next one.
export interface AppRecord {
  // Hostname label, unique across LIVE apps. Lowercase [a-z0-9-], never
  // starting or ending with a hyphen, at most 63 chars (one DNS label), so it
  // can become a hostname later without changing.
  name: string;
  // The app's hostname label, and which generation of the name it is. `hostGen`
  // 1 means the name had never been used, and `hostLabel` is the name itself;
  // generation N > 1 appends `-g<N>`, so the second app ever called `hello`
  // lives at `hello-g2`.
  //
  // The name is what a human types; the LABEL is what a browser keys security
  // state to. A deleted app frees its name, and a browser that once talked to
  // the old app can still be holding its service worker, caches and storage for
  // that origin - so the successor must never land on it. The registry keeps
  // every label it has ever issued and hands the next one out from there.
  hostLabel: string;
  hostGen: number;
  // Allocated by bureau at registration and fixed for the app's whole life:
  // moving a live app's port would break every bookmark pointing at it. A
  // deleted app's port returns to the pool.
  port: number;
  // Start command and working directory, stored verbatim / resolved. Whether
  // the command actually runs is the supervisor's problem, not the registry's.
  command: string;
  cwd: string; // absolute, verified to exist at registration
  description?: string;
  // Absolute path bureau created and handed over, so app state lands somewhere
  // known (and inside the backup set) instead of wherever the agent felt like
  // writing. Derived from the name, and always empty at registration: deleting
  // an app keeps its data by setting the directory aside, so a later app of the
  // same name never inherits it.
  dataDir: string;
  // OWNER: the user the app belongs to - for an agent caller, its manager. The
  // app survives the agent, so ownership can never be the agent.
  userId: string | null;
  username: string | null; // display snapshot of the owner (can go stale)
  // Attribution only: who registered it. createdByAgentId is also the default
  // message target once apps can message their agent.
  createdBy: string;
  createdByAgentId?: string;
  createdAt: number;
}

// What an app is doing. The registry persists NO state field: a stored
// "running" is a lie the moment the box reboots, so state is DERIVED at read
// time, by asking systemd.
//
// `unknown` is not a synonym for `stopped`, and the difference is the point of
// having it: `stopped` means systemd is holding the app still on purpose, while
// `unknown` means there is no unit at all, or systemd could not be asked. One
// of those is a state somebody chose and the other is a fault.
export type AppState = "running" | "starting" | "stopped" | "failed" | "unknown";

// An app as it goes over the wire: the record plus what only the supervisor
// knows.
export interface AppWire extends AppRecord {
  state: AppState;
  // AUTOMATIC restarts since the app was last activated (systemd's NRestarts).
  // A number climbing on its own is the signal that an app is crash-looping
  // rather than serving. It resets when the app is stopped and started again,
  // which is the honest scope rather than a lifetime total: an explicit restart
  // is a new activation, and counting across one would report a fixed app as
  // still broken.
  restartCount: number;
  // Why the last install or start attempt failed, when one did. Absent means
  // no attempt has failed since bureau started.
  //
  // It exists because registering an app answers 201 even when the app does not
  // come up - the registration really did happen, and a 500 would invite a
  // retry that can only ever be told the name is taken. That leaves `state` as
  // the only signal, and `state` cannot say WHY. An agent has no access to the
  // server log, and a failure to install the unit at all happens before there
  // is anything in journald to read, so without this the reason is invisible
  // to the API's main consumer.
  //
  // In memory only, so it does not survive a bureau restart. That is the
  // honest scope: it describes an attempt this process made, and after a
  // restart `state` still tells the truth while the next attempt regenerates
  // the reason.
  startError?: string;
  // Where the app answers on the public internet, when the office has app
  // hostnames at all. Derived from the office's public origin and the app's
  // issued LABEL (never its name, which is reusable), and never stored -
  // present exactly when a URL exists, absent otherwise, the same rule the
  // app's own BUREAU_APP_URL follows.
  url?: string;
}

// --- wire shapes ------------------------------------------------------------
// The wire contract for the app registry (docs/features/agent-apps.md).
// Defined here rather than in server/apps/registry.ts so the route table, the
// registry, and the handler cannot drift.

// GET /api/apps/:name/logs. Newest last, exactly as journald renders them - the
// caller is a human reading a tail or an agent debugging its own app, and
// re-structuring log lines into fields would only lose what journald already
// formatted.
export interface AppLogsRes {
  name: string;
  lines: string[];
}

// POST /api/apps. The port is NOT here and never will be: allocating it is the
// point of the registry. cwd may use `~/`; the response carries it resolved.
export interface AppRegisterReq {
  name: string;
  command: string;
  cwd: string;
  description?: string;
}

// POST /api/app/message - the app-SELF surface, and the only route an app token
// reaches. There is no recipient field and no app field: the token says which app
// is speaking, and the registry says which agent built it. Both are things a
// caller could otherwise lie about, so neither is a parameter.
export interface AppMessageReq {
  text: string;
}

// PATCH /api/apps/:name. Any subset of the three mutable fields; an absent key
// is a field left alone. `name` and `port` are deliberately NOT here: they are
// the app's address, so a typo in either is fixed by deleting and registering
// again rather than quietly rewritten under whoever already bookmarked it.
//
// The verb exists for the opposite case. A mistyped COMMAND used to be curable
// only by deleting the app, which costs it its data directory and its port - a
// steep price for a missing `run`.
//
// `description` is three-way on purpose: absent leaves it alone, a string sets
// it, and `null` removes it. An empty string is NOT the same as absence - it
// persists as a present, empty value and reads back that way - so without null
// there would be no way to undo a description at all.
export interface AppUpdateReq {
  command?: string;
  cwd?: string;
  description?: string | null;
}

// The `error.code` values the app routes answer with, as a closed union so the
// registry (which raises them) and the handler (which maps them to statuses)
// cannot drift.
export type AppErrorCode =
  | "invalid_name"
  | "reserved_name"
  | "invalid_command"
  | "invalid_cwd"
  | "invalid_description"
  | "name_taken"
  // The requested name is an ORIGIN some other app already held. Not
  // `name_taken`: no live app has the name, and no app ever will - the label
  // ledger keeps a retired origin spoken for forever, so the address cannot be
  // handed to unrelated code. Permanent, which is why it is not `name_taken`'s
  // "come back after a delete".
  | "origin_retired"
  // The name has been recycled so many times that the next generation label
  // would no longer fit in a DNS label. Register under a different name.
  | "no_label_available"
  | "app_limit_reached"
  | "no_port_available"
  // The three server-side failures. Where one of these is the error CODE, the
  // request genuinely failed - none of them is ever dressed up as a success.
  | "registry_corrupt"
  | "persist_failed"
  // The machine refused: systemd could not install, load or control the app's
  // unit. Distinct from the registry failures because the registry is fine -
  // the record exists and the name is spoken for - and the caller's next move
  // is different.
  //
  // One deliberate asymmetry: this code is NOT used when registration commits
  // and the supervisor then fails. That answers 201, because the app really was
  // created, and the same diagnosis rides on the success body as `startError`.
  // The code is for the control routes and delete, where nothing was created
  // and a failure is simply a failure.
  | "supervisor_failed";
