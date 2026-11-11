# BIDHUB — Phân công và timeline chi tiết

## 1. Giả định và mốc bàn giao

Nhóm 3: Bảo, Đạt, Phú. Stack đã được Bảo đồng ý: React/TypeScript, Express/TypeScript, PostgreSQL. User xác nhận hoàn thành tháng 12, **chưa có ngày nộp chính xác**. Kế hoạch tạm: 12/10–06/12/2026, 8 tuần; 8–10 giờ/người/tuần là giả định chưa được xác nhận. Lead kiểm tra lịch môn học ngay tuần 1. Nếu deadline sớm hơn, cắt feature tùy chọn trước và giữ tuần cuối để sửa/demo.

Tổng năng lực dự kiến 192–240 giờ công. Không dùng toàn bộ cho feature: mỗi người giữ khoảng 20–25% cho review, tích hợp, sửa lỗi, tài liệu và học công nghệ. Mỗi tuần chỉ nhận tối đa hai việc chính; việc đang làm phải có PR nhỏ trước khi nhận thêm.

Các gate: 18/10 nền tảng; 01/11 luồng tạo phiên thật; 15/11 đấu giá realtime hoàn chỉnh; 22/11 feature freeze + staging; 29/11 release candidate; 06/12 demo/report. Gate chỉ đạt khi có chứng cứ nghiệm thu, không chỉ vì đã đến ngày.

### Điều phối MVP — cập nhật 11/11/2026

- **Đạt — đường găng:** hoàn thiện HTTP auth/CSRF trước, rồi list/detail/draft/publish. Nghiệm thu với PostgreSQL thật: session revoke, quyền owner, draft không xuất hiện công khai, publish nhìn thấy bằng phiên khác. Tiếp theo là bid transaction, idempotency và admin/result theo BH-11/BH-15.
- **Phú — chạy song song:** tích hợp join/rejoin và resync ở màn detail theo contract. Nghiệm thu UI preview và test chặn race bằng fixture riêng; chuyển sang hai browser context dùng backend thật khi auth/auction/bid sẵn sàng.
- **Bảo — tích hợp và nghiệm thu:** theo dõi PR theo SHA, giữ kiểm tra browser transport qua proxy, review cùng Đạt thứ tự khóa hàng và sự kiện sau commit. Chỉ đánh dấu BH-19 khi test HTTP bid/close/cancel thật pass; benchmark ghi rõ tải, môi trường, p95 và tỷ lệ lỗi.
- **Môi trường:** nhóm chưa có host/domain staging; nghiệm thu local/CI trước. Giữ HTTPS/WSS trên host thật ở trạng thái chờ. Gate phát hành cần chạy kịch bản [RUNBOOK](RUNBOOK.md), kèm bằng chứng regression và diễn tập restore. Không đưa watchlist/upload/email vào đường găng.

## 2. Chủ sở hữu

### Lê Ngô Gia Bảo — Lead / Infrastructure / Realtime

Sở hữu root workspace, CI, shared contracts, infra, socket server, scheduler vận hành, runbook, tích hợp và phát hành. Chủ động làm một feature kỹ thuật rõ ràng (realtime/reconnect/anti-sniping review), không chỉ phân việc.

Đầu ra cá nhân: môi trường chạy lại được từ repo; endpoint health; staging HTTPS; WebSocket qua proxy; dashboard/logs; báo cáo load/concurrency; backup/restore và recovery drill; sơ đồ mạng; PR/ADR chứng minh quyết định. Đạt đồng sở hữu logic scheduler và transaction; Bảo không tự sửa nghiệp vụ mà bỏ review của Đạt.

### Vũ Thành Đạt — Backend / Database / Auction Domain

Sở hữu SQL/migration/seed, auth/session/CSRF, users/categories/auctions/bids/admin, kiểm tra quyền, query pagination và transaction bid/close. Đầu ra: API chạy thật, contract đáp ứng UI, tests nghiệp vụ và integration chống race, tài liệu API và DB. Review cách Bảo gọi service/emit sau commit.

### Phan Quang Phú — Frontend / UX / Browser Integration

Sở hữu router/layout/forms/list/detail/profile/admin, API client, trạng thái loading/error/empty, socket client/reconnect và responsive. Đầu ra: đầy đủ luồng người dùng, không cần thao tác API tay, validation dễ hiểu, xử lý lỗi giá cũ/mất kết nối và E2E. Review contract với Đạt và socket với Bảo.

## 3. Backlog có thể tạo thành GitHub Issues

