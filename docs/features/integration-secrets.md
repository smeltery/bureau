# Integration secrets and variables

Open **Settings → Connections → Secrets** to add credentials for external services.
Choose the office scope for credentials shared by all agents, or a member scope for
that member's agents. Owners can manage either scope. Members can manage their own
scope and see office connection summaries. A member value overrides an office
value with the same environment name.

Paste the value into the masked field, give it an environment name such as
`GH_TOKEN`, and specify exact allowed hosts. GitHub, Stripe and Fly presets provide
starting host lists. Use Authorization for bearer/basic credentials, or specify a
custom header. Usage notes are visible to agents: put instructions there, never
credential values. Ordinary variables remain visible to agents and belong in the
Variables tab. Provider credentials use the existing Providers tab.

An agent receives a stable stand-in instead of the stored secret. Proxy-aware
HTTPS clients send that stand-in; Bureau substitutes the real value only on port
443 for an allowed host and the configured header. Git receives scoped credential
helpers too. Client trust settings include Bureau's local certificate authority;
the proxy verifies the external server's certificate. Model-provider and package
registry traffic is never decrypted. Requests to other hosts and ports are passed
through without credential substitution. Tools that ignore proxy settings cannot
use stand-ins directly.

The proxy strips common credential reflections from response headers and streamed
bodies, including gzip, deflate and Brotli responses, URL encoding and recognizable
base64 groups. This is protection against accidental disclosure, **not a sandbox**:
programs with the same operating-system account can read the on-disk secret store,
and arbitrary encodings or deliberate exfiltration are not prevented. Use a
separate host/account and restricted service tokens when you need stronger isolation.

Secret files and proxy identity files are stored under the Bureau state directory
with owner-only permissions. They are not encrypted at rest. Protect state backups
accordingly. No real secret is intentionally placed in an agent environment or Git
helper, and audit events record names and actions, not credential values.

**Show** is available only to the member who owns a personal secret, or to an owner
for an office secret. Owners managing another member's secrets cannot reveal them.
Agents cannot reveal secrets, and privileged agents cannot expand an existing
secret's allowed host list.

Editing a value rotates the credential while retaining its stand-in. **Reissue
stand-in** invalidates the previous stand-in. Deleting and recreating a secret also
invalidates old stand-ins. Changes restart affected agent sessions between turns,
preserving conversation history. Deleting a member removes their integration store.

The local proxy honors the host process's `HTTPS_PROXY` and `NO_PROXY` settings for
company proxy chaining. Agents without secrets retain their existing environment.
A corrupt integration store is preserved and rejected rather than overwritten.
