# Kho kiến thức và RAG

Kho kiến thức pháp luật chưa bật trong MVP. Khi triển khai, cần thêm registry document/version theo organization với metadata tối thiểu: loại tài liệu, số hiệu, cơ quan ban hành, ngày ban hành, hiệu lực từ/đến, version, content hash và source file.

Ingestion phải kiểm tra MIME/size/hash, loại prompt injection khỏi instruction context, giữ nội dung là dữ liệu, và áp document scope trước retrieval. Citation chỉ được tạo từ metadata do backend xác nhận: document id, title, number, version, effective dates, section/page/chunk và source URL.

Mode `procurement_advice` hiện trả lời minh bạch khi chưa có nguồn tài liệu; không tự trích dẫn từ trí nhớ model.