Các mã BH dưới đây là task ID trong kế hoạch, **chưa phải GitHub Issues đã tạo**. Effort là giờ tập trung cho task, không phải cam kết; cộng thêm review/tích hợp theo năng lực tuần.

- BH-01 — Bảo, 4h: workspace, README, CI, env example; nghiệm thu cả nhóm clone/install/build/test được; không phụ thuộc.
- BH-02 — Cả nhóm, 3h/người: scope, ERD, wireframe và contract; mỗi người review phần giao diện/DB/infra; phụ thuộc BH-01.
- BH-03 — Đạt, 5h: migration + seed có 3 users mẫu/5 phiên; chạy fresh DB và chạy migrate lần hai an toàn; phụ thuộc BH-02.
- BH-04 — Đạt, 8h: register/login/logout/me, hash password/session/CSRF, kiểm tra auth; phụ thuộc BH-03.
- BH-05 — Phú, 6h: app layout/router/design tokens + responsive states; phụ thuộc BH-02.
- BH-06 — Phú, 6h: auth UI và session restore/error; phụ thuộc BH-04, có thể mock sau BH-02.
- BH-07 — Đạt, 7h: category/list/detail/search/pagination; phụ thuộc BH-03.
- BH-08 — Phú, 7h: list/detail/filter/countdown; phụ thuộc BH-07, fixtures song song.
- BH-09 — Đạt, 6h: draft CRUD/publish và owner authorization; phụ thuộc BH-04/BH-07.
- BH-10 — Phú, 6h: seller form/my auctions/publish; phụ thuộc BH-09.
- BH-11 — Đạt, 8h: bid transaction, idempotency, validation/anti-sniping; phụ thuộc BH-09.
- BH-12 — Bảo, 6h: rooms + emit sau commit + client sync contract; phụ thuộc BH-11, transport dựng trước.
- BH-13 — Phú, 7h: bid form/history/live state/reconnect; phụ thuộc BH-11/BH-12.
- BH-14 — Bảo + Đạt, 4h/người: scheduler activate/close, kết quả một lần, restart catch-up; phụ thuộc BH-11.
- BH-15 — Đạt, 5h: me/bids/result API và admin cancel/disable audit; phụ thuộc BH-14.
- BH-16 — Phú, 6h: dashboard/result/admin UI; phụ thuộc BH-15.
- BH-17 — Bảo, 8h: deployment Linux/Nginx/HTTPS + socket upgrade + environment isolation; phụ thuộc BH-01, deploy shell sớm, full staging sau BH-14.
- BH-18 — Bảo, 5h: logs/health/rate-limit deployment config/backup restore; phụ thuộc BH-17.
- BH-19 — Đạt + Bảo, 4h/người: PostgreSQL concurrency suite + cancel/close/bid race; phụ thuộc BH-11/BH-14.
- BH-20 — Phú, 6h: E2E 2 browser contexts, responsive/errors/keyboard; phụ thuộc BH-13/BH-16.
- BH-21 — Cả nhóm, 4h/người: regression, report, slide/demo script và evidence; phụ thuộc các gate tính năng.
- BH-22 — Bảo, 3h: release, config/secret review và diễn tập demo/restore; phụ thuộc BH-18/BH-19/BH-20/BH-21.

Watchlist/upload/email chỉ thêm khi BH-11–BH-20 qua gate và còn thời gian; không dùng feature tùy chọn để thay phần reliability.

## 4. Timeline từng tuần

### Tuần 1 — 12–18/10: Chốt phạm vi và nền tảng

**Bảo (8h):** BH-01 4h; họp BH-02 2h; lập board/PR conventions + kiểm tra deadline thực tế 2h. Chốt MVP và diagram; phân reviewer; hướng dẫn cả nhóm chạy local.

**Đạt (8h):** ERD/SQL seed/migration BH-03 5h; contract và rules 2h; cùng Phú thử payload 1h. Đọc kỹ row locking và transaction client.

**Phú (8h):** wireframe 5 trang login/list/detail/create/dashboard 2h; BH-05 4h; contract/fixture 2h. Thiết kế mobile trước khi mở rộng admin.

**Phụ thuộc/gate 18/10:** cả ba chạy shell/API/DB từ fresh checkout; cùng hiểu scope, status lifecycle, kiểu tiền/time; CI xanh; chọn seed accounts. Nếu chưa chạy được local, tuần 2 ưu tiên sửa nền tảng.

### Tuần 2 — 19–25/10: Tài khoản và danh sách

