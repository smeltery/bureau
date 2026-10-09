import { AUTH_ERROR_PATTERNS } from "../config.ts";
import { isCodexAuthenticated } from "../native-bin.ts";

type AccountStatus = { account?: unknown; requiresOpenaiAuth?: boolean } | null;

/** Only explicit local account evidence can block a turn. Unknown providers or
 * unavailable RPCs still reach the normal backend error path. */
export class CodexSignInProbe {
  private unavailable = false;
  constructor(
    private readonly read: () => Promise<AccountStatus>,
    private readonly timeoutMs = 2000,
  ) {}

  async check(env?: Record<string, string | undefined>, bootstrapError?: Error | null): Promise<boolean> {
    if (bootstrapError) return AUTH_ERROR_PATTERNS.test(bootstrapError.message);
    if (isCodexAuthenticated(env) || this.unavailable) return false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const account = await Promise.race([
        this.read(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error("Account status timed out")), this.timeoutMs);
        }),
      ]);
      return account?.requiresOpenaiAuth === true && account.account === null;
    } catch {
      // Do not accumulate stalled requests on one transport; a fresh session
      // will retry capability discovery. A late response cannot block a turn.
      this.unavailable = true;
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
