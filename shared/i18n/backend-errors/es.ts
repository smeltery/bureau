export const backendErrors = {
  "logs.backendError.timeout": "La solicitud de OpenCode agotó el tiempo de espera en {path}.",
  "logs.backendError.heartbeat": "El flujo de eventos de OpenCode dejó de enviar señales de actividad.",
  "logs.backendError.activeTurn": "OpenCode ya tiene un turno activo.",
  "logs.backendError.approval": "OpenCode admite Permitir una vez y Denegar.",
  "logs.backendError.noBody": "El flujo de eventos de OpenCode no tiene contenido.",
  "logs.backendError.uninitialized": "El transporte de OpenCode no está inicializado.",
  "logs.backendError.http": "OpenCode: HTTP {status} en {path}.",
} as const;
