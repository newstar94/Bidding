# Kho kiến thức và RAG

Kho tri thức local dùng hai bảng `ai_knowledge_documents` và `ai_knowledge_chunks`. Registry giữ mọi phiên bản để audit, chỉ một phiên bản của cùng số hiệu/loại/phạm vi ở trạng thái `active`. Retrieval luôn lọc tài liệu global hoặc đúng organization trước khi xếp hạng.

## Loại tệp và metadata

Ingestion hỗ trợ UTF-8 Markdown, TXT và DOCX, tối đa 20 MB. Metadata JSON bắt buộc có `title`, `document_number`, `issuing_authority`, `document_type`, `issued_date`, `effective_from`, `effective_to`, `version`, `status=approved`, `organization_id`, `confidentiality` và `source_url`.

`document_type` nhận `LEGAL_DOCUMENT`, `INTERNAL_POLICY`, `PROCESS_GUIDE`, `BIDDINGFLOW_HELP`, `TEMPLATE_GUIDE`, `APPROVED_QA`. Tài liệu global đặt `organization_id=null`; tài liệu `confidential` bắt buộc thuộc một organization.

## Kiểm tra và kích hoạt

Kiểm tra tài liệu mà chưa ghi database:

```powershell
python scripts/ingest_ai_knowledge.py `
  --file docs/ai/knowledge/BIDDINGFLOW_APP_GUIDE.md `
  --metadata docs/ai/knowledge/BIDDINGFLOW_APP_GUIDE.metadata.json `
  --dry-run
```

Sau khi chuyên gia duyệt, dùng ID tài khoản BiddingFlow của người duyệt:

```powershell
python scripts/ingest_ai_knowledge.py `
  --file docs/ai/knowledge/BIDDINGFLOW_APP_GUIDE.md `
  --metadata docs/ai/knowledge/BIDDINGFLOW_APP_GUIDE.metadata.json `
  --approved-by <user-id>
```

Có thể thay bằng `--approved-by-username <tên-đăng-nhập>`; script chỉ dùng tên này để tra ID người duyệt và không lưu tên đăng nhập vào chunk.

Môi trường local mới có đúng một Super Admin có thể seed tài liệu mẫu bằng `--approved-by-sole-super-admin`. Tùy chọn này từ chối chạy nếu có 0 hoặc từ 2 Super Admin trở lên; môi trường vận hành nên luôn chỉ rõ ID hoặc tên đăng nhập người duyệt.

Script kiểm tra extension, kích thước, UTF-8/DOCX, ngày hiệu lực, URL, nội dung instruction đáng ngờ và `content_hash`. Nội dung trùng trong cùng phạm vi bị từ chối. Phiên bản active trước đó được chuyển thành `retired` trong cùng transaction.

## Retrieval và citation

Mode `app_help` và `procurement_advice` truy xuất local theo từ khóa, giới hạn scope rồi mới đưa đoạn liên quan vào model dưới nhãn `untrustedKnowledge`. Citation `[S1]`, `[S2]` chỉ được tạo từ metadata backend gồm document id, tiêu đề, số hiệu, version, hiệu lực, section/page/chunk và source URL. Tool dữ liệu vẫn kiểm tra quyền độc lập với nội dung tài liệu.
