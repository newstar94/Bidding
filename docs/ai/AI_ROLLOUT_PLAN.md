# Rollout plan

1. Deploy migration v40 (bao gồm storage AI từ v38 và registry tri thức) cùng code với `AI_ENABLED=false`.
2. Chạy unit/security/JS lint/build; xác nhận route cũ và schema drift xanh.
3. Bật `AI_PROVIDER=fake` cho internal smoke test UI/streaming/scope.
4. Dry-run rồi ingestion tài liệu BiddingFlow đã duyệt; xác minh citation và phạm vi organization.
5. Bật provider thật cho allowlist nhỏ, theo dõi latency, quota, permission denial và feedback.
6. Mở rộng theo workspace sau khi evaluation numeric/security đạt ngưỡng.
7. Nếu có lỗi, tắt feature flag; không ảnh hưởng nghiệp vụ hiện tại.
