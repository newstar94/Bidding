import { formatPartnerIdentityCode } from "../../app/domUtils.js";
import { calculateRankings } from "../../shared/BiddingCalculations.js";
import { getHolidays } from "../../shared/runtimeState.js";
import { escapeHtml, safeAttr } from "../../shared/view_helpers.js";
import { checkBidQualified } from "./PackageTabs.js";
import {
  getLowPriceRejectionReason,
  isLowPriceBidRejected,
} from "../bidEvaluationLowPriceRules.js";

// eslint-disable-next-line complexity -- Legacy approval markup is isolated for a dedicated refactor.
export function buildAwardResultApprovalMarkup(view, {
  gt,
  metadata,
  soBctdResult,
  ngayBctdResult,
  is1G2T2,
  bids = null,
  scopedDraft = null
}) {
        const kh2 = view.model.getLatestPlan(gt.keHoachId);
        const cdt = kh2 ? view.model.state.chudautu.find((c) => c.id === kh2.chuDauTuId) : null;
        const tenCdt = cdt ? cdt.tenChuDauTu : "Không rõ";
        const tenKhStr = kh2 ? kh2.tenKeHoach : "Không rõ";
        const allBids = Array.isArray(bids)
          ? [...bids]
          : view.model.state.thongtinmothau.filter((b) => String(b.goiThauId) === String(gt.id));
        allBids.sort((x, y) => {
          const lotX = String(x.maPhanLo || "").trim();
          const lotY = String(y.maPhanLo || "").trim();
          return lotX.localeCompare(lotY, "vi", { numeric: true });
        });
        const isDirectOrSpecial = gt.hinhThucLuaChon === "Chỉ định thầu rút gọn" || gt.hinhThucLuaChon === "Lựa chọn nhà thầu trong trường hợp đặc biệt";
        const danhGiaNangLuc = metadata.result.danhGiaNangLuc || "Không";
        const addWorkingDays = (startDateStr, days) => {
          if (!startDateStr) return "";
          let date = new Date(startDateStr);
          if (isNaN(date.getTime())) return "";
          const holidaysData = getHolidays();
          let direction = days < 0 ? -1 : 1;
          let remainingDays = Math.abs(days);
          while (remainingDays > 0) {
            date.setDate(date.getDate() + direction);
            let dayOfWeek = date.getDay();
            let dateStr = date.toISOString().split("T")[0];
            let yearStr = String(date.getFullYear());
            let isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
            const yearWorkingWeekends = holidaysData[yearStr]?.working_weekends || [];
            if (isWeekend && yearWorkingWeekends.includes(dateStr)) {
              isWeekend = false;
            }
            const yearHolidays = holidaysData[yearStr]?.holidays || [];
            const isHoliday = yearHolidays.includes(dateStr);
            if (!isWeekend && !isHoliday) {
              remainingDays--;
            }
          }
          return date.toISOString().split("T")[0];
        };
        let defaultYcbgi = "";
        let defaultGbgi = "";
        let defaultBcdg = "";
        let defaultMtt = "";
        let defaultTt = "";
        let defaultTkq = "";
        let defaultPdkq = "";
        if (kh2) {
          const isPheDuyetKeHoach = kh2.pheDuyet === "Kế hoạch";
          const anchorDate = isPheDuyetKeHoach ? kh2.ngayTrinhDuToan : kh2.ngayTrinhKeHoach;
          const approvalDate = kh2.ngayPheDuyet || "";
          defaultYcbgi = addWorkingDays(anchorDate, -5);
          defaultGbgi = addWorkingDays(anchorDate, -1);
          defaultBcdg = approvalDate;
          defaultMtt = approvalDate;
          defaultTt = addWorkingDays(approvalDate, 1);
          defaultTkq = defaultTt;
          defaultPdkq = defaultTkq;
        }
        const ngayYeuCauBaoGia = metadata.result.ngayYeuCauBaoGia ? view.model.formatForDateInput(metadata.result.ngayYeuCauBaoGia) : defaultYcbgi ? view.model.formatForDateInput(defaultYcbgi) : "";
        const ngayGuiBaoGia = metadata.result.ngayGuiBaoGia ? view.model.formatForDateInput(metadata.result.ngayGuiBaoGia) : defaultGbgi ? view.model.formatForDateInput(defaultGbgi) : "";
        const ngayBaoCaoDanhGiaNhaThau = metadata.result.ngayBaoCaoDanhGiaNhaThau ? view.model.formatForDateInput(metadata.result.ngayBaoCaoDanhGiaNhaThau) : defaultBcdg ? view.model.formatForDateInput(defaultBcdg) : "";
        const ngayMoiThuongThao = metadata.result.ngayMoiThuongThao ? view.model.formatForDateInput(metadata.result.ngayMoiThuongThao) : defaultMtt ? view.model.formatForDateInput(defaultMtt) : "";
        const ngayThuongThao = metadata.result.ngayThuongThao ? view.model.formatForDateInput(metadata.result.ngayThuongThao) : defaultTt ? view.model.formatForDateInput(defaultTt) : "";
        const ngayTrinhKetQua = metadata.result.ngayTrinhKetQua ? view.model.formatForDateInput(metadata.result.ngayTrinhKetQua) : defaultTkq ? view.model.formatForDateInput(defaultTkq) : "";
        const defaultDecDate = gt.ngayQuyetDinhKetQua ? view.model.formatForDateInput(gt.ngayQuyetDinhKetQua) : defaultPdkq ? view.model.formatForDateInput(defaultPdkq) : "";
        const { rankings, scores } = calculateRankings(gt, allBids);
        const isCombinedMethod = gt.phuongPhapDanhGia === "Kết hợp giữa kỹ thuật và giá";
        const getIsQualified = (bidItem) => {
          return checkBidQualified(bidItem, gt);
        };
        const lots = typeof gt.phanLoList === "string" ? JSON.parse(gt.phanLoList || "[]") : gt.phanLoList || [];
        let allBiddersHtml = "";
        if (isDirectOrSpecial && allBids.length === 0) {
          allBiddersHtml = `
                        <tr>
                            <td colspan="100%" class="bf-s-31769e5aab">
                                <i data-lucide="info" class="bf-s-26c21ccd54"></i>
                                Vui lòng nhập và lưu danh sách nhà thầu tại tab "Biên bản mở thầu" trước.
                            </td>
                        </tr>
                    `;
        } else {
          allBiddersHtml = allBids.map((b) => {
            const isQualified = getIsQualified(b);
            const isRejectedLowPrice = isLowPriceBidRejected(gt, b);
            let defaultReason = "";
            if (isRejectedLowPrice) {
              defaultReason = getLowPriceRejectionReason(gt, b);
            } else if (gt.quyTrinhDanhGia === "quytrinh2" && b.danhGiaKetLuan === "Không đánh giá") {
              defaultReason = "Đánh giá theo quy trình 2. Nhà thầu giá thấp hơn trúng thầu";
            } else if (!isQualified) {
              const hl = String(b.danhGiaHopLe || "").trim().toLowerCase();
              const nl = String(b.danhGiaNangLuc || "").trim().toLowerCase();
              if (hl !== "đạt") {
                defaultReason = "Không đạt yêu cầu về tính hợp lệ";
              } else if (nl !== "đạt") {
                defaultReason = "Không đạt yêu cầu về năng lực, kinh nghiệm";
              } else {
                defaultReason = "Không đạt yêu cầu kỹ thuật";
              }
            } else {
              defaultReason = "Nhà thầu xếp hạng 1 trúng thầu";
            }
            const standardReasons = [
              "Không đạt yêu cầu về tính hợp lệ",
              "Không đạt yêu cầu về năng lực, kinh nghiệm",
              "Không đạt yêu cầu kỹ thuật",
              "Nhà thầu xếp hạng 1 trúng thầu",
              "Đánh giá theo quy trình 2. Nhà thầu giá thấp hơn trúng thầu",
              ""
            ];
            const isStaleOrEmpty = !b.lyDoTruot || standardReasons.includes(b.lyDoTruot.trim());
            const displayReason = isRejectedLowPrice
              ? defaultReason
              : isStaleOrEmpty ? defaultReason : b.lyDoTruot;
            const defaultPrice = view.model.formatVND(b.giaDeNghiTrungThau || b.giaSauGiamGia || b.giaDuThau || "") || "";
            const defaultDurationPkg = b.thoiGianThucHien || gt.thoiGianThucHien || "";
            const defaultDurationCtr = b.thoiGianThucHienHopDong || (defaultDurationPkg ? defaultDurationPkg + " + Thời gian thực hiện các nghĩa vụ theo hợp đồng" : "");
            const rank = rankings[b.id];
            const score = scores[b.id];
            const rankDisplay = rank ? `Xếp hạng ${rank}` : isQualified ? "--" : "Không xếp hạng";
            let isRowWinner = false;
            if (isDirectOrSpecial) {
              isRowWinner = true;
            } else if (isQualified) {
              if (gt.phanLo === "Có") {
                const plList = lots;
                const currentLotCode = b.maPhanLo;
                const pl = plList.find((p) => p.maPhanLo === currentLotCode);
                if (pl && pl.nhaThauTrungThauId) {
                  isRowWinner = String(pl.nhaThauTrungThauId) === String(b.nhaThauId || b.id);
                } else {
                  isRowWinner = rank === 1;
                }
              } else {
                if (gt.nhaThauTrungThauId) {
                  isRowWinner = String(gt.nhaThauTrungThauId) === String(b.nhaThauId || b.id);
                } else {
                  isRowWinner = rank === 1;
                }
              }
            }
            return `
                            <tr data-approve-bid-id="${safeAttr(b.id)}" data-is-qualified="${isQualified}" data-nt-id="${safeAttr(b.nhaThauId || b.id)}"
                                data-default-price="${safeAttr(defaultPrice)}" data-default-duration-pkg="${safeAttr(defaultDurationPkg)}" data-default-duration-ctr="${safeAttr(defaultDurationCtr)}"
                                data-default-reason="${safeAttr(defaultReason)}">
                                ${gt.phanLo === "Có" ? `
                                    <td>
                                        ${escapeHtml(b.maPhanLo || "--")}
                                    </td>
                                    <td>
                                        ${escapeHtml(b.tenPhanLo || "--")}
                                    </td>
                                ` : ""}
                                ${isDirectOrSpecial ? `
                                     <td>
                                         ${escapeHtml(b.loaiNhaThau || "Độc lập")}
                                     </td>
                                 ` : ""}
                                <td>
                                ${escapeHtml(formatPartnerIdentityCode(b.maNhaThau || b.maDinhDanh, "--"))}
                                </td>
                                <td>
                                    ${escapeHtml(b.tenNhaThau || "--")}
                                    ${b.loaiNhaThau === "Liên danh" ? `
                                         <div class="row-jv-members-container bf-s-597bc8fb90">
                                              <button type="button" class="btn btn-outline btn-xs row-btn-manage-members bf-s-b87f5b7f7c">
                                                  <i data-lucide="users" class="bf-s-38e6fd7439"></i>
                                                  <span class="row-jv-btn-text">Xem thành viên liên danh (${(b.thanhVienLienDanh || []).filter((m) => m.vaiTro !== "Đứng đầu liên danh" && m.maSoThue !== b.maNhaThau).length})</span>
                                              </button>
                                         </div>
                                    ` : ""}
                                </td>
                                ${isCombinedMethod ? `
                                    <td class="bf-s-1742e3af74">${score !== void 0 && score !== null && !isNaN(score) && score > 0 ? score.toFixed(2) : "--"}</td>
                                ` : ""}
                                ${!isDirectOrSpecial ? `
                                    <td class="bf-s-81cfd3850c">${escapeHtml(rankDisplay)}</td>
                                    <td>
                                        <select class="form-control row-status-select bf-s-707df30c7a" ${!isQualified ? "disabled" : ""}>
                                            <option value="truot" ${!isRowWinner ? "selected" : ""}>Trượt thầu</option>
                                            ${isQualified ? `<option value="trung" ${isRowWinner ? "selected" : ""}>Trúng thầu</option>` : ""}
                                        </select>
                                    </td>
                                    <td>
                                        <input type="text" class="form-control row-ly-do-truot bf-s-aa4eecce78" value="${safeAttr(!isRowWinner ? displayReason : "")}" placeholder="Lý do trượt..." ${isRowWinner ? 'disabled style="background:#f1f5f9;"' : ""}>
                                    </td>
                                ` : ""}
                                <td>
                                    <input type="text" class="form-control row-gia-trung bf-s-aa4eecce78" value="${safeAttr(isRowWinner ? defaultPrice : "")}" placeholder="Giá trúng..." ${!isRowWinner ? 'disabled style="background:#f1f5f9;"' : ""}>
                                </td>
                                <td>
                                    <input type="text" class="form-control row-tg-goithau bf-s-aa4eecce78" value="${safeAttr(isRowWinner ? defaultDurationPkg : "")}" placeholder="Thời gian gói..." ${!isRowWinner ? 'disabled style="background:#f1f5f9;"' : ""}>
                                </td>
                                <td>
                                    <input type="text" class="form-control row-tg-hopdong bf-s-aa4eecce78" value="${safeAttr(isRowWinner ? defaultDurationCtr : "")}" placeholder="Thời gian HĐ..." ${!isRowWinner ? 'disabled style="background:#f1f5f9;"' : ""}>
                                </td>
                            </tr>
                        `;
          }).join("");
        }
        const html = `
                    <div class="bf-s-8bd3eb473c">
                        <div class="bf-s-5d398becec">Thông số Gói thầu</div>
                        <div class="bf-s-13b5590e90">
                            <div>• <strong class="bf-s-fcb5ddef65">Chủ đầu tư:</strong> <span class="text-dark fw-bold">${escapeHtml(tenCdt)}</span></div>
                            <div>• <strong class="bf-s-fcb5ddef65">Tên kế hoạch:</strong> <span class="text-dark fw-bold">${escapeHtml(tenKhStr)}</span></div>
                            <div>• <strong class="bf-s-fcb5ddef65">Lĩnh vực:</strong> ${escapeHtml(gt.linhVuc || "Hàng hóa")}</div>
                            <div>• <strong class="bf-s-fcb5ddef65">Phương thức LCNT:</strong> ${escapeHtml(gt.phuongThucLuaChon || "Một giai đoạn một túi hồ sơ")}</div>
                            <div>• <strong class="bf-s-fcb5ddef65">Phân lô:</strong> ${gt.phanLo === "Có" ? "Có chia phần lô" : "Không chia phần lô"}</div>
                            <div>• <strong class="bf-s-fcb5ddef65">Giá gói thầu:</strong> <span class="text-dark fw-bold">${view.model.formatCurrency(gt.giaGoiThau)}</span></div>
                            <div>• <strong class="bf-s-fcb5ddef65">Hình thức LCNT:</strong> ${escapeHtml(gt.hinhThucLuaChon || "--")}</div>
                            ${gt.phuongPhapDanhGia ? `<div>• <strong class="bf-s-fcb5ddef65">Phương pháp đánh giá:</strong> ${escapeHtml(gt.phuongPhapDanhGia)}${gt.phuongPhapDanhGia === "Kết hợp giữa kỹ thuật và giá" && gt.trongSoKyThuat ? ` (${escapeHtml(gt.trongSoKyThuat)}%)` : ""}</div>` : ""}
                            <div>• <strong class="bf-s-fcb5ddef65">Loại hợp đồng:</strong> ${escapeHtml(gt.loaiHopDong || "--")}</div>
                            <div>• <strong class="bf-s-fcb5ddef65">Thời gian thực hiện:</strong> ${escapeHtml(gt.thoiGianThucHien || "--")}</div>
                            <div>• <strong class="bf-s-fcb5ddef65">Nguồn vốn:</strong> ${escapeHtml(gt.nguonVon || "--")}</div>
                            ${!isDirectOrSpecial ? `
                            <div>• <strong class="bf-s-fcb5ddef65">Thời gian đóng thầu:</strong> ${gt.thoiGianDongThau ? view.model.formatDateWithTime(gt.thoiGianDongThau) : "--"}</div>
                            <div>• <strong class="bf-s-fcb5ddef65">${is1G2T2 ? "Thời gian mở E-HSĐXKT" : "Thời gian mở thầu"}:</strong> ${gt.thoiGianMoThau ? view.model.formatDateWithTime(gt.thoiGianMoThau) : "--"}</div>
                            ${is1G2T2 ? `<div>• <strong class="bf-s-fcb5ddef65">Thời gian mở E-HSĐXTC:</strong> ${gt.thoiGianMoEhsdxtc ? view.model.formatDateWithTime(gt.thoiGianMoEhsdxtc) : "Chưa mở"}</div>` : ""}
                            ` : ""}
                        </div>
                    </div>

                    ${scopedDraft ? `
                    <div class="alert alert-info scoped-result-context" role="status">
                        <div>
                            <strong>${scopedDraft.isWholePackage ? "Chỉnh sửa kết quả toàn gói thầu" : scopedDraft.isEditingOfficialResult ? `Chỉnh sửa kết quả Lần ${escapeHtml(scopedDraft.sequenceNo || "")}` : `Kết quả theo ${escapeHtml(scopedDraft.label || "đợt phần lô")}`}</strong>
                            <div>${scopedDraft.isWholePackage ? "Cập nhật kết quả chính thức đã phê duyệt của gói thầu." : `Chỉ hiển thị và lưu dữ liệu của ${escapeHtml(scopedDraft.lotCodes?.join(", ") || "các phần lô đã chọn")}. Các phần lô khác được giữ nguyên.`}</div>
                        </div>
                    </div>
                    ` : ""}

                    <div class="bf-s-95b5643dd9">
                        <div>
                            <h4 class="bf-s-ff3bca23d8">
                                ${scopedDraft?.isWholePackage ? "Chỉnh sửa kết quả LCNT" : scopedDraft?.isEditingOfficialResult ? `Chỉnh sửa kết quả LCNT Lần ${escapeHtml(scopedDraft.sequenceNo || "")}` : scopedDraft ? "Kết quả LCNT theo đợt phần lô" : "Phê duyệt kết quả Lựa chọn Nhà thầu (LCNT)"}
                            </h4>
                            <p class="text-muted bf-s-2089b6623a">
                                ${scopedDraft
                                  ? scopedDraft.isWholePackage
                                    ? "Cập nhật kết quả chính thức của gói thầu và lưu lại các thay đổi."
                                    : scopedDraft.isEditingOfficialResult
                                    ? "Cập nhật kết quả chính thức của đợt này. Kết quả các đợt và phần lô khác được giữ nguyên."
                                    : "Phê duyệt kết quả chính thức cho đúng các phần lô trong đợt hiện tại. Các phần lô còn lại sẽ được xử lý ở đợt sau."
                                  : gt.hinhThucLuaChon === "Chỉ định thầu rút gọn" || gt.hinhThucLuaChon === "Lựa chọn nhà thầu trong trường hợp đặc biệt"
                                    ? "Kiểm tra danh sách nhà thầu trúng thầu, điền QĐ phê duyệt và nhấn Phê duyệt &amp; Hoàn thành LCNT."
                                    : "Vui lòng nhập QĐ phê duyệt và chọn kết quả trúng thầu/trượt thầu cho từng nhà thầu bên dưới."}
                            </p>
                        </div>
                        <div class="bf-s-c896deef0d">
                            ${!isDirectOrSpecial && !scopedDraft ? `
                                <button class="btn-excel-action btn-sm bf-s-5a83b4877e" id="btn-result-export-excel-template">
                                    <i data-lucide="download"></i> Tải Excel Mẫu
                                </button>
                                <button class="btn-excel-action btn-sm bf-s-5a83b4877e" id="btn-result-import-excel">
                                    <i data-lucide="upload"></i> Nhập từ Excel
                                </button>
                            ` : ""}
                        </div>
                    </div>

                    ${isDirectOrSpecial ? `
                    <div class="bf-s-203e309e90">
                        <div class="bf-s-c9a9faa1a8">
                            <i data-lucide="check-circle" class="bf-s-c1f1f4a417"></i> Quyết định phê duyệt:
                        </div>
                        <div class="bf-s-342dc0e30b">
                            <div class="form-group bf-s-7f27e3bd8d">
                                <input type="text" id="award-decision-no" class="form-control bf-s-b3e44dc6d9" value="${safeAttr(gt.soQuyetDinhKetQua || "")}" placeholder="Số QĐ phê duyệt *">
                                <span class="error-text bf-s-65d1f1c3d7" class="field-error field-error-sm">Vui lòng nhập Số QĐ phê duyệt Kết quả!</span>
                            </div>
                            <div class="form-group bf-s-7f27e3bd8d">
                                <input type="text" id="award-decision-date" class="form-control flatpickr-date bf-s-b3e44dc6d9" value="${safeAttr(gt.ngayQuyetDinhKetQua ? view.model.formatForDateInput(gt.ngayQuyetDinhKetQua) : defaultDecDate ? defaultDecDate : "")}" placeholder="Ngày ký QĐ * (dd/MM/yyyy)">
                                <span class="error-text bf-s-65d1f1c3d7" class="field-error field-error-sm">Vui lòng chọn Ngày ký QĐ phê duyệt Kết quả!</span>
                            </div>
                        </div>
                    </div>

                    <div class="bf-s-c12ee1fe89">
                        <div class="bf-s-72451a63ba">
                            <span class="bf-s-ae2dc20bdc">
                                <i data-lucide="shield-check" class="bf-s-c1f1f4a417"></i> Đánh giá năng lực nhà thầu:
                            </span>
                            <label class="bf-s-95a4734e91">
                                <input type="radio" name="result-danh-gia-nang-luc" value="Có" ${danhGiaNangLuc === "Có" ? "checked" : ""}> Có
                            </label>
                            <label class="bf-s-95a4734e91">
                                <input type="radio" name="result-danh-gia-nang-luc" value="Không" ${danhGiaNangLuc === "Không" ? "checked" : ""}> Không
                            </label>
                        </div>

                        <div id="result-dates-grid" class="bf-s-d131bccf20">
                            <div class="form-group form-group-compact">
                                <label class="compact-field-label">Ngày yêu cầu báo giá <span class="text-danger">*</span></label>
                                <input type="text" id="date-yeu-cau-bao-gia" class="form-control flatpickr-date bf-s-64f2570670" value="${safeAttr(ngayYeuCauBaoGia)}" placeholder="dd/MM/yyyy">
                                <span class="error-text bf-s-65d1f1c3d7" class="field-error field-error-xs">Vui lòng nhập Ngày yêu cầu báo giá!</span>
                            </div>
                            <div class="form-group form-group-compact">
                                <label class="compact-field-label">Ngày gửi báo giá <span class="text-danger">*</span></label>
                                <input type="text" id="date-gui-bao-gia" class="form-control flatpickr-date bf-s-64f2570670" value="${safeAttr(ngayGuiBaoGia)}" placeholder="dd/MM/yyyy">
                                <span class="error-text bf-s-65d1f1c3d7" class="field-error field-error-xs">Vui lòng nhập Ngày gửi báo giá!</span>
                            </div>
                            <div class="form-group" id="container-date-bao-cao-danh-gia" style="margin-bottom: 0; display: ${danhGiaNangLuc === "Có" ? "block" : "none"};">
                                <label class="compact-field-label">Ngày báo cáo đánh giá nhà thầu <span class="text-danger">*</span></label>
                                <input type="text" id="date-bao-cao-danh-gia" class="form-control flatpickr-date bf-s-64f2570670" value="${safeAttr(ngayBaoCaoDanhGiaNhaThau)}" placeholder="dd/MM/yyyy">
                                <span class="error-text bf-s-65d1f1c3d7" class="field-error field-error-xs">Vui lòng nhập Ngày báo cáo đánh giá nhà thầu!</span>
                            </div>
                            <div class="form-group form-group-compact">
                                <label class="compact-field-label">Ngày mời thương thảo <span class="text-danger">*</span></label>
                                <input type="text" id="date-moi-thuong-thao" class="form-control flatpickr-date bf-s-64f2570670" value="${safeAttr(ngayMoiThuongThao)}" placeholder="dd/MM/yyyy">
                                <span class="error-text bf-s-65d1f1c3d7" class="field-error field-error-xs">Vui lòng nhập Ngày mời thương thảo!</span>
                            </div>
                            <div class="form-group form-group-compact">
                                <label class="compact-field-label">Ngày thương thảo <span class="text-danger">*</span></label>
                                <input type="text" id="date-thuong-thao" class="form-control flatpickr-date bf-s-64f2570670" value="${safeAttr(ngayThuongThao)}" placeholder="dd/MM/yyyy">
                                <span class="error-text bf-s-65d1f1c3d7" class="field-error field-error-xs">Vui lòng nhập Ngày thương thảo!</span>
                            </div>
                            <div class="form-group form-group-compact">
                                <label class="compact-field-label">Ngày trình kết quả <span class="text-danger">*</span></label>
                                <input type="text" id="date-trinh-ket-qua" class="form-control flatpickr-date bf-s-64f2570670" value="${safeAttr(ngayTrinhKetQua)}" placeholder="dd/MM/yyyy">
                                <span class="error-text bf-s-65d1f1c3d7" class="field-error field-error-xs">Vui lòng nhập Ngày trình kết quả!</span>
                            </div>
                        </div>
                    </div>
                    ` : `
                    <div class="bf-s-098565a16e">
                        <div class="bf-s-5d398becec">Quyết định phê duyệt Kết quả LCNT</div>
                        <div class="bf-s-ed07f78f34">
                            ${gt.hinhThucLuaChon !== "Chào hàng cạnh tranh" ? `
                            <div class="form-group form-group-compact">
                                <label class="field-label-strong">Số BCTĐ kết quả <span class="text-danger">*</span></label>
                                <input type="text" id="award-so-bctd" class="form-control bf-s-20e5983dc7" value="${safeAttr(soBctdResult)}" placeholder="Nhập số báo cáo thẩm định...">
                                <span class="error-text bf-s-65d1f1c3d7" class="field-error field-error-sm">Vui lòng nhập Số BCTĐ kết quả!</span>
                            </div>
                            <div class="form-group form-group-compact">
                                <label class="field-label-strong">Ngày BCTĐ kết quả <span class="text-danger">*</span></label>
                                <input type="text" id="award-ngay-bctd" class="form-control flatpickr-date bf-s-20e5983dc7" value="${safeAttr(ngayBctdResult ? view.model.formatForDateInput(ngayBctdResult) : "")}" placeholder="dd/MM/yyyy">
                                <span class="error-text bf-s-65d1f1c3d7" class="field-error field-error-sm">Vui lòng chọn Ngày BCTĐ kết quả!</span>
                            </div>
                            ` : ""}
                            <div class="form-group form-group-compact">
                                <label class="field-label-strong">Số QĐ phê duyệt Kết quả <span class="text-danger">*</span></label>
                                <input type="text" id="award-decision-no" class="form-control bf-s-20e5983dc7" value="${safeAttr(gt.soQuyetDinhKetQua || "")}" placeholder="Số QĐ Kết quả...">
                                <span class="error-text bf-s-65d1f1c3d7" class="field-error field-error-sm">Vui lòng nhập Số QĐ phê duyệt Kết quả!</span>
                            </div>
                            <div class="form-group form-group-compact">
                                <label class="field-label-strong">Ngày ký QĐ phê duyệt Kết quả <span class="text-danger">*</span></label>
                                <input type="text" id="award-decision-date" class="form-control flatpickr-date bf-s-20e5983dc7" value="${safeAttr(gt.ngayQuyetDinhKetQua ? view.model.formatForDateInput(gt.ngayQuyetDinhKetQua) : "")}" placeholder="dd/MM/yyyy">
                                <span class="error-text bf-s-65d1f1c3d7" class="field-error field-error-sm">Vui lòng chọn Ngày ký QĐ phê duyệt Kết quả!</span>
                            </div>
                        </div>
                    </div>
                    `}

                    <div class="bf-s-dd5fcc126c">
                        <h5 class="bf-s-a3c20b1dcc">
                            <i data-lucide="list"></i> ${isDirectOrSpecial ? "Danh sách nhà thầu trúng thầu" : "Danh sách nhà thầu tham dự &amp; Kết quả LCNT"}
                        </h5>
                    </div>

                    <div class="table-container bf-s-674afada30">
                        <table class="data-table bf-s-448ca2b6ae">
                            <thead>
                                <tr>
                                    ${gt.phanLo === "Có" ? `
                                        <th class="bf-s-ae54075f01">Mã phần lô</th>
                                        <th class="bf-s-ae54075f01">Tên phần lô</th>
                                    ` : ""}
                                    ${isDirectOrSpecial ? `<th class="bf-s-2811ee8f01">Loại nhà thầu</th>` : ""}
                                    <th class="bf-s-2811ee8f01">Mã nhà thầu</th>
                                    <th class="bf-s-a01153c965">Tên nhà thầu</th>
                                    ${isCombinedMethod ? `
                                        <th class="bf-s-59052b934c">Điểm tổng hợp</th>
                                    ` : ""}
                                    ${!isDirectOrSpecial ? `
                                        <th class="bf-s-59052b934c">Xếp hạng nhà thầu</th>
                                        <th class="bf-s-ae54075f01">Trúng thầu/trượt thầu</th>
                                        <th class="bf-s-c83ebbe56b">Lý do trượt</th>
                                    ` : ""}
                                    <th class="bf-s-2811ee8f01">Giá trúng thầu</th>
                                    <th class="bf-s-c83ebbe56b">Thời gian thực hiện gói thầu</th>
                                    <th class="bf-s-fa210469db">Thời gian thực hiện hợp đồng</th>
                                </tr>
                            </thead>
                            <tbody id="approve-bidders-tbody">
                                ${allBiddersHtml}
                            </tbody>
                        </table>
                    </div>

                    <div class="bf-s-004d08f0e5 official-result-form-actions">
                        ${scopedDraft?.isEditingOfficialResult ? `<button type="button" class="btn btn-outline-secondary bf-s-a9f6996ecf scoped-result-cancel-button" id="btn-cancel-official-result-edit">Hủy chỉnh sửa</button>` : ""}
                        <button class="btn btn-primary bf-s-a9f6996ecf" id="btn-approve-award">
                            <i data-lucide="${scopedDraft?.isEditingOfficialResult ? "save" : "check-circle2"}"></i> ${scopedDraft?.isEditingOfficialResult ? "Lưu thay đổi" : scopedDraft ? "Phê duyệt kết quả đợt" : "Phê duyệt & Hoàn thành LCNT"}
                        </button>
                    </div>
                `;
  return { html, allBids, isDirectOrSpecial };
}
