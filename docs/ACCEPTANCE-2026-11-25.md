# BidHub — Đối chiếu và bàn giao nghiệm thu 25/11/2026

Nhánh `Giabao2110/mvp-completion-20261125`, base main
`260053b0792074f626c06e096c91af45821a569d`. Các thay đổi của phiên này
được kiểm chứng local như ghi bên dưới. Trạng thái CI/PR xem trên nhánh của
repo, không suy ra CI pass từ log local. Chưa có merge hay deploy mới ở mốc này.
Tài liệu và E2E mới do Codex hỗ trợ; không ghi thành công việc cá nhân
độc lập của Bảo, Đạt hoặc Phú.

## Phần vừa bổ sung

- BH-02: cập nhật ERD có `was_published`, constraint migration 002, visibility
  admin, replay bid và result CANCELLED theo code đang có. Review nhóm còn mở.
- BH-20: 3 kịch bản chạy trên 2 viewport: desktop 1440×1000 và mobile 390×844.
  Đăng ký thật, seller publish bằng UI; hai bidder cạnh tranh, 409
  `BID_TOO_LOW`, input giữ nguyên, sửa giá rồi thành công; SQL có đúng 2 bid.
  Late bid gia hạn >=60 giây; scheduler bình thường ghi đúng một result và
  hai browser hiện cùng winner. Kiểm tra bàn phím, login sai, ngắt REST rồi
  tải lại thành công, không tràn ngang.
- BH-21: báo cáo/kịch bản demo trong [DEMO-REPORT.md](DEMO-REPORT.md),
  [slide review 6 trang](slides/bidhub-demo-review-2026-11-25.pptx),
  ảnh dữ liệu thử nghiệm trong [evidence/2026-11-25](evidence/2026-11-25).
  Nhóm còn cần duyệt nội dung và diễn tập.
- CI workflow được thêm bước E2E DB mới. Kiểm tra run của đúng SHA trên nhánh
  `Giabao2110/mvp-completion-20261125`; kết quả local không thay CI.

## Kết quả thực chạy local

Ngày 25/11/2026, Windows, Node.js 24.18.0, npm 11.16.0,
Edge Chromium; PostgreSQL 14 trong WSL Ubuntu 22.04, cluster tạm và DB riêng.
CI cấu hình PostgreSQL 17; không đồng nhất kết quả local PG14 với CI PG17.

- Typecheck ba workspace và typecheck riêng file E2E/config: pass.
- Backend policy/lifecycle/socket/metrics: 11/11 pass, 0 skipped (có DB).
- DB migration/auth/category/auction/bid/admin và fixtures contract: 34/34 pass,
  0 skipped. Bao gồm contention 10 bidder, replay, disable/cancel và result.
- Backup-retention: 1/1 pass.
- E2E DB mới: 6/6 pass, 43,7 giây trong lượt hoàn chỉnh.
- Build contracts/API/web: pass.
- Preview: 60/60 pass trên 4 viewport (fixtures), 1,6 phút.
- Realtime browser: 3/3 pass (REST fixtures, Socket.IO room thật), 6,3 giây.
- Frontend format: pass.

Hai lượt E2E đầu khác nhau: lượt đầu 2/6 pass vì assertion dùng sai câu thông
báo UI (UI map theo error code); sửa assertion theo thông báo thực và kiểm tra
thêm response code `BID_TOO_LOW`, lượt tiếp theo 6/6 pass. Không sửa logic
nghiệp vụ để làm test pass. Vite ghi ECONNABORTED khi browser đóng socket;
assertion và teardown hoàn tất, không coi dòng này là lỗi bid.

Ảnh [desktop-result.png](evidence/2026-11-25/desktop-result.png) và
[mobile-outbid.png](evidence/2026-11-25/mobile-outbid.png) lấy từ lượt pass.
Đây là dữ liệu giả của test, đi qua API/PostgreSQL thật; ảnh không tự chứng minh
HTTPS/WSS hay môi trường staging.

## Chạy lại E2E với DB riêng

Cài Node.js 24, npm dependencies và Chromium:

```sh
npm ci
npx playwright install chromium
export TEST_DATABASE_URL='postgres://test_user:test_password@127.0.0.1:5432/bidhub_test'
npm run test:e2e-db --workspace @bidhub/web
```

