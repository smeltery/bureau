import { translatorFor } from "../../../shared/i18n/translate.ts";
import { buildCommitNotice } from "../../../shared/update-notice.ts";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import type { AgentInfo } from "../../../shared/types.ts";
import type { CommitNotice } from "../../../shared/update-notice.ts";
import { buildPlainText, buildReleasePlainText, countBusyAgents } from "./UpdateModal.tsx";

function agent(state: AgentInfo["state"]): Pick<AgentInfo, "state"> {
  return { state };
}

describe("UpdateModal helpers", () => {
  const notice: CommitNotice = {
    pill: "new release",
    title: "New Release Available",
    notice: "You're on v2026.7.20; v2026.7.24 is out.",
  };

  test("counts only agents that would be interrupted mid-turn", () => {
    expect(countBusyAgents([agent("idle"), agent("thinking"), agent("tool_executing"), agent("waiting_for_response"), agent("error")])).toBe(2);
  });

  test("includes busy-agent restart warning in copied update text", () => {
    const text = buildPlainText(notice, 2);

    expect(text).toContain("Warning: 2 agents are currently working.");
    expect(text).toContain("Wait for them to finish before restarting");
  });

  test("omits restart warning when no agents are busy", () => {
    const text = buildPlainText(notice, 0);

    expect(text).not.toContain("Warning:");
  });

  test("includes user and system service restart commands", () => {
    const text = buildPlainText(notice, 0);

    expect(text).toContain("systemctl --user restart bureau");
    expect(text).toContain("sudo systemctl restart bureau");
  });

  test("copies image deployment update guidance without host restart steps", () => {
    const text = buildReleasePlainText({
      mode: "release",
      updateAvailable: true,
      current: {
        release: null,
        version: "abc1234abc1234abc1234abc1234abc1234abc12",
      },
      latest: {
        tag: "v2026.9.26",
        publishedAt: null,
        url: null,
      },
      apply: { kind: "image", guide: "kubernetes" },
    });

    expect(text).toContain("commit abc1234");
    expect(text).toContain("deploy the v2026.9.26 release image");
    expect(text).toContain("docs/contributing/hosting/kubernetes.md");
    expect(text).not.toContain("systemctl");
  });
});

test("translated update copies preserve commands and deployment-specific guide targets", () => {
  for (const language of ["en", "es", "ca", "zh"] as const) {
    const translator = translatorFor(language);
    const notice = buildCommitNotice(
      {
        mode: "commit",
        updateAvailable: true,
        current: { release: "v-current {literal}", sha: "a".repeat(40) },
        latest: { tag: "v-next {literal}", url: null },
        releaseStanding: "behind",
        mainAhead: 2,
      },
      translator,
    )!;
    const copy = buildPlainText(notice, 1, translator);
    expect(copy).toContain("v-current {literal}");
    expect(copy).toContain("v-next {literal}");
    expect(copy).toContain(translator.tn("settingsUi.updateBusy", 1));
    for (const command of ["bun install", "bun run dev", "systemctl --user restart bureau", "sudo systemctl restart bureau"]) expect(copy).toContain(`\`${command}\``);
    for (const guide of ["kubernetes", "render", "container"] as const) {
      const text = buildReleasePlainText(
        {
          mode: "release",
          updateAvailable: true,
          current: { release: null, version: "a".repeat(40) },
          latest: { tag: "v-next {literal}", url: "https://example.test/release", publishedAt: "2026-10-23T08:48:16Z" },
          apply: { kind: "image", guide },
        },
        translator,
      );
      expect(text).toContain(translator.t("settingsUi.updateCommit", { sha: "aaaaaaa" }));
      expect(text).toContain("v-next {literal}");
      expect(text).toContain("https://example.test/release");
      expect(text).toContain("2026-10-23T08:48:16Z");
      expect(text).not.toContain("systemctl");
      const link = text.match(/https:\/\/github.com\/smeltery\/bureau\/blob\/master\/([^\s#]+)#([^\s]+)/)!;
      expect(link).not.toBeNull();
      const document = readFileSync(new URL(`../../../${link[1]}`, import.meta.url), "utf8");
      expect(document).toContain(guide === "container" ? "## Container updates" : "## Update the office");
    }
    const unknown = buildReleasePlainText({ mode: "release", updateAvailable: false, current: { release: null, version: null }, latest: null, apply: { kind: "host" } }, translator);
    expect(unknown).toStartWith(translator.t("settingsUi.updateStatus"));
    expect(unknown).not.toContain("systemctl");
  }
});
