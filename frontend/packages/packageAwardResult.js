import { persistAndSync } from "../shared/MutationService.js";

const GENERATED_REJECTION_REASONS = new Set([
  "Không đạt yêu cầu về tính hợp lệ",
  "Không đạt yêu cầu về năng lực, kinh nghiệm",
  "Không đạt yêu cầu kỹ thuật",
  "Nhà thầu xếp hạng 1 trúng thầu",
  "Đánh giá theo quy trình 2. Nhà thầu giá thấp hơn trúng thầu",
  ""
]);

export async function reopenPackageAwardResult(controller, pkg) {
  pkg.trangThai = "Đang chấm thầu";
  (controller.model.state.thongtinmothau || [])
    .filter((bid) => String(bid.goiThauId) === String(pkg.id))
    .forEach((bid) => {
      if (GENERATED_REJECTION_REASONS.has(String(bid.lyDoTruot || "").trim())) {
        bid.lyDoTruot = "";
      }
    });
  await persistAndSync(controller, ["thongtinmothau", "goithau"]);
  return pkg;
}
