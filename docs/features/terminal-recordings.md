# Terminal recordings

Owners can enable **Record newly opened terminals** in User Settings → Audit.
Recording is off by default. After enabling it, open a new terminal or restart an
existing one. The terminal header shows **Recording**, **Recording stopped**, or
**Recording failed**. Turning the setting off immediately ends active recordings;
it does not delete saved recordings or stop the shells.

Recordings contain displayed terminal output, terminal dimensions and attributed
input bursts. Input text is never saved by the recorder. Commands echoed by the
shell are displayed output and therefore can appear in recordings. Known token
formats and long secret assignments are masked on a best-effort basis; output can
still contain sensitive information. Incomplete output lines are held until a
newline or terminal closure so tokens split across chunks can be masked together.
Lines longer than 64 KiB are omitted. This can delay output during replay.

Open **Replay terminal** on a terminal-open audit entry, or expand **Saved
recordings** in Audit. Playback is read-only and has play/pause, restart and final
output controls. No replay input is sent to a shell. An active recording is a
snapshot; reopen it to refresh. A server crash can leave a recording marked
interrupted. Complete events remain readable, while a partial final write is
ignored.

Only a current owner using a browser session can list, replay, configure or remove
recordings. Agent bearers and personal API tokens cannot use these endpoints:

- `GET /api/terminal-recordings` lists saved recordings.
- `GET /api/terminal-recordings/settings` reads the enabled flag.
- `PATCH /api/terminal-recordings/settings` accepts `{ "enabled": true }` or false.
- `GET /api/terminal-recordings/:id` reads a recording snapshot.
- `DELETE /api/terminal-recordings/:id` removes an inactive recording.

Files live in `terminal-recordings/` under the office state directory, with private
file permissions. Settings live in `terminal-recording-settings.json`. Each
recording is capped at 20 MiB. Writes flush every 250 ms or 64 KiB; disk errors stop
recording without stopping the terminal. Recordings remain until an owner removes
them in Audit; active recordings cannot be removed. Removal leaves the audit entry
intact, and its replay link reports that the recording is no longer available.
Backups include saved recordings as part of office state.
