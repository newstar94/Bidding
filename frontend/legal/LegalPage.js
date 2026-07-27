export function isLegalPath(pathname = window.location.pathname) {
  return pathname === "/legal";
}

export function bootstrapLegalPage() {
  document.body.classList.remove("bf-init-loading");
  document.body.classList.add("legal-ready");
  document.querySelectorAll("[data-legal-year]").forEach((node) => {
    node.textContent = String(new Date().getFullYear());
  });
}
