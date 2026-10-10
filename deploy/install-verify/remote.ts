import { claim, exerciseOffice } from "./client.ts";
const base = process.env.BUREAU_VERIFY_URL;
const key = process.env.BUREAU_VERIFY_SETUP_KEY;
if (!base || !key) throw new Error("Disposable office URL and synthetic setup key required");
const origin = "https://office.install.test";
const cookie = await claim(base, origin, key);
await exerciseOffice(base, origin, cookie, "/var/data/workspaces");
console.log("PASS: Kubernetes pod entrypoint and security context");
