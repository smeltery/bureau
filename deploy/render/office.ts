import { hasOwner } from "../../server/users.ts";
import { claimOwnership, freezeBootState, setCookieHeader, setPublicOriginFallback } from "../../server/auth/auth.ts";
import { loadOfficeConfig, saveOfficeConfig } from "../../server/persistence.ts";
import { createSetupHandler } from "./bootstrap.ts";

const publicUrl = process.env.BUREAU_PUBLIC_URL;
if (!publicUrl) throw new Error("Set BUREAU_PUBLIC_URL to the office's custom HTTPS origin");
const parsed = new URL(publicUrl);
if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) throw new Error("BUREAU_PUBLIC_URL must be an HTTPS origin");
const origin = parsed.origin;
// The template owns its public binding, and reapplies it after every redeploy.
saveOfficeConfig({
  ...loadOfficeConfig(),
  publicOrigin: origin,
  externalAccess: true,
  networkBind: "all",
});
if (!hasOwner()) {
  const key = process.env.BUREAU_SETUP_KEY || "";
  let finish!: () => void;
  const completed = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const handler = createSetupHandler({
    origin,
    key,
    hasOwner,
    claim: async (name, userAgent) => {
      const result = await claimOwnership(name, { userAgent });
      if (!result.ok) return null;
      setPublicOriginFallback(origin);
      freezeBootState({ externalAccess: true, networkBind: "all" });
      return setCookieHeader(result.rawSessionId, result.absoluteExpiresAt);
    },
    complete: finish,
  });
  const setup = Bun.serve({
    hostname: "0.0.0.0",
    port: Number(process.env.PORT || 10000),
    maxRequestBodySize: 4096,
    fetch: handler,
  });
  await completed;
  await setup.stop(true);
}
delete process.env.BUREAU_SETUP_KEY;
await import("../../server/index.ts");
