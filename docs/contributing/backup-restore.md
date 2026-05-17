# Backup and Restore

Bureau snapshots its state directory once per day into local tarballs.

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
mkdir -p ~/.bureau
tar -xzf ~/bureau-backups/bureau-YYYY-MM-DD.tar.gz -C ~/.bureau
```

For a custom state directory:

```sh
mv "$BUREAU_HOME" "$BUREAU_HOME.before-restore"
mkdir -p "$BUREAU_HOME"
tar -xzf /path/to/backups/bureau-YYYY-MM-DD.tar.gz -C "$BUREAU_HOME"
```

Start Bureau again and verify the office in the UI. If the restore is wrong,
stop Bureau and move the `.before-restore` directory back into place.

## Limitation

Bureau backs up Bureau-managed state: agents, rooms, tasks, cronjobs, logs, and
uploaded files. It does not back up Claude's own session transcripts under
`~/.claude`. After restoring old Bureau state, prefer starting new
conversations instead of resuming old sessions whose upstream SDK transcript may
have moved on.
