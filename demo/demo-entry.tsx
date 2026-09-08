import { createRoot } from "react-dom/client";
import { StoreProvider, ThemeProvider, FeaturesProvider } from "../ui/store.tsx";
import { DEMO_FEATURES } from "../shared/features.ts";
import { App } from "../ui/App.tsx";
import { LanguageProvider } from "../ui/i18n.tsx";
import { setShim } from "../ui/ws.ts";
import { handleCommand, sendInitialState, setEmbedMode } from "./demo-server.ts";

const isEmbed = new URLSearchParams(window.location.search).has("embed");

// In embed mode, strip Angela (room 1) so only room 0 is seeded
if (isEmbed) setEmbedMode();

// Wire the shim before anything connects
setShim(handleCommand, sendInitialState);

// Hardcode username so the modal is skipped.
// Safe: demo runs at /demo, real app is self-hosted (different origin).
localStorage.setItem("bureau-username", "Ricky");

const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth < 600;

function DemoBanner() {
  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        padding: "6px 16px",
        background: "var(--bg-surface)",
        borderBottom: "1px solid var(--border-light)",
        fontSize: 13,
        color: "var(--text-dim)",
      }}
    >
      <span>{isMobile ? "This is a demo." : "This is a demo office."}</span>
    </div>
  );
}

const DEMO_BANNER_HEIGHT = 33;

const features = isEmbed ? { ...DEMO_FEATURES, embed: true } : DEMO_FEATURES;

function DemoApp() {
  if (isEmbed) {
    return (
      <div style={{ position: "fixed", inset: 0, transform: "translateZ(0)" }}>
        <App />
      </div>
    );
  }
  return (
    <>
      <style>{`:root { --banner-h: ${DEMO_BANNER_HEIGHT}px; }`}</style>
      <DemoBanner />
      <div style={{ position: "fixed", top: DEMO_BANNER_HEIGHT, left: 0, right: 0, bottom: 0, transform: "translateZ(0)" }}>
        <App />
      </div>
    </>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(
  <ThemeProvider>
    <FeaturesProvider features={features}>
      <StoreProvider>
        <LanguageProvider>
          <DemoApp />
        </LanguageProvider>
      </StoreProvider>
    </FeaturesProvider>
  </ThemeProvider>
);
