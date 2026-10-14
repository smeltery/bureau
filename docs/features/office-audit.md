# Office audit log

Owners can open **Settings → Audit log** to filter changes by actor or operation
and page through older records. `GET /api/audit-log` exposes the same owner-only
view, including owner API tokens and owner-managed privileged agents. Members,
unprivileged agents and unauthenticated local callers cannot read it.

Records include a timestamp, actor identity, operation, relative state target,
changed field names and outcome. HTTP and WebSocket mutations attribute writes
to their initiating member, agent, app, schedule run or verified webhook path.
The local recovery socket identifies its own owner-login operations. Browser
pairing/grants, terminal open/close and uploaded attachments also produce entries.
Reads and background work after the initiating request completes are excluded.

Atomic state-file writes create an audit intent before modifying the state:

- **committed**: the write completed and its audit outcome was saved;
- **failed**: the state write raised an error;
- **pending**: the process stopped or the final audit outcome could not be saved.

Pending entries deliberately do not assert success or failure. A logical action
may update several state files and therefore produce several entries. An audit
entry records persistence, not a guarantee that a later provider or app process
finished its work. Terminal and upload event recording is best-effort after the
action succeeds; failures are reported in the server log.

The audit stores metadata and changed office, room, agent and member prompt text
after successful writes. Expand a prompt entry to recover its text, then restore
it through the normal versioned settings editor. Tokens, environment values,
unrelated request fields and other full file contents are excluded. Task detail provides before/after task content and deleted
recovery; the existing memory operation journal retains memory revisions.
Audit records live in `audit/` under the office state directory and are included
in backups. They are not tamper-proof against the machine owner. No earlier
activity is invented, and no automatic retention limit deletes old entries.
Storage appears in the existing Other state category. Cursor pages contain up
to 50 records; scanning the directory still grows with retained history.
