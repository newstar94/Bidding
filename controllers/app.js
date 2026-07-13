import { APP_DEBUG } from "./core/appConfig.js";
const startupMark = (name) => {
  try {
    performance.mark(`bf:${name}`);
  } catch (_) {
  }
};
startupMark("app-module-start");
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
  if (embedded && typeof embedded.valid === "boolean") return embedded;
  startupMark("session-check-start");
  try {
    const response = await fetch("/api/auth/check-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ remember: localStorage.getItem("bf_remember_me") === "true" })
    });
    if (response.ok) {
      const result = await response.json();
      startupMark("session-check-end");
      return result;
    }
  } catch (err) {
    console.warn("Initial session check failed:", err);
  }
  return { valid: false };
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
  script.src = "/vendor/lucide/lucide.min.js?v=1.21.0.1";
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
const bootstrapApplication = async () => {
  startupMark("dom-content-loaded");
  if ("serviceWorker" in navigator && APP_DEBUG === false) {
    navigator.serviceWorker.register("/service-worker.js").catch(() => {
    });
  }
  const lucideReady = loadLucideIcons().then(() => {
    window.lucide.createIcons();
    return true;
  }).catch((err) => {
    console.warn("Lucide icons could not be loaded:", err);
    return false;
  });
  const initialSession = await checkInitialSession();
  if (initialSession?.valid) {
    startupMark("workspace-import-start");
    const { bootstrapWorkspace } = await import("/controllers/workspaceBootstrap.js");
    startupMark("workspace-import-end");
    await bootstrapWorkspace(initialSession);
  } else {
    const { bootstrapAuthShell } = await import("/controllers/auth/AuthShell.js");
    await bootstrapAuthShell(initialSession);
  }
  requestAnimationFrame(() => {
    startupMark("first-app-frame");
    lucideReady.then((loaded) => {
      if (loaded) window.lucide.createIcons();
    });
  });
};
if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", bootstrapApplication, { once: true });
} else {
  bootstrapApplication();
}
