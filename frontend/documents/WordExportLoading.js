import { beginLongTaskLoading } from "../shared/LongTaskLoading.js";

const WORD_EXPORT_LOADING_STAGES = Object.freeze([
  Object.freeze({
    key: "prepare",
    label: "Chuẩn bị dữ liệu",
    message: "Hệ thống đang chốt dữ liệu mới nhất để xuất Word.",
  }),
  Object.freeze({
    key: "render",
    label: "Tạo tài liệu",
    message: "Hệ thống đang tạo tài liệu Word ở chế độ nền.",
  }),
  Object.freeze({
    key: "download",
    label: "Hoàn tất tải xuống",
    message: "Tài liệu đã sẵn sàng và đang được tải xuống.",
  }),
]);

export function beginWordExportLoading({ detail = "", message = "" } = {}) {
  return beginLongTaskLoading({
    task: "word-publication",
    title: "Đang xuất bản Word",
    stages: WORD_EXPORT_LOADING_STAGES,
    initialStage: "prepare",
    message,
    detail,
  });
}