**Bảo (8h):** env/config/error/request logging 3h; kiểm tra CI và review auth/security 2h; dựng Socket transport/health DB và chuẩn bị staging host proposal 3h. Chưa mua dịch vụ khi chưa có ngân sách.

**Đạt (10h):** BH-04 khoảng 7h; phần category/list của BH-07 2h; auth negative tests/review 1h. Hoàn thiện CSRF/cookie theo contract, seed admin qua script.

**Phú (9h):** BH-06 5h; list layout/filter mock từ contract 3h; review/demo 1h. Loading/error/empty phải có ngay, không để cuối kỳ.

**Gate 25/10:** đăng ký/login/logout/me qua UI; reload vẫn đúng session; sai mật khẩu trả 401; CSRF và quyền cơ bản được kiểm tra; danh sách đọc DB. UI mock còn lại phải ghi rõ.

### Tuần 3 — 26/10–01/11: Luồng tạo và công bố phiên

**Bảo (8h):** review contract/permissions 2h; deploy shell lên staging nếu host đã chốt 3h; phòng đấu giá transport/fixtures integration 3h.

**Đạt (9h):** hoàn thiện detail/search/pagination BH-07 3h; BH-09 5h; tests owner/draft/time 1h.

**Phú (9h):** BH-08 4h; BH-10 4h; demo UI/bug fixes 1h. Đồng bộ serverTime cho countdown, giữ UI chưa chốt người thắng.

**Gate 01/11:** user A tạo draft rồi publish; user B thấy phiên thật trên danh sách/chi tiết; user B không sửa được của A; published auction không bị sửa giá/thời gian; không dùng mock ở luồng này.

### Tuần 4 — 02–08/11: Trả giá đúng và realtime

**Bảo (9h):** BH-12 6h; review transaction + test cạnh tranh với Đạt 2h; tích hợp Phú 1h.

**Đạt (10h):** BH-11 8h; DB integration tests 2h. First bid, bước giá, self-bid, expired, idempotency đều có assertions.

**Phú (9h):** BH-13 7h; hai browser cạnh tranh và lỗi giá cũ 2h. Timeout dùng cùng idempotency key, không tự gửi một bid khác.

**Gate 08/11:** 2 browser thấy giá mới; bid sai bị chặn; 10 requests đồng thời cùng giá chỉ có một accepted bid mới; lịch sử DB không trùng khi retry; socket event được phát sau commit. Unit test đơn lẻ chưa đủ qua gate concurrency.

### Tuần 5 — 09–15/11: Kết thúc phiên và luồng hoàn chỉnh

**Bảo (8h):** BH-14 4h; reconnect/poll fallback + restart catch-up 2h; end-to-end integration 2h.

**Đạt (9h):** BH-14 logic/transaction 4h; BH-15 4h; review event/version 1h.

**Phú (9h):** hoàn thiện reconnect và version filtering 2h; BH-16 6h; demo 1h.

**Gate 15/11:** accepted late bid gia hạn; job không chốt ends_at cũ; phiên không bid kết thúc không winner; kết quả chỉ một bản ghi; restart server chốt được phiên đã quá hạn; admin cancel hiển thị realtime; user bị disable không bid được.

### Tuần 6 — 16–22/11: Staging, bảo mật và feature freeze

**Bảo (10h):** hoàn thiện BH-17 5h; BH-18 3h; hướng dẫn rollout/rollback và review secret 2h. Cấu hình Nginx WebSocket, DB private, SSH giới hạn, HTTPS.

**Đạt (8h):** input/rate limit/CSRF/role edge cases 3h; query/index checks 2h; API docs + integration fixtures 3h.

**Phú (9h):** responsive/keyboard/status polish 3h; BH-20 phần auth/create/bid 4h; kiểm tra HTTPS cookies/reconnect trên staging 2h.

**Gate 22/11:** ứng dụng staging đủ toàn bộ MVP; HTTPS và WSS hoạt động; không có secret public; restore backup vào DB riêng thành công; scope khóa. Sau gate chỉ bug fixes, không nhận feature lớn.

### Tuần 7 — 23–29/11: Kiểm thử tải và release candidate

**Bảo (9h):** BH-19 phối hợp 4h; thử tải và ghi CPU/RAM/p95/error/network conditions 3h; BH-21 evidence/architecture report 2h.

**Đạt (9h):** BH-19 4h; sửa bugs integration 3h; API/ERD report 2h.

**Phú (9h):** BH-20 hoàn thiện 4h; sửa UI/E2E failures 3h; screenshot/demo content 2h.

