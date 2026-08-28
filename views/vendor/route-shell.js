(() => {
  const pathname = window.location.pathname;
  const shell = pathname === "/" ? "landing" : pathname === "/legal" ? "legal" : "workspace";
  document.documentElement.dataset.bfShell = shell;
  let bootstrapFinished = false;
  let bootstrapRecoveryStarted = false;
  let watchdogId = null;
  const HASHED_ASSET = /^assets\/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/;

  const revealStyledShell = () => {
    window.requestAnimationFrame(() => {
      document.body?.removeAttribute("hidden");
    });
  };

  const completeBootstrap = () => {
    bootstrapFinished = true;
    if (watchdogId !== null) window.clearTimeout(watchdogId);
    document.getElementById("bf-bootstrap-fatal")?.remove?.();
    if (shell === "workspace") {
      const workspace = document.querySelector(".app-container");
      workspace?.removeAttribute("hidden");
    }
    document.documentElement.dataset.bfBootstrap = "ready";
  };

  const appendTextElement = (parent, tagName, text) => {
    const element = document.createElement(tagName);
    element.textContent = text;
    parent.appendChild(element);
    return element;
  };

  const showBootstrapFailure = () => {
    if (bootstrapFinished || document.getElementById("bf-bootstrap-fatal")) return;
    bootstrapFinished = true;
    if (watchdogId !== null) window.clearTimeout(watchdogId);
    document.documentElement.dataset.bfBootstrap = "failed";

    if (shell === "workspace") {
      const workspace = document.querySelector(".app-container");
      workspace?.setAttribute("hidden", "");
    }

    const fatal = document.createElement("section");
    fatal.setAttribute("id", "bf-bootstrap-fatal");
    fatal.setAttribute("class", "bf-bootstrap-fatal");
    fatal.setAttribute("role", "alert");
    fatal.setAttribute("aria-live", "assertive");
    fatal.setAttribute("aria-labelledby", "bf-bootstrap-fatal-title");
    fatal.setAttribute("tabindex", "-1");
    const title = appendTextElement(
      fatal,
      "h1",
      "BiddingFlow chưa thể khởi động",
    );
    title.setAttribute("id", "bf-bootstrap-fatal-title");
    appendTextElement(
      fatal,
      "p",
      "Không thể tải đầy đủ ứng dụng. Vui lòng kiểm tra kết nối và thử lại.",
    );
    const retry = appendTextElement(fatal, "button", "Thử lại");
    retry.setAttribute("type", "button");
    retry.setAttribute("class", "btn btn-primary");
    retry.addEventListener("click", () => window.location.reload());
    document.body?.appendChild(fatal);
    revealStyledShell();
    window.requestAnimationFrame(() => fatal.focus());
  };

  const currentStaticGraph = (manifest) => {
    const pending = ["frontend/app/app.js"];
    const visited = new Set();
    const assets = [];
    while (pending.length) {
      const key = pending.shift();
      if (!key || visited.has(key)) continue;
      visited.add(key);
      const entry = manifest?.[key];
      if (!entry || typeof entry !== "object") continue;
      const candidates = [entry.file, ...(entry.css || []), ...(entry.assets || [])];
      candidates.forEach((asset) => {
        if (typeof asset === "string" && HASHED_ASSET.test(asset)) {
          assets.push(`/dist/${asset}`);
        }
      });
      if (Array.isArray(entry.imports)) pending.push(...entry.imports);
    }
    return [...new Set(assets)];
  };

  const refreshCurrentStaticGraph = async () => {
    if (typeof window.fetch !== "function") throw new Error("Fetch is unavailable");
    const manifestResponse = await window.fetch("/dist/.vite/manifest.json", {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!manifestResponse.ok) throw new Error(`Manifest request failed: ${manifestResponse.status}`);
    const assets = currentStaticGraph(await manifestResponse.json());
    if (!assets.length) throw new Error("Manifest has no application assets");
    await Promise.all(assets.map(async (asset) => {
      const response = await window.fetch(asset, {
        cache: "reload",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error(`Asset refresh failed: ${response.status}`);
      // fetch() resolves when response headers arrive. Consume the complete body
      // before navigating, otherwise reload can cancel the refresh request before
      // the browser has a complete response available in its HTTP cache.
      await response.arrayBuffer();
    }));
  };

  const attemptBootstrapRecovery = (entryURL) => {
    if (bootstrapFinished || bootstrapRecoveryStarted) return;
    let entryPath = "unknown";
    try {
      entryPath = new URL(entryURL, window.location.href).pathname;
    } catch (_) {
    }
    const marker = `bf-bootstrap-recovery:${entryPath}`;
    let recoveryGuardConfirmed = false;
    try {
      const storage = window.sessionStorage;
      if (storage?.getItem(marker) === "1") {
        showBootstrapFailure();
        return;
      }
      storage?.setItem(marker, "1");
      recoveryGuardConfirmed = storage?.getItem(marker) === "1";
    } catch (_) {
    }
    if (!recoveryGuardConfirmed) {
      // An automatic reload is safe only when the once-only marker survived a
      // round trip through session storage. With blocked storage, keep the
      // accessible manual retry UI instead of risking a cross-navigation loop.
      showBootstrapFailure();
      return;
    }
    bootstrapRecoveryStarted = true;
    refreshCurrentStaticGraph()
      .then(() => window.location.reload())
      .catch(showBootstrapFailure);
  };

  const failedApplicationEntry = (target) => {
    if (!(target instanceof Element) || target.tagName !== "SCRIPT") return null;
    if (String(target.getAttribute?.("type") || "").toLowerCase() !== "module") return null;
    try {
      const url = new URL(String(target.src || ""), window.location.href);
      if (url.origin !== window.location.origin) return null;
      if (
        url.pathname === "/frontend/app/app.js"
        || /^\/dist\/assets\/app-[A-Za-z0-9_-]{8}\.js$/.test(url.pathname)
      ) return url.href;
    } catch (_) {
    }
    return null;
  };

  window.__BF_BOOTSTRAP_COMPLETE__ = completeBootstrap;
  window.__BF_BOOTSTRAP_FATAL__ = showBootstrapFailure;
  window.addEventListener("error", (event) => {
    const entryURL = failedApplicationEntry(event.target);
    if (entryURL) attemptBootstrapRecovery(entryURL);
  }, true);

  const armWatchdog = () => {
    if (shell === "workspace") revealStyledShell();
    const timeout = Number(window.__BF_BOOTSTRAP_TIMEOUT_MS__) || 30_000;
    watchdogId = window.setTimeout(showBootstrapFailure, timeout);
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", armWatchdog, { once: true });
  } else {
    armWatchdog();
  }
})();