PowerShell dùng DB test do người chạy chuẩn bị:

```powershell
$env:TEST_DATABASE_URL = 'postgres://test_user:test_password@127.0.0.1:5432/bidhub_test'
$env:PLAYWRIGHT_CHANNEL = 'msedge'
npm run test:e2e-db --workspace @bidhub/web
```

User DB test cần CREATE SCHEMA. Runner chỉ dùng `TEST_DATABASE_URL`, không
đọc `.env`, tạo schema UUID, áp migrations và tự dọn schema/process khi kết
thúc. Để trống cổng 5197; API/metrics lấy cổng loopback tạm. Nếu process bị
kill cứng, operator kiểm tra schema tiền tố `browser_test_` của DB test
trước khi dọn, không dọn schema staging.

Để tránh đợi deadline lâu, test late bid đổi `ends_at` của đúng auction test
trong schema cô lập: còn 20 giây trước bid, rồi đưa về quá hạn sau khi đã
assert gia hạn. Không mock service/scheduler hoặc response kết quả; không
coi đây là phép đo chính xác đồng hồ trên mạng thực tế. Proxy của suite là
Vite HTTP/Socket.IO; bằng chứng Nginx/TLS loopback cũ nằm trong RUNBOOK.

## 5 hạng mục còn cần đóng — thứ tự ưu tiên

1. **BH-17 — Bảo, ưu tiên ngay:** tự tạo VM/domain, cấu hình Docker/Nginx/TLS;
   URL công khai, HTTPS certificate hợp lệ, WSS từ máy ngoài host, DB không
   public và cookie Secure phải được kiểm tra. Gate 22/11 đã qua; chưa có
   evidence staging trong phiên này.
2. **BH-20 — Phú:** review/chạy suite mới trên CI PG17 và staging, đối chiếu
   manual phone/browser, keyboard, HTTPS cookie và reconnect. E2E local
   đã có bằng chứng; chưa tự đánh dấu nghiệm thu staging.
3. **BH-02 — cả ba:** Đạt xác nhận DB/API/rules, Phú xác nhận payload/UI,
   Bảo xác nhận realtime/visibility; ghi tên/ngày và vấn đề còn lại.
4. **BH-21 — cả ba:** duyệt report/slide, thay bằng screenshot staging khi
   có, ghi kết quả rehearsal và mỗi người tự giải thích phần mình.
5. **BH-22 — Bảo:** tự review config/secret, xác minh backup/restore trên
   DB riêng, diễn tập rollback thực tế và tag release sau khi các gate pass.
   Lab rollback local 18/11 nằm ở checkout riêng; chưa phải rollout staging.

Mốc tiếp theo theo TEAM-PLAN là RC 29/11 và bàn giao tạm 06/12. Không nâng
phần trăm Done chỉ vì thêm test/tài liệu; các task còn chờ review, CI và
nghiệm thu thực tế.

## Checklist Bảo tự thực hiện

- [ ] BH-17: ghi SHA/CPU/RAM/OS của VM, IP/domain qua kênh riêng; đặt secret
      ngoài repo và không đưa vào screenshot/report công khai.
- [ ] Chạy migrations, readiness, SPA nested route; HTTP chuyển sang HTTPS.
- [ ] Kiểm tra certificate còn hạn và tên miền đúng bằng máy ngoài VM.
- [ ] Kiểm tra browser DevTools: socket kết nối WebSocket qua `wss://`,
      cookie Secure/HttpOnly/SameSite, request Origin lạ bị từ chối.
- [ ] Tự thử hai browser: publish, bid, ngắt/rejoin, close; chụp bằng chứng
      đã che thông tin riêng và ghi SHA/ngày/môi trường.
- [ ] BH-02/BH-21: cùng Đạt/Phú review, ghi xác nhận của từng người.
- [ ] BH-22: backup, restore sang DB riêng và đối chiếu fingerprint.
- [ ] Thử rollback, ghi thời gian/điểm bắt đầu và kết thúc, xác minh dữ liệu.
- [ ] Kiểm tra CI của đúng SHA, reviewer duyệt và rehearsal pass rồi mới tag.

Chưa ai được ghi là đã xác nhận các ô trên trong lần bàn giao này.
