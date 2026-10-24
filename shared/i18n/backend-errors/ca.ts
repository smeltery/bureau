export const backendErrors = {
  "logs.backendError.timeout": "La sol·licitud d’OpenCode ha esgotat el temps d’espera a {path}.",
  "logs.backendError.heartbeat": "El flux d’esdeveniments d’OpenCode ha deixat d’enviar senyals d’activitat.",
  "logs.backendError.activeTurn": "OpenCode ja té un torn actiu.",
  "logs.backendError.approval": "OpenCode admet Permet una vegada i Denega.",
  "logs.backendError.noBody": "El flux d’esdeveniments d’OpenCode no té contingut.",
  "logs.backendError.uninitialized": "El transport d’OpenCode no està inicialitzat.",
  "logs.backendError.http": "OpenCode: HTTP {status} a {path}.",
} as const;
