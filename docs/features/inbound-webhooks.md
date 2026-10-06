# Signed inbound webhooks

Open **Schedules → Webhooks** to create a GitHub webhook targeting an agent you
manage or a schedule you own. Office owners can manage other targets. Room
members can inspect hooks for targets they can see, but cannot change another
person's hook. Configuration, dry-run results, and delivery records stay within
that room's access boundary.

Choose event names, optional action names, and explicit dotted payload fields,
for example `repository.full_name, ref, head_commit.message`. No whole payload,
template evaluation, or script execution is accepted. Use **Dry run** with an
event and sample JSON to inspect the selected data without dispatching it.

Create the hook, copy its URL and the one-time signing secret, then configure
GitHub's webhook with that URL, **application/json**, the secret, and the selected
events. For remote GitHub delivery, the office needs external access enabled and
a reachable HTTPS public origin. GitHub setup details are in its
[webhook documentation](https://docs.github.com/en/webhooks/using-webhooks/creating-webhooks).

Bureau verifies `X-Hub-Signature-256` over the exact raw request bytes before
parsing JSON. Requests require `X-GitHub-Event` and `X-GitHub-Delivery`. Payloads
are limited to 256 KiB and ten seconds of body reading. Each hook allows up to
120 requests per minute; the office allows 20 simultaneous webhook ingress requests. Existing off-box
machine-token restrictions still apply to this public endpoint.

Selected data is labeled as untrusted external content. An agent receives an
attributed, non-editable queued message; a schedule starts a run with a `webhook`
trigger and records the hook and delivery IDs. Dispatch rechecks the hook owner's
current target access. Missing targets and revoked access produce failed receipts.

Delivery IDs and identical payload hashes are deduplicated for seven days,
including after restart. A claim is persisted before dispatch: if Bureau crashes
between claiming and completing delivery, its receipt remains pending and a
retry does not execute it twice. Inspect the receipt and target before choosing
to trigger work manually. Identical payloads with different delivery IDs are also
suppressed during this window. At 10,000 receipts per hook within the window,
ingress refuses additional deliveries until capacity becomes available. The UI
shows the latest 200 receipts; it does not store full incoming payloads.

Disable a hook to stop incoming work. Rotate its secret to invalidate the old
signing key immediately, then update GitHub. Secrets are stored separately with
owner-only filesystem permissions, are never returned by list/read endpoints,
and are excluded from backups. After restoring a backup, rotate and configure
fresh secrets. Deleting a hook removes its configuration, secret, and receipts.
