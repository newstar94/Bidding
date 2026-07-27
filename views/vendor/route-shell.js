(() => {
  const pathname = window.location.pathname;
  document.documentElement.dataset.bfShell = pathname === "/" ? "landing" : pathname === "/legal" ? "legal" : "workspace";
})();
