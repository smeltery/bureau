import { captureInstallPrompt } from "./install/controller.ts";
import { AppChatPage } from "./apps-view/AppChatPage.tsx";
import type { AppChatBoot } from "../shared/integrations/app-chat.ts";
declare global {
  interface Window {
    __BUREAU_APP__?: AppChatBoot;
  }
}
import { createRoot } from "react-dom/client";
import { StoreProvider, ThemeProvider, FeaturesProvider } from "./store.tsx";
import { PRODUCTION_FEATURES } from "../shared/features.ts";
import { App } from "./App.tsx";
import { LanguageProvider } from "./i18n.tsx";
import { initFocusDebug } from "./focus-debug.ts";

captureInstallPrompt();
initFocusDebug();

const root = createRoot(document.getElementById("root")!);
root.render(
  <ThemeProvider>
    <FeaturesProvider features={PRODUCTION_FEATURES}>
      <StoreProvider>
        <LanguageProvider>{window.__BUREAU_APP__ ? <AppChatPage boot={window.__BUREAU_APP__} /> : <App />}</LanguageProvider>
      </StoreProvider>
    </FeaturesProvider>
  </ThemeProvider>,
);

if ("serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
