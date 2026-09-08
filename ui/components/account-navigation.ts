import type { AccountSection } from "./UserSettingsSections.ts";

export const OPEN_ACCOUNT_SECTION_EVENT = "bureau:open-account-section";

export type OpenAccountSectionDetail = { section: AccountSection };

/** Ask App to open User Settings on a specific Account sidebar section. */
export function requestOpenAccountSection(section: AccountSection): void {
  window.dispatchEvent(new CustomEvent<OpenAccountSectionDetail>(OPEN_ACCOUNT_SECTION_EVENT, { detail: { section } }));
}
