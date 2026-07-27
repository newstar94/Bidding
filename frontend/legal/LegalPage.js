export function isLegalPath(pathname = window.location.pathname) {
  return pathname === "/legal";
}

const LEGAL_PANEL_IDS = ["terms", "privacy", "security"];

function panelIdFromHash(hash = window.location.hash) {
  const candidate = String(hash || "").replace(/^#/, "");
  return LEGAL_PANEL_IDS.includes(candidate) ? candidate : null;
}

function activateLegalPanel(panelId, { historyMode = null, scroll = false, focusPanel = false } = {}) {
  const resolvedId = LEGAL_PANEL_IDS.includes(panelId) ? panelId : LEGAL_PANEL_IDS[0];
  const panel = document.querySelector(`[data-legal-panel="${resolvedId}"]`);
  if (!panel) return;

  let selectedTab = null;
  document.querySelectorAll("[data-legal-tab]").forEach((tab) => {
    const selected = tab.dataset.legalTab === resolvedId;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    if (selected) selectedTab = tab;
  });
  document.querySelectorAll("[data-legal-panel]").forEach((candidate) => {
    candidate.hidden = candidate !== panel;
  });

  if (historyMode && window.location.hash !== `#${resolvedId}`) {
    window.history[historyMode === "replace" ? "replaceState" : "pushState"](
      null,
      "",
      `#${resolvedId}`
    );
  }

  if (scroll || focusPanel) {
    window.requestAnimationFrame(() => {
      if (scroll && selectedTab) selectedTab.scrollIntoView({ block: "nearest", inline: "center" });
      if (scroll) panel.scrollIntoView({ block: "start" });
      if (focusPanel) panel.focus({ preventScroll: true });
    });
  }
}

function installLegalTabs() {
  const tabs = [...document.querySelectorAll("[data-legal-tab]")];
  if (!tabs.length) return;

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => {
      activateLegalPanel(tab.dataset.legalTab, { historyMode: "push", scroll: true });
    });
    tab.addEventListener("keydown", (event) => {
      let nextIndex = null;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (index + 1) % tabs.length;
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (index - 1 + tabs.length) % tabs.length;
      if (event.key === "Home") nextIndex = 0;
      if (event.key === "End") nextIndex = tabs.length - 1;
      if (nextIndex === null) return;
      event.preventDefault();
      const nextTab = tabs[nextIndex];
      nextTab.focus();
      activateLegalPanel(nextTab.dataset.legalTab, { historyMode: "push" });
    });
  });

  document.querySelectorAll('.legal-page a[href^="#"]').forEach((link) => {
    const panelId = panelIdFromHash(link.getAttribute("href"));
    if (!panelId) return;
    link.addEventListener("click", (event) => {
      event.preventDefault();
      activateLegalPanel(panelId, { historyMode: "push", scroll: true });
    });
  });

  const syncFromLocation = () => {
    activateLegalPanel(panelIdFromHash() || LEGAL_PANEL_IDS[0], { scroll: Boolean(panelIdFromHash()) });
  };
  window.addEventListener("popstate", syncFromLocation);
  window.addEventListener("hashchange", syncFromLocation);
  activateLegalPanel(panelIdFromHash() || LEGAL_PANEL_IDS[0], { scroll: Boolean(panelIdFromHash()) });
}

export function bootstrapLegalPage() {
  document.body.classList.remove("bf-init-loading");
  document.body.classList.add("legal-ready");
  document.querySelectorAll("[data-legal-year]").forEach((node) => {
    node.textContent = String(new Date().getFullYear());
  });
  installLegalTabs();
}
