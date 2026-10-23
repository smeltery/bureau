export const logs = {
  "logs.interrupted": "代理已中断。",
  "logs.newConversation": "已开始新对话。",
  "logs.handoffOpened": "自动交接已开启新对话。摘要将先于排队消息送达。",
  "logs.resumed": "已恢复会话：{topic}",
  "logs.resumeFailed": "恢复失败：{error}",
  "logs.newFailed": "无法开始新对话：{error}",
  "logs.interruptResumeFailed": "中断后恢复失败：{error}",
  "logs.directoryUnavailable": "会话保存的目录 `{storedCwd}` 不可用（{error}）；正在 `{cwd}` 中恢复。",
} as const;
