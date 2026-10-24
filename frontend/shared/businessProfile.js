// Public operator identity in the landing and legal footers (ADR 0095).
// The markup ships with neutral placeholders so the footer never shows
// invented company data; configured values replace them after one fetch.

export const BUSINESS_PROFILE_URL = "/api/public/business-profile";
export const BUSINESS_PROFILE_PLACEHOLDER = "Đang cập nhật";
export const BUSINESS_PROFILE_DEFAULTS = Object.freeze({
  legalName: "Đơn vị vận hành BiddingFlow",
  email: "biddingflow@gmail.com",
});

function fieldValue(profile, key) {
  const value = typeof profile?.[key] === "string" ? profile[key].trim() : "";
  return value || BUSINESS_PROFILE_DEFAULTS[key] || BUSINESS_PROFILE_PLACEHOLDER;
}

export function applyBusinessProfile(root, profile) {
  const containers = root?.querySelectorAll?.("[data-business-profile]") || [];
  containers.forEach((container) => {
    container.querySelectorAll("[data-business-field]").forEach((node) => {
      const key = node.dataset.businessField;
      const value = fieldValue(profile, key);
      node.textContent = value;
      if (node.tagName === "A" && key === "email") node.setAttribute("href", `mailto:${value}`);
    });
  });
}

export async function loadBusinessProfile(root = document, { fetchImpl = globalThis.fetch } = {}) {
  if (!root?.querySelector?.("[data-business-profile]") || typeof fetchImpl !== "function") return null;
  try {
    const response = await fetchImpl(BUSINESS_PROFILE_URL, { headers: { Accept: "application/json" } });
    if (!response.ok) return null;
    const payload = await response.json();
    const profile = payload && typeof payload.profile === "object" ? payload.profile : null;
    if (profile) applyBusinessProfile(root, profile);
    return profile;
  } catch (_) {
    // Placeholders stay visible; the footer must never break the page.
    return null;
  }
}
