import { useEffect } from "react";
import { useAppState } from "../store.tsx";
import { send } from "../ws.ts";
import { InvitesTable, renderListSection, sectionHeader } from "./AccessPane.tsx";
import { hint, subsectionHeader } from "./AccessPaneShared.tsx";
import { IssueInviteForm } from "./IssueInviteForm.tsx";
import { RecoveryInviteForm } from "./RecoveryInviteForm.tsx";

export function InvitesPane() {
  const { invitesList, invitesLoaded } = useAppState();

  useEffect(() => {
    if (!invitesLoaded) send({ type: "list_invites" });
  }, [invitesLoaded]);

  return (
    <div style={{ marginTop: 24 }}>
      <h4 style={sectionHeader}>Invites</h4>
      <p style={hint}>Issue invite URLs for new users. Existing users add their own devices from My devices, or owners can mint a recovery link here.</p>

      <IssueInviteForm />

      <h5 style={subsectionHeader}>Recovery links</h5>
      <RecoveryInviteForm />

      <h5 style={subsectionHeader}>Outstanding invites</h5>
      {renderListSection(invitesList, invitesLoaded, (rows) => (
        <InvitesTable invites={rows} />
      ))}
    </div>
  );
}
