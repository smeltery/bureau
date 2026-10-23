export const logs = {
  "logs.interrupted": "Agente interrumpido.",
  "logs.newConversation": "Se ha iniciado una conversación nueva.",
  "logs.handoffOpened": "El traspaso automático ha abierto una conversación nueva. El resumen llegará antes que los mensajes en cola.",
  "logs.resumed": "Sesión reanudada: {topic}",
  "logs.resumeFailed": "No se pudo reanudar: {error}",
  "logs.newFailed": "No se pudo iniciar una conversación nueva: {error}",
  "logs.interruptResumeFailed": "No se pudo reanudar después de la interrupción: {error}",
  "logs.directoryUnavailable": "El directorio guardado de la sesión `{storedCwd}` no está disponible ({error}); se reanuda en `{cwd}`.",
} as const;
