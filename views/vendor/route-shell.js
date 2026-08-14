(() => {
  const pathname = window.location.pathname;
  const shell = pathname === "/" ? "landing" : pathname === "/legal" ? "legal" : "workspace";
  document.documentElement.dataset.bfShell = shell;
  if (shell !== "workspace") return;

  const revealStyledShell = () => {
    window.requestAnimationFrame(() => {
      document.body?.removeAttribute("hidden");
    });
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", revealStyledShell, { once: true });
  } else {
    revealStyledShell();
  }
})();
