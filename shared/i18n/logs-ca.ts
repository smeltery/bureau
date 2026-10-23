export const logs = {
  "logs.interrupted": "Agent interromput.",
  "logs.newConversation": "S’ha iniciat una conversa nova.",
  "logs.handoffOpened": "El traspàs automàtic ha obert una conversa nova. El resum arribarà abans que els missatges en cua.",
  "logs.resumed": "Sessió represa: {topic}",
  "logs.resumeFailed": "No s’ha pogut reprendre: {error}",
  "logs.newFailed": "No s’ha pogut iniciar una conversa nova: {error}",
  "logs.interruptResumeFailed": "No s’ha pogut reprendre després de la interrupció: {error}",
  "logs.directoryUnavailable": "El directori desat de la sessió `{storedCwd}` no està disponible ({error}); es reprèn a `{cwd}`.",
} as const;
