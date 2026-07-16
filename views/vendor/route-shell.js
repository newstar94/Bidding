(() => {
  document.documentElement.dataset.bfShell = window.location.pathname === "/" ? "landing" : "workspace";
})();
