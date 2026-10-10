import type { Dialog, Page } from "playwright-core";
import type { BrowserDialog, BrowserResult } from "./params.ts";

/** One policy per serialized action; idle dialogs are always dismissed. */
export class BrowserDialogs {
  private active?: { accept: boolean; used: boolean; records: BrowserDialog[] };
  watch(page: Page): void {
    page.on("dialog", (dialog: Dialog) => {
      const policy = this.active;
      const accept = !!policy?.accept && !policy.used;
      if (policy) policy.used = true;
      const record = { type: dialog.type(), message: dialog.message().slice(0, 2000), accepted: false };
      if (policy && policy.records.length < 20) policy.records.push(record);
      // The page or another browser client can close it before we answer.
      void (accept ? dialog.accept() : dialog.dismiss())
        .then(() => {
          record.accepted = accept;
        })
        .catch(() => {});
    });
  }
  begin(dialog?: "accept" | "dismiss") {
    const policy = { accept: dialog === "accept", used: false, records: [] as BrowserDialog[] };
    this.active = policy;
    return <T extends BrowserResult>(result: T): T & { dialogs?: BrowserDialog[] } => {
      if (this.active === policy) this.active = undefined;
      return policy.records.length ? { ...result, dialogs: policy.records.map((record) => ({ ...record })) } : result;
    };
  }
}
