# Prompt triển khai trung tâm Admin chung cho BiddingFlow và Chuẩn Hóa

Hãy chỉnh sửa mã nguồn của cả hai dự án để xây dựng một trung tâm quản trị chung đặt tại trang Admin của BiddingFlow:

- BiddingFlow: `D:\Bidding`.
- Chuẩn Hóa: `D:\Chuẩn Hóa`, repository `https://github.com/newstar94/Chuan-Hoa`.

## Mục tiêu và phạm vi

Tôi là chủ sản phẩm của cả hai ứng dụng và phê duyệt việc quản lý tài khoản, gói dịch vụ, thanh toán, kích hoạt và gia hạn Chuẩn Hóa từ trang Admin BiddingFlow.

Hai ứng dụng vẫn độc lập:

- Giữ riêng tài khoản đăng nhập khách hàng, dữ liệu, gói, thời hạn và entitlement.
- Thay đổi ở ứng dụng này không làm thay đổi ứng dụng kia.
- Không tự gộp tài khoản do trùng email, số điện thoại hoặc tên.
- Không triển khai SSO cho khách hàng trong nhiệm vụ này.
- Không chuyển backend/database Chuẩn Hóa vào Bidding.
- Không hợp nhất merchant, cổng thanh toán hoặc sổ giao dịch.
- Không đưa nội dung tài liệu Word lên trung tâm quản trị.

## Khảo sát trước khi sửa

Đọc `AGENTS.md`, tài liệu ngữ cảnh và ADR liên quan của từng repository. Kiểm tra `git status` và bảo toàn mọi thay đổi hiện có; không reset, checkout, dọn file hoặc ghi đè thay đổi ngoài phạm vi.

Kiểm tra thực tế đăng nhập, phiên, phân quyền admin, user/workspace, trial, entitlement, pricing, billing, webhook, activation, audit, idempotency, giao diện admin, API, test và triển khai của cả hai dự án. Trong Chuẩn Hóa phải dùng production source `src/ChuanHoa.Api`, không dùng prototype hoặc Development Admin làm production API.

Sau khảo sát, ghi ngắn kiến trúc và rủi ro rồi tiếp tục triển khai. Chỉ hỏi tôi khi cần quyết định nghiệp vụ chưa được phê duyệt.

## Kiến trúc bắt buộc

- Giao diện chung đặt trong Admin Bidding.
- Backend Bidding gọi server-to-server tới API quản trị Chuẩn Hóa qua lớp tích hợp riêng.
- Backend từng ứng dụng vẫn là nguồn sự thật cuối cùng cho dữ liệu và trạng thái của mình.
- Không truy cập trực tiếp database Chuẩn Hóa từ Bidding.
- Không sao chép logic thanh toán/kích hoạt Chuẩn Hóa sang Bidding.
- Không để secret server-to-server trong trình duyệt, bundle, log hoặc lỗi trả về.
- Dùng timeout, giới hạn retry và phân biệt timeout chưa xác định với thất bại chắc chắn.
- Không retry mù thao tác thay đổi dữ liệu.
- Ghi ADR về giao thức xác thực, định danh, audit, idempotency và rollback.

## Quyền quản trị

- Chỉ Super Admin Bidding được chủ sản phẩm chỉ định qua cấu hình/ánh xạ kiểm soát mới quản trị được Chuẩn Hóa.
- Không tự cấp quyền cho mọi admin hiện có và không tự chọn tài khoản thật.
- Khi chưa cấu hình ánh xạ, tính năng phải báo “chưa cấu hình” và không thực hiện thao tác.
- Admin tổ chức/workspace không tự động có quyền liên ứng dụng.
- Backend phải kiểm tra quyền, không chỉ ẩn nút giao diện.
- Chuẩn Hóa phải xác thực nguồn gọi và không tin actor/role từ trình duyệt.
- Audit phải ghi actor, ứng dụng đích, đối tượng, hành động, kết quả và correlation ID.
- Không tự bổ sung khóa toàn bộ khách hàng trên cả hai ứng dụng.

## Giao diện Admin Bidding

Tích hợp vào Admin hiện có, giữ Tabler/Bootstrap 5, HTML/CSS và JavaScript hiện hữu. Thêm bộ lọc ứng dụng: **Tất cả ứng dụng / BiddingFlow / Chuẩn Hóa**.

Cần hỗ trợ theo năng lực thực tế của backend:

1. Tổng quan theo từng ứng dụng và tổng hợp chỉ khi chỉ số tương thích.
2. Tài khoản: tìm kiếm, lọc, xem chi tiết và thao tác được phép.
3. Gói/bảng giá: quản lý riêng theo vòng đời từng ứng dụng.
4. Thanh toán: danh sách, chi tiết, trạng thái và mã đơn hàng.
5. Kích hoạt/gia hạn qua nghiệp vụ của ứng dụng đích.
6. Lịch sử quản trị liên ứng dụng.

