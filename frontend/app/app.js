import { trustedScriptURL } from "../shared/trustedTypes.js";
import { APP_DEBUG } from "./appConfig.js";
import { apiFetch } from "../shared/apiClient.js";
import { installDialogAccessibility } from "../shared/dialogAccessibility.js";
import { retryPendingWorkspacePurges } from "./workspaceState.js";
import { installSemanticAccessibility } from "../shared/semanticAccessibility.js";
import {
  installReleaseDiagnostics,
  recoverFromStaleDynamicImport,
} from "../shared/releaseDiagnostics.js";
import { installAuthOverlayAccessibility } from "../auth/AuthUi.js";
import { installOverflowTextAutoScroll } from "../shared/overflowTextAutoScroll.js";
import { renderLucideIcons } from "../shared/lucideIcons.js";
import {
  embeddedSessionNeedsWorkspaceRefresh,
  preferredWorkspaceId
} from "../auth/sessionBootstrapPolicy.js";
import { updateServerCapabilitiesFromSession } from "../auth/serverCapabilities.js";
import {
  handleApplicationBootstrapFailure,
  runApplicationBootstrap,
} from "./bootstrapRecovery.js";
installReleaseDiagnostics();
const startupMark = (name) => {
  try {
    performance.mark(`bf:${name}`);
  } catch (_) {
  }
};
startupMark("app-module-start");
const isLandingPath = () => window.location.pathname === "/";
const isLegalPath = () => window.location.pathname === "/legal";
const isNotFoundPage = () => document.querySelector('meta[name="bf-not-found"]')?.content === "true";
const readSessionBootstrap = () => {
  try {
    const node = document.getElementById("bf-session-bootstrap");
    return node?.textContent ? JSON.parse(node.textContent) : null;
  } catch (_) {
    return null;
  }
};
if (!window.lucide || typeof window.lucide.createIcons !== "function") {
  window.lucide = { __bfLucideShim: true, createIcons: () => {
  } };
}
const checkInitialSession = async () => {
  const embedded = readSessionBootstrap();
  const preferredWorkspace = preferredWorkspaceId();
  if (
    embedded
    && typeof embedded.valid === "boolean"
    && !embeddedSessionNeedsWorkspaceRefresh(embedded, preferredWorkspace)
  ) return embedded;
  startupMark("session-check-start");
  try {
    const response = await apiFetch("/api/auth/check-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ remember: localStorage.getItem("bf_remember_me") === "true" })
    });
    if (response.ok) {
      const result = await response.json();
      startupMark("session-check-end");
      return result;
    }
    if (response.status === 401 || response.status === 403) {
      return { valid: false };
    }
    throw new Error(`Session check unavailable (${response.status})`);
  } catch (err) {
    console.warn("Initial session check failed:", err);
    throw err;
  }
};
const isLucideReady = () => typeof window.lucide?.createIcons === "function" && window.lucide.__bfLucideShim !== true;
const loadLucideIcons = () => new Promise((resolve, reject) => {
  if (isLucideReady()) {
    resolve();
    return;
  }
  const existing = document.querySelector("script[data-bf-lucide]");
  if (existing) {
    if (existing.dataset.bfLoaded === "true") {
      reject(new Error("Lucide script loaded without exposing createIcons"));
      return;
    }
    existing.addEventListener("load", () => {
      if (isLucideReady()) resolve();
      else reject(new Error("Lucide script loaded without exposing createIcons"));
    }, { once: true });
    existing.addEventListener("error", reject, { once: true });
    return;
  }
  const script = document.createElement("script");
  script.src = trustedScriptURL("/vendor/lucide/lucide.min.js?v=1.21.0.1");
  script.async = true;
  script.dataset.bfLucide = "true";
  const handleRuntimeError = (event) => {
    if (!String(event.filename || "").includes("/vendor/lucide/lucide.min.js")) return;
    window.removeEventListener("error", handleRuntimeError);
    reject(new Error(`Lucide runtime error: ${event.message || "unknown error"} (${event.lineno || 0}:${event.colno || 0})`));
  };
  window.addEventListener("error", handleRuntimeError);
  script.addEventListener("load", () => {
    window.removeEventListener("error", handleRuntimeError);
    script.dataset.bfLoaded = "true";
    if (isLucideReady()) resolve();
    else reject(new Error("Lucide script loaded without exposing createIcons"));
  }, { once: true });
  script.addEventListener("error", () => {
    window.removeEventListener("error", handleRuntimeError);
    reject(new Error(`Lucide script request failed: ${script.src}`));
  }, { once: true });
  document.head.appendChild(script);
});
let lucideReadyPromise;
const loadAndRenderLucideIcons = async (roots = []) => {
  if (!lucideReadyPromise) {
    lucideReadyPromise = loadLucideIcons().then(() => true).catch((err) => {
      console.warn("Lucide icons could not be loaded:", err);
      return false;
    });
  }
  const loaded = await lucideReadyPromise;
  if (!loaded) return false;
  roots.filter(Boolean).forEach((root) => renderLucideIcons(root, window.lucide));
  return true;
};
const bootstrapApplication = async () => {
  startupMark("dom-content-loaded");
  installDialogAccessibility(document);
  installAuthOverlayAccessibility();
  installSemanticAccessibility(document);
  installOverflowTextAutoScroll(document);
  if (isLandingPath()) {
    const { bootstrapLandingPage } = await import("../landing/LandingPage.js");
    await bootstrapLandingPage(readSessionBootstrap());
    requestAnimationFrame(() => {
      void loadAndRenderLucideIcons([document.getElementById("landing-page")]);
      scheduleServiceWorkerRegistration();
    });
    return;
  }
  if (isLegalPath()) {
    const { bootstrapLegalPage } = await import("../legal/LegalPage.js");
    await bootstrapLegalPage();
    requestAnimationFrame(() => {
      void loadAndRenderLucideIcons([document.getElementById("legal-page")]);
      scheduleServiceWorkerRegistration();
    });
    return;
  }
  if (isNotFoundPage()) {
    const { bootstrapNotFoundPage } = await import("../errors/NotFoundPage.js");
    await bootstrapNotFoundPage();
    requestAnimationFrame(() => {
      void loadAndRenderLucideIcons([document.getElementById("bf-not-found-page")]);
      scheduleServiceWorkerRegistration();
    });
    return;
  }

  await retryPendingWorkspacePurges();
  const initialSession = await checkInitialSession();
  updateServerCapabilitiesFromSession(initialSession);
  if (initialSession?.valid) {
    if (window.location.pathname === "/dang-nhap") {
      window.history.replaceState({}, "", "/tong-quan");
    }
    startupMark("workspace-import-start");
    const { bootstrapWorkspace } = await import("./workspaceBootstrap.js");
    startupMark("workspace-import-end");
    await bootstrapWorkspace(initialSession);
  } else {
    const { bootstrapAuthShell } = await import("../auth/AuthShell.js");
    await bootstrapAuthShell(initialSession);
  }
  requestAnimationFrame(() => {
    startupMark("first-app-frame");
    const iconRoots = initialSession?.valid
      ? [
          document.getElementById("sidebar"),
          document.querySelector(".top-header") || document.querySelector(".app-header"),
          document.querySelector(".tab-pane.active"),
          document.querySelector(".unassigned-workspace-panel"),
        ]
      : [document.getElementById("auth-overlay")];
    void loadAndRenderLucideIcons(iconRoots);
    scheduleServiceWorkerRegistration();
  });
};
const scheduleServiceWorkerRegistration = () => {
  if (!("serviceWorker" in navigator) || APP_DEBUG !== false) return;
  const register = () => {
    startupMark("service-worker-register-start");
    const buildId = new URL(import.meta.url).pathname.split("/").pop() || "app";
    navigator.serviceWorker.register(
      trustedScriptURL(`/service-worker.js?build=${encodeURIComponent(buildId)}`)
    ).then(() => {
      startupMark("service-worker-register-end");
    }).catch(() => {
    });
  };
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(register, { timeout: 3000 });
  } else {
    window.setTimeout(register, 1000);
  }
};
const startApplication = () => runApplicationBootstrap(
  bootstrapApplication,
  {
    onSuccess: () => window.__BF_BOOTSTRAP_COMPLETE__?.(),
    onFailure: (error) => {
      console.error("Application bootstrap failed:", error);
      handleApplicationBootstrapFailure(error, {
        recover: (bootstrapError) => recoverFromStaleDynamicImport({ error: bootstrapError }),
        onFailure: (bootstrapError) => window.__BF_BOOTSTRAP_FATAL__?.(bootstrapError),
      });
    },
  },
);
if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", startApplication, { once: true });
} else {
  void startApplication();
}
