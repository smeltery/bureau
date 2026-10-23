# Backup and Restore

Owners can inspect Bureau's persisted footprint with `/bureau-storage` in any
agent chat, or with `GET /api/storage/usage`. The report breaks down office
state into transcripts, attachments, metadata, Codex home, memory, cronjob runs,
other state files, backups, and per-agent stored data.

Owners can also plan storage cleanup with `POST /api/storage/prune`. The
endpoint is a dry run unless the body includes `apply: true`; transcript applies
must also include `keepPerAgent` so the retention floor is explicit. Bureau does
not automatically delete transcripts or attachments.

Example dry run:

```sh
curl -X POST http://localhost:4000/api/storage/prune \
  -H 'Content-Type: application/json' \
  -d '{"target":"transcripts","olderThanDays":90,"keepPerAgent":3}'
```

Bureau snapshots its state directory once per day into local tarballs.

Generated app runtime credentials are excluded, including container app tokens
and their temporary files. App readiness and exit records remain in the backup.
The archive's `RESTORE.txt` lists omitted credential stores and the steps needed
after restoring. Bureau re-mints app runtime credentials at startup; start
previously stopped apps from the Apps page when needed.

## State Directory

Default state directory:

```sh
~/.bureau
```

Override it with:

```sh
BUREAU_HOME=/path/to/bureau-state bun run server
```

The active directory is reported by:

```sh
curl http://localhost:4000/backup/status
```

## Destination

Default backup directory:

```sh
~/bureau-backups
```

Override it with:

```sh
BUREAU_BACKUP_DIR=/path/to/backups bun run server
```

Backups are named `bureau-YYYY-MM-DD.tar.gz`. Bureau keeps the seven newest
tarballs.

## Restore

Stop Bureau first, then restore into the same state directory it was using.

For the default state directory:

```sh
mv ~/.bureau ~/.bureau.before-restore
tar -xzf ~/bureau-backups/bureau-YYYY-MM-DD.tar.gz -C ~
```

For a custom state directory:

```sh
mv "$BUREAU_HOME" "$BUREAU_HOME.before-restore"
tar -xzf /path/to/backups/bureau-YYYY-MM-DD.tar.gz -C "$(dirname "$BUREAU_HOME")"
```

Start Bureau again and verify the office in the UI. If the restore is wrong,
stop Bureau and move the `.before-restore` directory back into place.

Archives contain the state directory itself. Extract into its parent, and check
the archive's root name with `tar -tzf` when restoring to a different location.

## Recover Damaged Agent State

If `agents.json` contains invalid JSON or an invalid room/agent structure,
Bureau preserves its exact contents in a sibling
`agents.json.corrupt-<timestamp>-<unique-id>` file and logs that path before
starting with an empty room. Later saves leave the recovery copy intact. A
missing file or an empty array starts an empty room normally. Read errors or a
failed recovery copy stop startup instead of risking replacement of the state.

Stop Bureau before repairing state. Keep both the recovery copy and any new
`agents.json` created since the failure. Repair a separate copy, validate the
JSON, and restore it as `agents.json` in the active state directory. Preserve
room and agent IDs so existing logs and room access still match. Alternatively,
extract a verified backup into a temporary directory and restore its
`agents.json`; use the full restore procedure above if other state also needs
recovery. Restart and check the rooms and agents before removing any copies.

## Limitation

Bureau backs up Bureau-managed state: agents, rooms, tasks, cronjobs, logs, and
uploaded files. It does not back up Claude's own session transcripts under
`~/.claude`. After restoring old Bureau state, prefer starting new
conversations instead of resuming old sessions whose upstream SDK transcript may
have moved on.
