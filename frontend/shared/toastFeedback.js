const TOAST_TYPES = new Set(["success", "error", "warning"]);

const TOAST_TITLES = Object.freeze({
  success: "Thành công",
  error: "Thất bại",
  warning: "Cảnh báo"
});

const DEFAULT_MESSAGES = Object.freeze({
  success: "Thao tác thành công.",
  error: "Thao tác thất bại. Vui lòng thử lại.",
  warning: "Vui lòng kiểm tra lại thông tin."
});

const SUCCESS_ACTIONS = Object.freeze([
  { pattern: /đổi mật khẩu/u, message: "Đổi mật khẩu thành công." },
  { pattern: /(?:đổi|thay đổi|xác minh).*email/u, message: "Đổi email thành công." },
  { pattern: /đăng nhập/u, message: "Đăng nhập thành công." },
  { pattern: /đăng xuất/u, message: "Đăng xuất thành công." },
  { pattern: /chuyển (?:đổi )?(?:không gian|tổ chức|vai trò)/u, message: "Chuyển đổi thành công." },
  { pattern: /(?:mở thầu|tiến hành mở thầu)/u, message: "Mở thầu thành công." },
  { pattern: /phê duyệt/u, message: "Phê duyệt thành công." },
  { pattern: /phát hành/u, message: "Phát hành thành công." },
  { pattern: /khôi phục/u, message: "Khôi phục thành công." },
  { pattern: /mở khóa/u, message: "Mở khóa thành công." },
  { pattern: /khóa/u, message: "Khóa thành công." },
  { pattern: /gia hạn/u, message: "Gia hạn thành công." },
  { pattern: /sao chép/u, message: "Sao chép thành công." },
  { pattern: /(?:tải lên|upload)/u, message: "Tải lên thành công." },
  { pattern: /(?:tải xuống|download)/u, message: "Tải xuống thành công." },
  { pattern: /(?:xuất|export).*(?:word|excel|tệp|file)/u, message: "Xuất tệp thành công." },
  { pattern: /(?:nhập|import).*(?:excel|dữ liệu|dòng)/u, message: "Nhập dữ liệu thành công." },
  { pattern: /đã xử lý.*dòng/u, message: "Nhập dữ liệu thành công." },
  { pattern: /(?:rời|gỡ khỏi).*tổ chức/u, message: "Xóa nhân viên khỏi tổ chức thành công." },
  { pattern: /(?:xóa|loại bỏ)/u, message: "Xóa thành công." },
  { pattern: /(?:thêm lại|khôi phục).*nhân viên/u, message: "Thêm lại nhân viên thành công." },
  { pattern: /(?:thêm|tạo).*nhân viên/u, message: "Thêm nhân viên thành công." },
  { pattern: /(?:thêm|tạo).*kế hoạch/u, message: "Thêm kế hoạch thành công." },
  { pattern: /(?:thêm|tạo).*gói thầu/u, message: "Thêm gói thầu thành công." },
  { pattern: /(?:thêm|tạo)/u, message: "Thêm thành công." },
  { pattern: /(?:cập nhật|thay đổi|chỉnh sửa|ghi đè|áp dụng|đồng bộ)/u, message: "Cập nhật thành công." }
]);

const DELETE_ENTITIES = Object.freeze([
  { pattern: /xóa (?:toàn bộ )?(?:các )?phiên bản .*hợp đồng/u, message: "Xóa hợp đồng thành công." },
  { pattern: /xóa .*kế hoạch/u, message: "Xóa kế hoạch thành công." },
  { pattern: /xóa .*gói thầu/u, message: "Xóa gói thầu thành công." },
  { pattern: /xóa .*chủ đầu tư/u, message: "Xóa chủ đầu tư thành công." },
  { pattern: /xóa .*nhà thầu/u, message: "Xóa nhà thầu thành công." },
  { pattern: /xóa .*chuyên gia/u, message: "Xóa chuyên gia thành công." },
  { pattern: /xóa .*hợp đồng/u, message: "Xóa hợp đồng thành công." },
  { pattern: /xóa .*phân công/u, message: "Xóa phân công thành công." },
  { pattern: /xóa .*thông tin mở thầu/u, message: "Xóa thông tin mở thầu thành công." },
  { pattern: /xóa .*trạng thái hồ sơ/u, message: "Xóa trạng thái hồ sơ thành công." }
]);

