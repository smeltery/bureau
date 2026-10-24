import { errMessage } from "../../errors.ts";
import { logContent, type LogMessage, type LogParam } from "../log-message.ts";

/** Keep diagnostic text stable while carrying reader-localized display metadata. */
export class BureauLogError extends Error {
  constructor(readonly logMessage: LogMessage) {
    super(logContent(logMessage).content);
    this.name = "BureauLogError";
  }
}

export function errorLogParam(error: unknown, fallback = ""): LogParam {
  return error instanceof BureauLogError ? error.logMessage : errMessage(error, fallback);
}
