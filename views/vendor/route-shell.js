(() => {
  const pathname = window.location.pathname;
  const shell = pathname === "/" ? "landing" : pathname === "/legal" ? "legal" : "workspace";
  document.documentElement.dataset.bfShell = shell;
  let bootstrapFinished = false;
  let watchdogId = null;

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

  window.__BF_BOOTSTRAP_COMPLETE__ = completeBootstrap;
  window.__BF_BOOTSTRAP_FATAL__ = showBootstrapFailure;
  window.addEventListener("error", (event) => {
    const target = event.target;
    if (
      target instanceof Element
      && target.tagName === "SCRIPT"
      && String(target.src || "").includes("/frontend/app/app.js")
    ) {
      showBootstrapFailure();
    }
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