const TOAST_ENTITIES = Object.freeze([
  { pattern: /báo cáo đánh giá/u, label: "báo cáo đánh giá" },
  { pattern: /phê duyệt.*(?:danh sách nhà thầu|kết quả)/u, label: "kết quả gói thầu" },
  { pattern: /kết quả (?:lựa chọn nhà thầu|trúng thầu)/u, label: "kết quả gói thầu" },
  { pattern: /(?:biên bản )?mở thầu/u, label: "thông tin mở thầu" },
  { pattern: /(?:hồ sơ )?mời thầu|hsmt/u, label: "hồ sơ mời thầu" },
  { pattern: /phân quyền|ma trận thầu/u, label: "phân quyền" },
  { pattern: /thiết lập tài khoản|thông tin tài khoản/u, label: "thiết lập tài khoản" },
  { pattern: /vai trò người dùng/u, label: "vai trò người dùng" },
  { pattern: /tài khoản (?:người dùng|nhân viên)/u, label: "tài khoản" },
  { pattern: /thông tin cá nhân/u, label: "thông tin cá nhân" },
  { pattern: /nhân viên|nhân sự/u, label: "nhân viên" },
  { pattern: /gói (?:đăng ký|dịch vụ|cước)/u, label: "gói dịch vụ" },
  { pattern: /tổ chức/u, label: "tổ chức" },
  { pattern: /chủ đầu tư/u, label: "chủ đầu tư" },
  { pattern: /nhà thầu/u, label: "nhà thầu" },
  { pattern: /chuyên gia/u, label: "chuyên gia" },
  { pattern: /gói thầu/u, label: "gói thầu" },
  { pattern: /kế hoạch(?: lựa chọn nhà thầu| lcnt)?/u, label: "kế hoạch" },
  { pattern: /hợp đồng/u, label: "hợp đồng" },
  { pattern: /timeline/u, label: "timeline" },
  { pattern: /biểu mẫu(?: word)?|mẫu/u, label: "biểu mẫu" },
  { pattern: /trạng thái hồ sơ/u, label: "trạng thái hồ sơ" },
  { pattern: /phân công/u, label: "phân công" },
  { pattern: /phần lô/u, label: "phần lô" },
  { pattern: /biến (?:ánh xạ|danh sách|kết quả)/u, label: "biến Word" },
  { pattern: /dữ liệu|dòng|excel|file/u, label: "dữ liệu" }
]);

const SAVE_ENTITIES = Object.freeze([
  { pattern: /kế hoạch/u, label: "kế hoạch" },
  { pattern: /gói thầu/u, label: "gói thầu" },
  { pattern: /hợp đồng/u, label: "hợp đồng" },
  { pattern: /timeline/u, label: "timeline" },
  { pattern: /thông tin mời thầu/u, label: "thông tin mời thầu" },
  { pattern: /báo cáo/u, label: "báo cáo" },
  { pattern: /biểu mẫu/u, label: "biểu mẫu" },
  { pattern: /thiết lập tài khoản/u, label: "thiết lập tài khoản" },
  { pattern: /phân quyền/u, label: "phân quyền" }
]);

const FAILURE_ACTIONS = Object.freeze([
  { pattern: /(?:xóa|loại bỏ)/u, action: "Xóa" },
  { pattern: /(?:cập nhật|thay đổi|chỉnh sửa)/u, action: "Cập nhật" },
  { pattern: /(?:thêm lại|khôi phục)/u, action: "Khôi phục" },
  { pattern: /(?:thêm|tạo)/u, action: "Thêm" },
  { pattern: /(?:phê duyệt|duyệt)/u, action: "Phê duyệt" },
  { pattern: /phát hành/u, action: "Phát hành" },
  { pattern: /(?:mở thầu|tiến hành mở thầu)/u, action: "Mở thầu" },
  { pattern: /(?:lưu|đồng bộ|ghi nhận)/u, action: "Lưu" },
  { pattern: /(?:tải danh sách|tải dữ liệu|khởi tạo dữ liệu)/u, action: "Tải dữ liệu" },
  { pattern: /(?:tải lên|upload)/u, action: "Tải lên" },
  { pattern: /(?:tải xuống|download)/u, action: "Tải xuống" },
  { pattern: /(?:xuất|export)/u, action: "Xuất tệp" },
  { pattern: /(?:nhập|import)/u, action: "Nhập dữ liệu" },
  { pattern: /(?:đăng nhập|xác thực)/u, action: "Đăng nhập" },
  { pattern: /(?:kết nối|máy chủ|server|network|fetch)/u, action: "Kết nối" }
]);

