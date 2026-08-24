import { beginLongTaskLoading } from "./LongTaskLoading.js";

const EXCEL_IMPORT_STAGES = Object.freeze([
  Object.freeze({
    key: "read",
    label: "Đọc file",
    message: "Hệ thống đang đọc file và nhận diện các trang tính.",
  }),
  Object.freeze({
    key: "validate",
    label: "Kiểm tra dữ liệu",
    message: "Hệ thống đang kiểm tra cấu trúc và tính hợp lệ của dữ liệu.",
  }),
  Object.freeze({
    key: "preview",
    label: "Chuẩn bị xem trước",
    message: "Dữ liệu đã được đọc. Hệ thống đang chuẩn bị bản xem trước.",
  }),
]);

export async function beginExcelImportLoading({ fileName = "", message = "" } = {}) {
  return beginLongTaskLoading({
    task: "excel-import",
    title: "Đang xử lý file Excel",
    stages: EXCEL_IMPORT_STAGES,
    initialStage: "read",
    message,
    detail: fileName ? `File: ${fileName}` : "",
  });
}
