export const STATUS_COLORS = Object.freeze({
  neutral: "#64748B",
  active: "#3B82F6",
  attention: "#F59E0B",
  review: "#A855F7",
  partial: "#14B8A6",
  complete: "#22C55E",
  cancelled: "#F43F5E",
});

export const PACKAGE_STATUS_PRESENTATION = Object.freeze({
  "Chưa xác định": { className: "badge-status-neutral", icon: "circle-help", color: "#94A3B8" },
  "Chuẩn bị": { className: "badge-status-neutral", icon: "circle-dot", color: STATUS_COLORS.neutral },
  "Đang mời thầu": { className: "badge-status-active", icon: "megaphone", color: STATUS_COLORS.active },
  "Đã mở thầu": { className: "badge-status-opened", icon: "folder-open", color: STATUS_COLORS.attention },
  "Đang chấm thầu": { className: "badge-status-review", icon: "award", color: STATUS_COLORS.review },
  "Đã có kết quả một phần": { className: "badge-status-partial", icon: "list-checks", color: STATUS_COLORS.partial },
  "Đã có kết quả": { className: "badge-status-complete", icon: "check-circle", color: STATUS_COLORS.complete },
  "Hủy thầu": { className: "badge-status-cancelled", icon: "x-circle", color: STATUS_COLORS.cancelled },
});

export const PACKAGE_STATUS_COLORS = Object.freeze(Object.fromEntries(
  Object.entries(PACKAGE_STATUS_PRESENTATION).map(([status, presentation]) => [
    status,
    presentation.color,
  ]),
));

export const PLAN_STATUS_COLORS = Object.freeze({
  "Chưa triển khai": STATUS_COLORS.neutral,
  "Đang thực hiện": STATUS_COLORS.active,
  "Hoàn thành": STATUS_COLORS.complete,
});

export const CONTRACT_STATUS_COLORS = Object.freeze({
  "Chưa hiệu lực": STATUS_COLORS.neutral,
  "Đang thực hiện": STATUS_COLORS.active,
  "Tạm dừng": STATUS_COLORS.attention,
  "Đã hoàn thành": STATUS_COLORS.complete,
  "Đã thanh lý": STATUS_COLORS.partial,
  "Đã hủy": STATUS_COLORS.cancelled,
});

const LEGACY_DEFAULT_CONTRACT_STATUS_COLORS = Object.freeze({
  "Chưa hiệu lực": "#64748B",
  "Đang thực hiện": "#2563EB",
  "Tạm dừng": "#D97706",
  "Đã hoàn thành": "#059669",
  "Đã thanh lý": "#0F766E",
  "Đã hủy": "#DC2626",
});

function isHexColor(value) {
  return /^#[0-9a-fA-F]{6}$/.test(String(value || ""));
}

export function resolveContractStatusColor(status, catalog = []) {
  const name = String(status || "").trim();
  const configured = Array.isArray(catalog)
    ? catalog.find((item) => String(item?.name || "").trim() === name)
    : null;
  const configuredColor = String(configured?.color || "");
  const sharedColor = CONTRACT_STATUS_COLORS[name];
  if (
    sharedColor
    && (!isHexColor(configuredColor)
      || configuredColor.toUpperCase() === LEGACY_DEFAULT_CONTRACT_STATUS_COLORS[name])
  ) {
    return sharedColor;
  }
  return isHexColor(configuredColor) ? configuredColor : sharedColor || STATUS_COLORS.neutral;
}