**Gate 29/11:** release candidate build; không còn bug critical (sai winner, unauthorized access, mất/duplicate bid); E2E pass; báo cáo đo thật có môi trường/time window/số client. Mục tiêu thử 50 clients với p95 REST <500ms và lỗi ngoài dự kiến <1% là target lab, chưa phải kết quả đã đạt. Đo read load và bid contention riêng; không áp cùng target latency cho 50 bid xếp hàng trên một auction.

### Tuần 8 — 30/11–06/12: Hoàn thiện và bàn giao

**Bảo (8h):** BH-22 3h; tổng hợp report/slides 2h; rehearsal/setup release 2h; buffer 1h.

**Đạt (8h):** báo cáo schema/API/transaction/test 3h; walkthrough nghiệp vụ 2h; sửa regression 2h; buffer 1h.

**Phú (8h):** slides/use cases/screenshots 3h; chuẩn bị luồng demo 2h; responsive/regression 2h; buffer 1h.

**Gate 06/12 (tạm):** tag release sau checks; README cài đặt, report, slide, seed/demo credentials qua kênh phù hợp; cả 3 tự giải thích phần mình; demo offline/local dự phòng. Không tự động nộp bài hoặc mời giảng viên chỉ vì đã có gate.

## 5. Nhịp làm việc và trách nhiệm lead

- Thứ Hai: 20–30 phút chốt mục tiêu, dependency, giờ rảnh; mỗi người tối đa 2 tasks chính.
- Giữa tuần: cập nhật 3 dòng “đã làm / tiếp theo / blocker”; blocker quá một ngày báo lead để đổi thứ tự hoặc pair-debug.
- Thứ Sáu: mở PR nhỏ, review trong 24h nếu có thể. Không chờ đến Chủ Nhật mới đưa toàn bộ code lên.
- Chủ Nhật: demo 30–45 phút từ build hiện tại, ghi bugs và gate pass/fail. Lead cập nhật backlog, không ghi done khi chỉ chạy trên máy tác giả.
- Bảo dành thời gian review/tích hợp cố định, không ôm toàn bộ backend/UI. Người tạo feature phải tự test và viết hướng dẫn demo.

## 6. Quy tắc Git và review

`main` dùng cho code đã tích hợp; mỗi task tạo branch `feat/BH-11-bid-transaction` hoặc `fix/...`, merge qua PR. Có thể dùng main làm integration và tag release; không thêm develop nếu chưa có nhu cầu. Cả nhóm cập nhật từ main trước khi mở PR; cùng file shared contract cần báo nhau.

Reviewer: backend Đạt -> Bảo, realtime/infra Bảo -> Đạt, frontend Phú -> Bảo; contract/API cần Phú và Đạt cùng xem. Bảo tự làm PR phải có Đạt review, không tự coi mình là ngoại lệ.

Definition of Done: đáp ứng acceptance; typecheck/test/build xanh; backend có negative authorization cases; DB schema có migration; UI loading/error/empty + responsive; contract/docs cập nhật; không secret; reviewer duyệt; đã demo integration. Branch protection là đề xuất lead cấu hình, chưa được áp dụng bởi bộ khung này.

## 7. Rủi ro và điều chỉnh

- Đạt backend trễ: Phú dùng fixtures đúng contract; Bảo pair-debug thay vì tự tạo API khác. Sau tuần 3 phải chuyển luồng lõi sang dữ liệu thật.
- Bảo infra trễ: local demo vẫn chạy; hoãn dashboard đẹp, giữ health/logs/HTTPS. Không đổi kiến trúc sang multi-instance ở cuối kỳ.
- Phú UI trễ: cắt admin dashboard nâng cao/watchlist, giữ các trang lõi và form lỗi.
- Deadline trước 06/12: giảm scope bổ sung, gom polish vào tuần 6; bảo vệ transaction/reconnect/close tests và rehearsal.
- Tài nguyên hạn chế: đo trên máy/lab cụ thể, ghi limitations. Không ghi “high availability” khi chỉ có một VPS.

## 8. Đóng góp cá nhân để dùng trong CV

Bảo lưu sơ đồ mạng, CI config, triển khai Nginx/HTTPS, log/recovery/load evidence, PR review và quyết định realtime. Đạt lưu ERD, migration, auth/transaction tests và API. Phú lưu wireframes, flows, responsive/E2E và reconnect handling. Mỗi người viết contribution summary theo việc thực sự làm; số liệu CV phải lấy từ báo cáo đo đã lưu, không dùng target làm kết quả.