Yêu cầu UI:

- Luôn hiển thị rõ ứng dụng trên bản ghi và dialog xác nhận.
- Phân trang, lọc và tìm kiếm phía máy chủ; không tải toàn bộ dữ liệu.
- Không gộp nhầm user hoặc doanh thu giữa hai ứng dụng.
- Phân biệt 0, chưa cấu hình, không hỗ trợ, lỗi kết nối và dữ liệu cũ.
- Một ứng dụng lỗi không làm hỏng ứng dụng còn lại.
- Không tạo số liệu giả hoặc giả lập thành công.
- Bảo đảm responsive và accessibility.

## Thanh toán và kích hoạt

Giữ nguyên đường đi thanh toán của từng ứng dụng:

- Webhook được xác minh tại backend sở hữu giao dịch.
- Redirect hoặc trạng thái trình duyệt không phải bằng chứng thanh toán.
- Không kích hoạt nhầm ứng dụng, user hoặc SKU.
- Webhook lặp, nhấp đúp, retry và chạy đồng thời phải idempotent.
- Chỉ báo thành công sau xác nhận lưu thành công từ backend đích.
- Nếu mất phản hồi sau lệnh, phải tra cứu trạng thái trước khi cho chạy lại.
- Không sửa hồi tố giá, quyền lợi, kỳ hạn hoặc đơn đã chốt.
- Giữ nguyên giấy phép có chữ ký, giới hạn thiết bị và offline lease của Chuẩn Hóa.

## Bảo toàn business contract Bidding

Không thay đổi masking, redaction, trường hiển thị, role, module permission, tenant, assignment, record authorization hoặc entitlement hiện hành ngoài quyền tích hợp admin đã nêu.

- Người có quyền đọc bản ghi vẫn xem đầy đủ dữ liệu như hiện tại.
- Quyền xuất Word chỉ điều khiển tạo/tải Word.
- Không tạo capability đọc dữ liệu nhạy cảm mới.
- Giữ tenant isolation, session checks và audit.
- Không sửa expected test để hợp thức hóa thay đổi nghiệp vụ chưa được duyệt.

## Cấu hình và triển khai

- Có feature/config bật tắt tích hợp.
- Thiếu cấu hình Chuẩn Hóa không làm hỏng Bidding.
- Không hard-code host production, mật khẩu hoặc API key.
- Chỉ gọi endpoint đích đã cấu hình và được kiểm soát ở server.
- Migration phải bổ sung tương thích, có rollback và không xóa dữ liệu.
- Không phá client/API Chuẩn Hóa đang phát hành.
- Giữ đường quản trị cũ cho đến khi parity được chứng minh.
- Không chạy thanh toán thật, migration production, phát hành hoặc deploy production.

## Kiểm thử bắt buộc

Bổ sung và chạy test ở cả hai repository cho:

- Xác thực server-to-server hợp lệ, thiếu, sai, hết hạn và bị thu hồi.
- Quyền Super Admin được ánh xạ và các trường hợp không được ánh xạ.
- Admin workspace không truy cập liên ứng dụng.
- Không nhầm khi trùng ID/email.
- Cô lập thay đổi giữa hai ứng dụng.
- Phân trang, lọc ứng dụng và lỗi từng nguồn.
- Kích hoạt/gia hạn thành công, từ chối, lặp, đồng thời và mất phản hồi.
- Webhook sai/lặp không cấp thêm quyền.
- Audit đầy đủ.
- Tắt tích hợp không làm hỏng Bidding.
- Không hồi quy quyền đọc dữ liệu, xuất Word, tenant/module/assignment/record scope.

Dùng dữ liệu thử và thanh toán giả. Không hạ coverage, bỏ test hoặc làm yếu bảo mật. Phân biệt lỗi có trước, lỗi do thay đổi và phần mới chỉ test bằng mock.

## ADR, tài liệu và báo cáo

Ghi ADR/business contract về ranh giới chung admin/riêng sản phẩm, ánh xạ quyền, nguồn sự thật, xác thực, audit, idempotency, compatibility, migration và rollback.

Báo cáo cuối cùng phải nêu:

1. Phần đã triển khai ở từng repository.
2. File chính đã thay đổi.
3. Test/gate đã chạy và kết quả thực tế.
4. Phần đã chứng minh xuyên hai backend và phần chỉ mock.
5. Các bước cấu hình tôi cần thực hiện.
6. Giới hạn, quyết định còn thiếu và phần chưa hoàn thành.
7. `git status --short` cuối cùng của cả hai repository.

Không tuyên bố production-ready nếu chưa đủ bằng chứng. Không tự commit, push, phát hành hoặc deploy production.
