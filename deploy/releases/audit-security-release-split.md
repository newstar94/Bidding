# Tách release audit/security khỏi Word/partner/date

Hai nhóm thay đổi dùng hai release train và change record độc lập. Release A chỉ
chứa remediation audit/security đã được xác minh; Release B mới nhận các thay đổi
Word, làm giàu đối tác và định dạng ngày. Không deploy production nếu legal gate
chưa có dữ kiện thật được phê duyệt.

## Release A — audit/security

Mục tiêu gồm procurement authorization, active-persona visibility, operation GET,
`allVersions`, bootstrap/accessibility, CI browser, dependency, atomic audit,
metrics multiworker và V63 expand/contract. Release A phải được dựng từ một nhánh
release riêng; không cherry-pick nguyên commit `9a2becaf` vì commit này chứa cả
hunk audit lẫn Word/partner/date.

Các hunk/file Word, partner và date sau đây bị loại khỏi Release A:

- `backend/documents/**`;
- `backend/shared/date_utils.py`;
- `frontend/documents/**`;
- `docs/BiddingFlow_Mau_Kiem_Thu_Xuat_Word.docx`;
- `docs/adr/0005-explicit-word-publication-template-assignments.md`;
- các test chỉ xác nhận mapping Word, derived variable, partner enrichment hoặc
  presentation ngày tháng.

Nếu một file chứa cả hai nhóm thay đổi, release owner phải tách theo hunk và chạy
toàn bộ regression seam của file đó. Không dùng path allowlist để bỏ qua review
hunk hỗn hợp.

Gate của Release A:

- backend/security, JavaScript, browser và migration suites xanh;
- Chromium, Firefox và WebKit xanh;
- static/debt/CSS/build/audit dependency xanh;
- `npm run check:legal:production` vẫn là hard gate và phải chặn khi 27 legal
  facts còn thiếu hoặc chưa duyệt;
- V63 chỉ chạy Release 1 trên schema v62; migration v63 thuộc Release 2 riêng theo
  `deploy/runbooks/database-upgrade-v63.md`.

## Release B — Word/partner/date

Release B bắt đầu sau khi Release A đã ổn định và có change record riêng. Nhóm này
bao gồm các commit tính năng `bbcce25f`, `8ed4510a`, `3da90615` cùng mọi hunk Word,
partner/date được tách khỏi `9a2becaf`. Phải chạy lại document export, template
mapping, partner enrichment, money/date formatting và browser regression trước
khi phát hành.

## Bằng chứng composition bắt buộc

Mỗi release record phải lưu base SHA, head SHA, danh sách commit, `git diff
--name-status <base>..<head>`, danh sách file hỗn hợp đã tách hunk, kết quả gate và
checksum artifact. Không được dùng artifact của Release B làm artifact Release A
hoặc ngược lại.
