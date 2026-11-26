# BidHub — Báo cáo kỹ thuật và kịch bản demo

Bản review 25/11/2026, dự án môn Web Application Development. Nội dung do AI
hỗ trợ tổng hợp từ repo, cần Bảo/Đạt/Phú duyệt trước khi dùng nộp bài.
Nguồn chính: README, ARCHITECTURE, TEAM-PLAN, API-CONTRACT, DB-DOMAIN, RUNBOOK
và [báo cáo nghiệm thu 25/11](ACCEPTANCE-2026-11-25.md).

## Bài toán và phạm vi

Ứng dụng đấu giá realtime cho phép thành viên tạo/công bố phiên, tìm/đọc
phiên, trả giá, theo dõi lịch sử và xem kết quả. Admin tra cứu và hủy phiên
hoặc vô hiệu hóa tài khoản với reason/audit. Watchlist, upload và email
không thuộc gate MVP hiện tại.

Phân công theo README: Bảo phụ trách lead/hạ tầng/realtime/tích hợp;
Đạt phụ trách backend/database/auth và luật đấu giá; Phú phụ trách frontend,
tích hợp UI và luồng E2E. Code/test/tài liệu có AI hỗ trợ; không suy ra
toàn bộ sản phẩm do một thành viên tự thực hiện.

## Kiến trúc

Browser React/TypeScript gọi HTTP API và nhận snapshot Socket.IO cùng origin.
Nginx phục vụ web/SPA và proxy API/socket. Express thực hiện session, CSRF,
validation và transaction PostgreSQL; một API process chạy lifecycle scheduler.
PostgreSQL dùng Docker network riêng; Prometheus/Grafana hỗ trợ lab monitoring.
Mô hình một host/process chưa có tính sẵn sàng cao hoặc multi-instance.

Auth dùng Argon2 và cookie session với token hash trong DB. Session/role/
disabled account đọc phía server; quyền owner/admin và visibility dùng chung
REST/socket. Không nhận userId hoặc role tùy ý từ client.

## Tính đúng của bid và kết quả

Giá là integer VND trong BIGINT, truyền JSON dạng string. Bid khóa user rồi
auction trong transaction, lấy thời gian DB sau lock; kiểm tra ACTIVE,
deadline, self-bid, minimum price và disabled. Idempotency key thuộc user:
cùng auction/amount trả bidId cũ cùng snapshot mới nhất; đổi payload trả
conflict. Snapshot chỉ phát sau commit, không phát lại khi replay.

Bid hợp lệ trong 30 giây cuối đảm bảo ít nhất 60 giây còn lại. Lifecycle
dùng cùng lock với bid/cancel, chốt đúng một result. Không bid thì winner/
winning bid/final price cùng null; countdown về 0 không tự tuyên bố winner.
Client bỏ snapshot version cũ, reconnect phải GET lại; socket lỗi thì REST
poll 15 giây, HTTP bid vẫn dùng idempotency key.

Migration 002 bổ sung CHECK đủ bộ winner/bid/price và version nonnegative;
migration 003 lưu dấu đã công bố để giữ đúng visibility sau cancel. DB chưa
có composite FK ràng buộc result với auction của winning bid; service
lifecycle hiện bảo vệ quan hệ này. Không ghi schema là bảo vệ mọi invariant.

## Cách kiểm chứng

[Báo cáo 25/11](ACCEPTANCE-2026-11-25.md) ghi môi trường, lệnh và kết quả
local: 34 DB/contract, 11 backend, 1 retention, 6 E2E DB mới đều pass.
E2E desktop/mobile dùng API/PostgreSQL thật, tách khỏi preview fixtures và
realtime fixture suites. Test điều chỉnh deadline chỉ trong dữ liệu riêng.

RUNBOOK lưu các bằng chứng CI cũ cho Docker/Nginx, TLS loopback, reconnect,
restart/catch-up, load và populated restore. Số đo lab cũ không phải
throughput hoặc SLA production. Phiên 25/11 chưa chạy lại Docker/TLS và
CI branch cần đối chiếu theo exact SHA ở PR; kết quả local không thay CI.

Slide chỉnh sửa được: [bản review cập nhật 6 trang](slides/bidhub-demo-review-2026-11-26.pptx).
Đã render/kiểm tra bố cục và kiểm tra cấu trúc/import file; chưa mở nghiệm thu
trong PowerPoint của nhóm. Công cụ Spaces lỗi runtime nên dùng file local.

## Kịch bản demo 8–10 phút

Chuẩn bị ba browser/profile riêng seller/bidder/admin, hai bidder nếu có
thêm cửa sổ. Dùng dữ liệu giả, mật khẩu qua kênh riêng. Ghi exact SHA,
CI link và môi trường trước rehearsal. Local fallback cần được thử trước.

1. **Phú — 2 phút:** list/search/detail, đăng ký/login, tạo draft; seller
   publish qua confirmation rồi bidder thấy phiên. Chỉ rõ route preview
   dùng mock khác với route gọi API.
2. **Đạt — 3 phút:** hai bidder gửi cùng giá; một thành công, giá cũ bị
   409 và vẫn giữ input. Sửa đúng minimum, giải thích transaction,
   idempotency và history không trùng.
3. **Đạt + Bảo — 1 phút:** bid cuối phiên gia hạn; chờ scheduler chốt,
   hai browser cùng winner; demo no-bid không winner bằng phiên chuẩn bị sẵn.
4. **Bảo — 2 phút:** ngắt/rejoin socket để resync, giải thích HTTP write/
   version; trình bày CI, private DB, backup và bằng chứng restore/rollback
   thực tế của đúng môi trường.
5. **Cả ba — 1–2 phút:** mỗi người trình bày phần mình, đóng góp AI hỗ trợ,
   giới hạn hiện tại và các câu hỏi.

Không đưa SQL thay deadline của E2E vào DB staging khi đang demo thật.
Chuẩn bị phiên ngắn từ đầu để demo luật anti-sniping.

## Điều kiện chốt bản nộp

- BH-02 có xác nhận của ba thành viên về DB/API/rules/visibility.
- BH-20 có CI đúng SHA và kiểm tra staging/phone/keyboard của Phú.
- BH-17 có staging HTTPS/WSS, cookie và reachability do Bảo tự nghiệm thu.
- BH-21 nhóm review report/slide và rehearsal có kết quả.
- BH-22 Bảo tự review secret, backup/restore/rollback và tag sau các gate.

Checklist cụ thể tại [ACCEPTANCE-2026-11-25.md](ACCEPTANCE-2026-11-25.md).
Đối chiếu vận hành mới nhất tại [bàn giao 26/11](COMPLETION-2026-11-26.md):
HTTPS/WSS staging và renewal dry-run pass; restore DB riêng khớp fingerprint,
rollback cô lập trên Azure pass trong 31 giây, lịch backup hàng ngày đã bật.
Các checkbox tự thực hiện cũ là hướng dẫn lịch sử trước khi người dùng ủy quyền
agent triển khai, không phải xác nhận Bảo tự làm độc lập. ADMIN thật còn chờ
email tài khoản, review và rehearsal nhóm chưa có xác nhận.

Ngày 22/11 đã qua; RC 29/11 và bàn giao 06/12 là mốc dự kiến trong kế hoạch,
cần đối chiếu deadline môn học thực tế. Bản này chưa xác nhận release.
