# BidHub — Triển khai staging Azure/DuckDNS 25/11/2026

Website: https://bidhub.duckdns.org/

Cập nhật domain ngày 25/11/2026 theo yêu cầu bỏ tên cá nhân: cấp chứng chỉ
cho tên mới, đổi WEB_ORIGIN của API, cập nhật Nginx và chuyển hướng địa chỉ
trước sang tên mới. Dùng cùng VM/DB; không tạo thêm tài nguyên Azure hoặc
đổi spending limit. HTTPS readiness, UI đăng ký/publish/bid hai context,
cookie và polling/WebSocket đã chạy lại thành công trên domain mới.

Code được triển khai: `4c580660132fbd3173e44f907d60b10e6123db27`,
nhánh `Giabao2110/mvp-completion-20261125`, PR nháp #24.
Đây là bản staging môn học, có AI hỗ trợ triển khai theo yêu cầu mới của
người dùng ngày 25/11; không ghi là phần Bảo tự làm độc lập.

## Môi trường và kiểm soát chi tiêu

Azure for Students, Ubuntu 22.04, VM Standard_B2als_v2 tại East Asia,
OS disk Standard HDD 32 GB; Docker Compose PostgreSQL 17/API/web và host Nginx.
Ban đầu Southeast Asia bị policy Students từ chối; B2s tại East Asia thiếu
capacity. Mẫu B2als_v2 đã validate rồi mới tạo, deployment Succeeded.

Đã đọc policy Resource Manager: `quotaId=AzureForStudents_2018-01-01`,
`spendingLimit=On`, subscription Enabled. Portal ghi còn 100 USD credit,
59 ngày trước lúc tạo VM. Không nâng cấp Pay-As-You-Go, không bỏ spending
limit, không bật Azure Defender trả phí, NAT Gateway, managed database,
Marketplace add-on hoặc Log Analytics. Cloud Shell dùng chế độ không storage.

VM, IP và disk tiêu credit theo thời gian; đây không phải hosting miễn phí
vĩnh viễn. Chưa có hóa đơn cuối kỳ hay số tiền sử dụng đã quyết toán trong
phiên này. Giữ spending limit và không nâng cấp; khi credit/hạn ưu đãi kết
thúc, dịch vụ có thể bị tạm ngưng. Xóa các tài nguyên demo sau khi hết nhu cầu
để ngừng tiêu credit; deallocate VM vẫn để lại disk/IP.

## HTTPS và mạng

DuckDNS A record đã được đối chiếu với IP VM bằng DNS resolver công khai.
Chứng chỉ Let's Encrypt cấp thành công, hạn 23/02/2027; người dùng đã đồng ý
Subscriber Agreement riêng trước khi đăng ký. Certbot timer và deploy hook
reload Nginx đã được cấu hình. Kết quả dry-run gia hạn được đối chiếu riêng,
không suy ra từ việc timer bật.

Đã nhận kết quả dry-run của chứng chỉ tên cũ: “all simulated renewals
succeeded”. Chứng chỉ mới đã cấp thành công và có renewal config; chưa
chạy dry-run riêng lần hai cho tên mới.

NSG chỉ mở TCP 80 và 443. Từ máy Windows ngoài Azure: không kết nối được
tới 22, 3000, 5432, 8080 với timeout 2 giây/cổng. Đây là phép đo tại thời
điểm kiểm tra, không phải kiểm toán bảo mật toàn diện. DB/API không publish
host port; web container chỉ bind loopback. Secret DB sinh trên host, lưu
ngoài repo với quyền file hạn chế; không đưa vào evidence.

## Các kiểm tra thực chạy

- Curl kiểm tra chứng chỉ mặc định: HTTPS trả 200, HTTP trả 301 sang HTTPS.
- `smoke-compose.mjs` qua domain HTTPS: SPA nested route, live/ready,
  polling, WebSocket và từ chối Origin lạ pass.
- `smoke-browser-socket.mjs` với Edge, không bỏ kiểm tra chứng chỉ:
  same-origin polling và WebSocket pass.
- Browser smoke trên staging với hai context riêng: đăng ký qua UI hai tài
  khoản dữ liệu giả, publish qua UI, bid 100.000 VND, seller nhận snapshot
  WSS, API history có đúng một bid; viewport 390×844 không tràn ngang.
- Session cookie có tiền tố `__Host-`, Secure, HttpOnly và SameSite=Lax.
- Giao diện đã mở và kiểm tra trên Chrome qua URL HTTPS công khai.

Giữ các auction mang tên “Staging verification — demo only” và tài
khoản `example.invalid` làm dữ liệu thử. Không phải giao dịch thật. Ảnh mobile
trong `evidence/2026-11-25/staging-mobile.png`.

Phạm vi này đóng bằng chứng kỹ thuật BH-17 cho bản staging hiện tại. BH-02
cần review nhóm; BH-20 còn cần Phú duyệt; BH-21 cần nhóm duyệt/rehearsal;
BH-22 chưa có release tag hay rollback staging. Chưa tuyên bố production,
SLA, nghiệm thu học phần hoặc toàn bộ dự án hoàn thành.
