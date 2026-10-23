# Provider browser and device sign-in

Open **Integrations → Providers** (also available through **Account → Connections**).
Each Claude and Codex card has an **Account scope** selector:

- **Personal** signs in for your agents. If your member environment already sets
  `CLAUDE_CONFIG_DIR` or `CODEX_HOME`, Bureau uses that directory. Otherwise it
  creates a private directory under its state directory and activates it only
  after verifying the saved account with a fresh provider process.
- **Office** manages the shared account. All members can see its status, but only
  an owner can start, cancel or disconnect an office sign-in.

For Claude, click **Sign in with browser**, open the continuation link, then paste
its code into the masked field in Bureau. For Codex, **Sign in with device code**
works from another computer or phone: open the continuation link and enter the
shown code. **Browser sign-in on this host** is also available, but its browser
must reach the callback on the Bureau host's localhost address.

Bureau never asks you to paste provider passwords or tokens into chat. Browser
sign-in links and device codes are shown only to the member who started that
operation. Other members using the same account directory see its holder and
start time. Sign-in expires after ten minutes. Cancel closes the provider process
before releasing its directory; a late completion cannot activate the account.
Unsupported Claude versions retain the terminal login fallback.

## Which account do agents use?

Successful personal sign-in selects the private directory for new desk conversations.
Scheduled runs currently use explicit member directory settings or office defaults.
Explicit member directory
settings take precedence over automatically managed homes. A personal sign-in
cannot target the office directory, another member's managed directory, or an
explicit directory shared by another member. Canonical paths are used so a
symlink alias does not bypass those checks.

Existing Claude and Codex conversations retain the credential directory they
started in, including resume and edit/fork operations. Start a new conversation
to pick up a newly activated personal account. If credentials inside an existing
directory are replaced or removed, conversations using it may need a fresh
sign-in. Configured API keys remain unchanged and provider credential precedence
still applies; the cards indicate when a key is configured alongside a saved
subscription sign-in.

**Disconnect** requires confirmation and verifies that the provider reports no
saved account before deactivating an automatically managed home. New conversations
then use office defaults. An explicitly configured member directory remains
configured; change that variable separately if you want office defaults instead.
If a provider still finds credentials (for example, in a system credential store),
Bureau reports the failure and leaves the selected home active. Use the provider's
terminal logout command in that environment before retrying.

## Operational details

Sign-in, status probes and disconnect coordinate by canonical credential directory.
Duplicate starts from the same member return the existing operation; conflicting
members cannot start another one. Status and startup requests are time-bounded,
and cancellation waits for process teardown. Access revocation, member removal,
or directory changes cancel a pending login. On server exit, Bureau terminates
its account processes. Status probes never activate personal homes.

These management endpoints require browser sessions and reject bearer tokens.
Provider authentication remains in the provider's native credential files or
credential store. Managed directories use private filesystem permissions. This
prevents accidental cross-account selection within Bureau; it does not isolate
programs running as the same operating-system user.

Codex uses its documented [app-server account API](https://learn.chatgpt.com/docs/app-server).
Claude login controls are detected in the installed Agent SDK; if unavailable,
Bureau directs you to the bundled CLI instead.
