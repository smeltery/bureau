// App boot reconciliation: the pass that makes an office's apps consistent
// with what is actually on the box, once per bureau start. Wiring only — the
// decisions live in token-reconcile.ts, the machine access in supervisor.ts.
//
// Why it runs at boot rather than on demand. Three facts about an app's token
// live in three different places (a hash in the store, a plaintext in the
// environment file the unit reads, and a reference to that file inside the
// installed unit), and none of them can be checked from a request path without
// a subprocess per app. A boot pass is the one moment where checking all three
// for every app is cheap and nothing is waiting on the answer.
//
// It is also the only thing that can fix an app registered before app tokens
// existed, or one whose provisioning half-happened because bureau died between
// the two writes.

import { appRegistry } from "./registry.ts";
import { appSupervisor } from "./supervisor.ts";
import { appTokens } from "./tokens.ts";
import { reconcileAppTokens } from "./token-reconcile.ts";
import { errMessage } from "../../shared/errors.ts";

export function reconcileAppsAtBoot(): void {
  try {
    const report = reconcileAppTokens({
      list: () => appRegistry.list(),
      tokens: appTokens,
      readToken: (name) => appSupervisor.readToken(name),
      removeToken: (name) => appSupervisor.removeToken(name),
      reloadUnits: () => appSupervisor.reloadUnits(),
      unitInjectsToken: (name) => appSupervisor.unitInjectsToken(name),
      provisionToken: (name, raw) => appSupervisor.provisionToken(name, raw),
      regenerate: (app) => appSupervisor.regenerate(app),
    });
    if (report.checked === 0) return;
    const changed = report.provisioned.length + report.rewired.length + report.pruned.length + report.failed.length;
    if (changed === 0) return;
    // One line, and only when something actually moved: an office whose apps
    // are all healthy should not add noise to every boot.
    console.log(
      `[apps] reconciled ${report.checked} app(s):` +
        `${report.provisioned.length > 0 ? ` provisioned ${report.provisioned.join(", ")};` : ""}` +
        `${report.rewired.length > 0 ? ` rewired ${report.rewired.join(", ")};` : ""}` +
        `${report.pruned.length > 0 ? ` pruned ${report.pruned.join(", ")};` : ""}` +
        `${report.failed.length > 0 ? ` FAILED ${report.failed.join(", ")};` : ""}`,
    );
  } catch (err) {
    // A corrupt registry (or an unreadable token store) aborts the pass and
    // nothing else: the office still boots, its agents still run, and the apps
    // keep whatever state they had. Failing the boot over app reconciliation
    // would take the whole office down for a subsystem it may not even use.
    console.error("[apps] boot reconciliation skipped:", errMessage(err));
  }
}
