import assert from "node:assert/strict";
import test from "node:test";

import {
  parseMuasamcongDetailedEvaluationWorkbook,
} from "../../frontend/packages/detailedEvaluationExcel.js";

const validitySheet = {
  name: "Mẫu số 01",
  rows: [
    ["ĐÁNH GIÁ TÍNH HỢP LỆ"],
    ["STT", "Nội dung đánh giá trong E-HSMT"],
    ["1", "Bảo đảm dự thầu(1)", "x", "", "x", ""],
    ["2", "Tư cách hợp lệ theo quy định tại khoản 1 Điều 5 của Luật đấu thầu", "x", "", "x", ""],
    ["2.1", "Nhà thầu là tổ chức đáp ứng đủ các điều kiện sau đây:", "x", "", "x", ""],
    ["2.1.1", "Hạch toán tài chính độc lập(3)", "x", "", "x", ""],
    ["2.1.2", "Không đang trong quá trình thực hiện thủ tục giải thể hoặc bị thu hồi giấy chứng nhận đăng ký doanh nghiệp(3)", "x", "", "x", ""],
    ["2.1.3", "Bảo đảm cạnh tranh trong đấu thầu(3)", "x", "", "x", ""],
    ["2.1.4", "Không đang trong thời gian bị cấm tham dự thầu(3)", "x", "", "x", ""],
    ["2.1.5", "Không đang bị truy cứu trách nhiệm hình sự(3)", "x", "", "x", ""],
    ["3", "Không trong trạng thái bị tạm ngừng, chấm dứt tham gia Hệ thống(6)", "x", "", "x", ""],
    ["4", "Trong thời hạn 03 năm trước thời điểm đóng thầu, nhà thầu không có nhân sự bị kết án", "x", "", "x", ""],
  ],
};

test("detailed evaluation Excel import keeps every source row and its hierarchical STT", () => {
  const parsed = parseMuasamcongDetailedEvaluationWorkbook([validitySheet], {
    group: "validity",
    bid: { loaiNhaThau: "Độc lập" },
  });

  assert.deepEqual(
    parsed.criteria.map((criterion) => criterion.stt),
    ["1", "2", "2.1", "2.1.1", "2.1.2", "2.1.3", "2.1.4", "2.1.5", "3", "4"],
  );
  assert.equal(parsed.criteria[0].name, "Bảo đảm dự thầu");
  assert.equal(parsed.criteria[3].name, "Hạch toán tài chính độc lập");
});
