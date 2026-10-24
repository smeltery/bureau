import { translatorFor, type Translator } from "./i18n/translate.ts";
import type { CommitUpdateStatus } from "./update-types.ts";

export interface CommitNotice {
  pill: string;
  title: string;
  notice: string;
}

export function buildCommitNotice(status: CommitUpdateStatus, translator: Translator = translatorFor("en")): CommitNotice | null {
  if (!status.updateAvailable) return null;
  const { t } = translator;

  const shortSha = status.current.sha.slice(0, 7);
  const running = status.current.release ?? t("settingsUi.updateCommit", { sha: shortSha });
  const latest = status.latest;

  let identity: string;
  if (!latest) {
    identity = t("settingsUi.updateRunning", { running });
  } else if (status.releaseStanding === "current") {
    identity = t("settingsUi.updateCurrent", { running });
  } else if (status.releaseStanding === "behind") {
    identity = t("settingsUi.updateBehind", { running, latest: latest.tag });
  } else if (status.releaseStanding === "ahead") {
    identity = status.current.release ? t("settingsUi.updateAhead", { running, latest: latest.tag }) : t("settingsUi.updatePast", { running, latest: latest.tag });
  } else {
    identity = t("settingsUi.updateUnknown", { running, latest: latest.tag });
  }

  const drift = buildDrift(status, translator);
  const releaseNewer = latest !== null && status.releaseStanding === "behind";

  return {
    pill: releaseNewer ? t("settingsUi.updatePill") : `master +${status.mainAhead}`,
    title: releaseNewer ? t("settingsUi.updateNew") : t("settingsUi.updateCommits"),
    notice: [identity, drift].filter(Boolean).join(" "),
  };
}

function buildDrift(status: CommitUpdateStatus, { tn }: Translator): string {
  if (status.mainAhead <= 0) return "";
  if (status.latest && status.releaseStanding === "behind" && status.current.release) return tn("settingsUi.updateBeyond", status.mainAhead);
  if (status.latest && (status.releaseStanding === "current" || status.releaseStanding === "ahead")) return tn("settingsUi.updateEdge", status.mainAhead);
  return tn("settingsUi.updateDrift", status.mainAhead);
}
