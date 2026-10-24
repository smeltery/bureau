export const backendErrors = {
  "logs.backendError.timeout": "OpenCode 在 {path} 的请求超时。",
  "logs.backendError.heartbeat": "OpenCode 事件流停止发送心跳。",
  "logs.backendError.activeTurn": "OpenCode 已有一个正在进行的回合。",
  "logs.backendError.approval": "OpenCode 支持“允许一次”和“拒绝”。",
  "logs.backendError.noBody": "OpenCode 事件流没有响应正文。",
  "logs.backendError.uninitialized": "OpenCode 传输尚未初始化。",
  "logs.backendError.http": "OpenCode 在 {path} 返回 HTTP {status}。",
} as const;
