import type { CommitUpdateStatus } from "./update-types.ts";

export interface CommitNotice {
  pill: string;
  title: string;
  notice: string;
}

export function buildCommitNotice(status: CommitUpdateStatus): CommitNotice | null {
  if (!status.updateAvailable) return null;

  const shortSha = status.current.sha.slice(0, 7);
  const running = status.current.release ?? `commit ${shortSha}`;
  const latest = status.latest;

  let identity: string;
  if (!latest) {
    identity = `You're on ${running}.`;
  } else if (status.releaseStanding === "current") {
    identity = `You're on ${running} (latest release).`;
  } else if (status.releaseStanding === "behind") {
    identity = `You're on ${running}; ${latest.tag} is out.`;
  } else if (status.releaseStanding === "ahead") {
    identity = status.current.release ? `You're on ${running} (newer than the latest release, ${latest.tag}).` : `You're on ${running}, past the latest release (${latest.tag}).`;
  } else {
    identity = `You're on ${running}. The latest release is ${latest.tag};`;
  }

  const drift = buildDrift(status);
  const releaseNewer = latest !== null && status.releaseStanding === "behind";

  return {
    pill: releaseNewer ? "new release" : `master +${status.mainAhead}`,
    title: releaseNewer ? "New Release Available" : "Newer Commits on master",
    notice: [identity, drift].filter(Boolean).join(" "),
  };
}

function buildDrift(status: CommitUpdateStatus): string {
  if (status.mainAhead <= 0) return "";
  const commits = status.mainAhead === 1 ? "commit" : "commits";
  const latest = status.latest;

  if (latest && status.releaseStanding === "behind" && status.current.release) {
    return `master has ${status.mainAhead} ${commits} beyond that.`;
  }
  if (latest && status.releaseStanding === "unknown") {
    return `master has ${status.mainAhead} newer ${commits}.`;
  }
  if (latest && (status.releaseStanding === "current" || status.releaseStanding === "ahead")) {
    return `master has ${status.mainAhead} newer ${commits} if you want the bleeding edge.`;
  }
  return `master has ${status.mainAhead} newer ${commits}.`;
}
