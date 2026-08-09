// Display-only shortening of a working directory: `/home/nick/dev/bureau`
// reads as `~/dev/bureau`. The shared cwd display surfaces go through this —
// desk nameplates, the log-view headers (desktop and mobile), the cron run
// header, and the recent-cwd chips in the agent and cronjob dialogs — so they
// cannot drift apart the way they had (the mobile header and cron run header
// used to render the raw absolute path).
//
// Never use it on a value being sent back to the server: `~` expansion is only
// safe for the caller's OWN home, and nothing here knows whose path it is
// rendering.
export function shortenCwd(cwd: string): string {
  return cwd.replace(/^\/home\/[^/]+/, "~");
}
