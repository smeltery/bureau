import { useI18n } from "../i18n.tsx";
import { useEffect } from "react";
import { useAppState } from "../store.tsx";
import { send } from "../ws.ts";
import { InvitesTable, renderListSection, sectionHeader } from "./AccessPane.tsx";
import { hint, subsectionHeader } from "./AccessPaneShared.tsx";
import { IssueInviteForm } from "./IssueInviteForm.tsx";
import { RecoveryInviteForm } from "./RecoveryInviteForm.tsx";

export function InvitesPane() {
  const { t } = useI18n();
  const { invitesList, invitesLoaded } = useAppState();

  useEffect(() => {
    if (!invitesLoaded) send({ type: "list_invites" });
  }, [invitesLoaded]);

  return (
    <div style={{ marginTop: 24 }}>
      <h4 style={sectionHeader}>{t("invitesUi.title")}</h4>
      <p style={hint}>{t("invitesUi.hint")}</p>

      <IssueInviteForm />

      <h5 style={subsectionHeader}>{t("invitesUi.recovery")}</h5>
      <RecoveryInviteForm />

      <h5 style={subsectionHeader}>{t("invitesUi.outstanding")}</h5>
      {renderListSection(invitesList, invitesLoaded, (rows) => (
        <InvitesTable invites={rows} />
      ))}
    </div>
  );
}
