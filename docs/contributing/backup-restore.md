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

Bureau snapshots its state directory into verified local tarballs, every 24 hours
by default. Owners can change the interval, retention and destination in
**User Settings → Storage** without restarting the server.

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

For a custom state directory, the default is a sibling directory named
`<state-directory-name>-backups` (with a leading dot removed from the name).
Older installations using a custom state directory previously defaulted to
`~/bureau-backups`; those archives are left untouched. Set that path in Storage
or `BUREAU_BACKUP_DIR` to continue using it. The destination must be outside the
state directory, including through symlinks.

Override the saved directory with:

```sh
BUREAU_BACKUP_DIR=/path/to/backups bun run server
```

Backups are named `bureau-YYYY-MM-DD.tar.gz`, with a numeric suffix for additional
runs on the same day. Bureau keeps the seven newest verified tarballs by default.

## Configure Backups

In **User Settings → Storage**, owners can set an interval of 1–720 hours,
retention of 1–100 verified archives, and an absolute destination path. Leave the
path empty to restore the default. `BUREAU_BACKUP_DIR` takes precedence and locks
the directory field while allowing interval and retention changes.

Settings are persisted atomically in `backup-settings.json` inside the state
directory. The owner browser API is `GET /api/backup/settings` and
`PATCH /api/backup/settings`; PATCH accepts any subset of `intervalHours`,
`retention`, and `dir` (an absolute path, or `null` for the default). Personal
API tokens, agent tokens and loopback access cannot change these settings.

The scheduler checks hourly. A saved change applies at the next check; an
in-progress backup keeps the settings it started with. Health becomes stale
after the configured interval plus two hours. Retention runs only after a new
archive passes verification. Changing destinations leaves all archives in the
previous directory untouched; move or remove them manually when appropriate.
Invalid saved settings stop backups with a logged error instead of silently
falling back or overwriting the file.

## Compress Old Transcripts

Owners can preview and apply lossless transcript compression in **User Settings →
Storage**. Choose an age in days, preview eligible files, then apply. This is
manual and never runs on a schedule. Active and recent sessions are skipped;
files that changed or became active during compression are also skipped.
Compression that would not save space leaves the original file untouched.

Conversation history, session lists, fork ancestry and attachment references
continue to work with compressed transcripts. Resuming a compressed session
restores the complete transcript before appending. Existing transcript pruning
also handles compressed histories, retaining its active-session, newest-session
and fork-ancestor safeguards. A corrupt compressed transcript prevents appending
and makes attachment cleanup conservative; check the server log and restore a
verified backup before retrying.

The owner browser API is `POST /api/storage/compress` with
`{"olderThanDays":30}` for a read-only preview, or
`{"olderThanDays":30,"apply":true}` to apply. Ages must be integers from 1 to
36500. The server recomputes eligibility, checks current ownership before each
publication, and allows only one application at a time. The response includes
candidate bytes, compressed counts, before/after bytes, and any refused files.

This covers Bureau agent transcripts under `logs/<agentId>/`. Provider-owned
session files, cronjob logs and other state are unchanged. On disk, compressed
transcripts use `.jsonl.gz`; use `gzip -cd <file>.jsonl.gz` to inspect them
manually. The plain `.jsonl` is authoritative if an interrupted operation leaves
both versions. Modification times are preserved so compression does not reset
history ordering or retention age.

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
