import type { Browser } from "playwright-core";

const LAUNCH_ARGS = [
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-sync",
  "--disable-default-apps",
  "--disable-client-side-phishing-detection",
  "--disable-domain-reliability",
  "--metrics-recording-only",
  "--disable-features=OptimizationHints,MediaRouter,Translate",
];

export function launchOptions(executablePath: string) {
  return { executablePath, headless: true as const, args: LAUNCH_ARGS, handleSIGINT: false as const, handleSIGTERM: false as const, handleSIGHUP: false as const };
}

export async function defaultLaunch(executablePath: string): Promise<Browser> {
  const { chromium } = await import("playwright-core");
  return chromium.launch(launchOptions(executablePath));
}