function cleanMessage(message) {
  return String(message || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSuccessMessage(message) {
  const comparable = message.toLocaleLowerCase("vi-VN");
  const hasSaveAction = /(?:^|\s)(?:đã\s+)?lưu(?!\s+trữ)(?=\s|[.!?,]|$)/u.test(comparable);
  const entity = TOAST_ENTITIES.find(({ pattern }) => pattern.test(comparable))?.label;

  if (hasSaveAction && /phê duyệt/u.test(comparable)) {
    return entity ? `Phê duyệt ${entity} thành công.` : "Phê duyệt thành công.";
  }

  const deletedEntity = DELETE_ENTITIES.find(({ pattern }) => pattern.test(comparable));
  if (deletedEntity) return deletedEntity.message;

  if (entity) {
    if (/(?:nhập|import|xử lý).*?(?:dòng|dữ liệu|excel)/u.test(comparable)) return `Nhập ${entity} thành công.`;
    if (/(?:thêm lại|khôi phục)/u.test(comparable)) return `Khôi phục ${entity} thành công.`;
    if (/(?:thêm|tạo)(?: mới)?/u.test(comparable)) return `Thêm ${entity} thành công.`;
    if (/(?:cập nhật|thay đổi|chỉnh sửa|ghi đè|áp dụng|đồng bộ)/u.test(comparable)) {
      return `Cập nhật ${entity} thành công.`;
    }
    if (/(?:mở thầu|tiến hành mở thầu)/u.test(comparable)) return `Mở thầu ${entity} thành công.`;
    if (/(?:phê duyệt|duyệt)/u.test(comparable)) return `Phê duyệt ${entity} thành công.`;
    if (/(?:phát hành)/u.test(comparable)) return `Phát hành ${entity} thành công.`;
    if (/(?:tải lên|upload)/u.test(comparable)) return `Tải lên ${entity} thành công.`;
    if (/(?:tải xuống|download)/u.test(comparable)) return `Tải xuống ${entity} thành công.`;
    if (/(?:xuất|export)/u.test(comparable)) return `Xuất ${entity} thành công.`;
    if (/(?:sao chép|copy)/u.test(comparable)) return `Sao chép ${entity} thành công.`;
    if (/(?:mở khóa|unlock)/u.test(comparable)) return `Mở khóa ${entity} thành công.`;
    if (/(?:khóa|lock)/u.test(comparable)) return `Khóa ${entity} thành công.`;
    if (/(?:gia hạn)/u.test(comparable)) return `Gia hạn ${entity} thành công.`;
    if (hasSaveAction) return `Lưu ${entity} thành công.`;
  }

  if (hasSaveAction) {
    const entity = SAVE_ENTITIES.find(({ pattern }) => pattern.test(comparable));
    return entity ? `Lưu ${entity.label} thành công.` : "Lưu thành công.";
  }

  const action = SUCCESS_ACTIONS.find(({ pattern }) => pattern.test(comparable));
  return action?.message || DEFAULT_MESSAGES.success;
}

function normalizeErrorMessage(message) {
  const comparable = message.toLocaleLowerCase("vi-VN");
  if (/(?:http|request\s*id|traceback|syntaxerror|exception|\/api\/|máy chủ|server|network|fetch)/u.test(comparable)) {
    return "Kết nối thất bại. Vui lòng thử lại.";
  }
  if (message.length <= 120 && /(?:không hợp lệ|vui lòng nhập|bắt buộc|không được để trống)/u.test(comparable)) {
    return message;
  }
  const match = FAILURE_ACTIONS.find(({ pattern }) => pattern.test(comparable));
  if (match) {
    const entity = TOAST_ENTITIES.find(({ pattern }) => pattern.test(comparable))?.label;
    return `${match.action}${entity ? ` ${entity}` : ""} thất bại. Vui lòng thử lại.`;
  }
  return message && message.length <= 120 ? message : DEFAULT_MESSAGES.error;
}

function normalizeWarningMessage(message) {
  if (!message) return DEFAULT_MESSAGES.warning;
  const comparable = message.toLocaleLowerCase("vi-VN");
  if (/dữ liệu đã thay đổi/u.test(comparable)) {
    return "Dữ liệu đã thay đổi. Vui lòng kiểm tra và lưu lại.";
  }

  if (message.length <= 120) return message;
  const firstSentence = message.match(/^.*?[.!?](?:\s|$)/u)?.[0]?.trim() || message;
  if (firstSentence.length <= 120) return firstSentence;
  return `${firstSentence.slice(0, 117).trimEnd()}...`;
}

/**
 * Keep transient feedback short and user-facing. Diagnostics and secondary
 * details belong in logs or dialogs, not in a toast.
 */
export function normalizeToastFeedback(message, type = "warning") {
  const normalizedType = TOAST_TYPES.has(String(type)) ? String(type) : "warning";
  const cleanedMessage = cleanMessage(message);
  const normalizedMessage = normalizedType === "success"
    ? normalizeSuccessMessage(cleanedMessage)
    : normalizedType === "error"
      ? normalizeErrorMessage(cleanedMessage)
      : normalizeWarningMessage(cleanedMessage);

  return {
    title: TOAST_TITLES[normalizedType],
    message: normalizedMessage,
    type: normalizedType
  };
}
