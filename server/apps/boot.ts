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
//
// The same argument applies a second time, to an app's own ADDRESS: it is
// derived from the office's public origin, so it changes without anything about
// the app changing, and a process's environment is fixed at exec. The URL pass
// below (url-reconcile.ts) is where the units catch up.

import { appRegistry } from "./registry.ts";
import { appSupervisor } from "./supervisor.ts";
import { appTokens } from "./tokens.ts";
import { reconcileAppTokens } from "./token-reconcile.ts";
import { reconcileAppUrls } from "./url-reconcile.ts";
import { appHostDomain, appPublicUrl } from "./domain.ts";
import { errMessage } from "../../shared/errors.ts";

export function reconcileAppsAtBoot(): void {
  reconcileTokens();
  // Then their addresses, on the units the pass above may just have written.
  reconcileUrls();
}

function reconcileTokens(): void {
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

// One-time-per-boot convergence of app URLs (url-reconcile.ts): every app's
// unit declares the address the office would give it today, and apps that were
// running are restarted once onto it. Runs AFTER the token pass, which may
// write a unit for an app that had none - a unit that pass creates is already
// current, so this one has nothing to do for it.
//
// ADVISORY, for the same reason as the token pass: a failure here must never
// stop the office from booting.
function reconcileUrls(): void {
  try {
    const report = reconcileAppUrls({
      list: () => appRegistry.list(),
      expectedUrl: (app) => appPublicUrl(app.hostLabel, appHostDomain()),
      readUnitFile: (name) => appSupervisor.readUnitFile(name),
      restoreUnitFile: (name, contents) => appSupervisor.restoreUnitFile(name, contents),
      regenerate: (app) => appSupervisor.regenerate(app),
      states: (names) => appSupervisor.states(names),
      restart: (name) => appSupervisor.restart(name),
    });
    if (report.converged.length + report.failed.length > 0) {
      console.log(`[app-urls] boot: ${report.converged.length} unit(s) updated, ${report.restarted.length} restarted, ${report.failed.length} failed`);
    }
  } catch (err) {
    console.error("[app-urls] boot reconciliation failed:", errMessage(err));
  }
}
