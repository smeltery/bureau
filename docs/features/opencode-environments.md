# OpenCode environments

New OpenCode conversations use a durable profile for the managing user and room.
Agents in the same environment share a local server; different managers or rooms
use separate home, configuration, data, state and cache directories. Schedules
use the creator's office-level environment, matching their existing environment
inheritance. Model discovery and slide formatting select the corresponding
profile as well.

Profile names are hashes of stable manager/room identities, never of credentials.
Changing an API key or env-file path therefore does not create an empty history
store. Agent turns reread their environment before sending. The supervisor
compares launch configuration and profile login-file changes, and restarts only
between active turns. If another turn is still running, the operation fails with
an explicit retry message. It does not replay an already submitted prompt.

## Session history and upgrades

Each provider session has an atomic, private binding in
`~/.bureau/opencode/session-bindings/`. It records the profile identity, manager/
room environment, directory, model and permission agent. It contains no API keys
or launch environment. Create, resume, history reads and forks use that binding,
including after an office restart. Corrupt bindings fail closed instead of
silently choosing a different store.

Conversations created before profiles were introduced remain in
`opencode/profiles/default`. On first access they receive a durable legacy
binding; forks retain that store. No database or login files are copied to new
manager profiles. The legacy store still contains its historical shared data
and any credentials previously saved there. Legacy sessions with different
environments serialize credential changes between turns; stale leases cannot
use the newly selected environment. Start a new conversation to use a separate
profile. This preserves access to old history without claiming that historical
shared storage has become private.

Moving an agent to another manager or room does not move its provider history.
Start a new conversation there, or return to the original environment to resume
or fork the old session. Bureau's existing saved conversation logs remain
available through the normal access checks.

## Authentication and restart

Use the agent's environment file for provider keys, or the profile-scoped login
command shown in its authentication notice. That command sets the profile's
home and XDG directories. A bare host `opencode auth login` targets the host CLI's
own store and is not a substitute for signing into a Bureau profile.

Office and app bearer tokens stay out of every OpenCode child; active-turn
Bureau authority continues to use the existing broker. Login files remain
excluded from backups and protected by the existing credential-path policy.
A private process-identity record lets a restarted office stop a verified old
server before reopening the same profile. No server password is persisted.

Validation covers profile separation, credential rotation, retained legacy
history, restart/fork bindings, corrupt records, stale leases, active-turn
protection, scoped login commands and process recovery. Tests use isolated
profiles and local fake providers; they do not spend provider credits.
