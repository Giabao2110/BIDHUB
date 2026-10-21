# Phần Bảo — Infrastructure / Realtime

Current follow-up: [21 October verification and recovery tooling](BAO-VERIFICATION-2026-10-21.md). Dated CI statements below describe earlier runs, not confirmation that the current working tree has passed CI.

## Đã triển khai

- API HOST cấu hình được cho Docker; structured request logs gồm request ID/status/duration, không log body/header/query.
- JSON parser error có request ID và HTTP 413 cho body quá lớn.
- Socket auction:join/leave: validate UUID, kiểm tra DB phiên không phải DRAFT, tối đa 5 phòng/connection, 20 operations/10 giây, serialize join tránh race vượt giới hạn.
- Exact Origin ở Socket handshake; client web phải cùng WEB_ORIGIN.
- withTransaction helper: BEGIN/COMMIT/ROLLBACK, release connection, callback event chỉ sau commit; callback lỗi không biến bid đã commit thành lỗi HTTP.
- Dockerfiles API/web, compose ứng dụng với DB private và readiness, Nginx SPA fallback/API proxy/WebSocket upgrade/API rate limit.
- Mẫu TLS host Nginx và backup script Linux dùng pg_dump archive, không ghi đè backup cũ.

## Tích hợp cho Đạt và Phú

Đạt dùng `withTransaction(pool, async (client, afterCommit) => ...)`: mọi repository dùng cùng client, đăng ký `afterCommit(() => publishAuctionUpdate(snapshot))` khi snapshot đã được dựng trong transaction. Publisher tạo bằng `createAuctionPublisher(io)` ở composition root rồi inject vào service; không import server.ts từ service. Không phát event trực tiếp trước commit. Helper chưa được ghép vào bid service vì service chưa tồn tại.

Phú dùng Socket.IO client cùng origin, join sau mỗi connect/reconnect; ack lỗi hiển thị trạng thái phù hợp; GET snapshot REST sau join; version cũ bỏ qua; polling fallback theo API-CONTRACT. Không có fake auction data hoặc bid API trong phần hạ tầng.

## Chạy full stack bằng Docker

Tạo file env riêng ngoài Git, gồm DB_PASSWORD mạnh, DATABASE_URL `postgres://bidhub:<URL-encoded-password>@db:5432/bidhub`, WEB_ORIGIN `http://localhost:8080` ở local hoặc origin HTTPS thật.

```
docker compose --env-file /path/to/private.env -f infra/compose.app.yaml up -d --build
docker compose --env-file /path/to/private.env -f infra/compose.app.yaml exec -T api node apps/api/dist/database/migrate.js
```

Mở localhost:8080; API/DB không publish host port. Compose readiness mới kiểm tra kết nối DB, không kiểm tra schema đã migrate. Migrate trước khi thử auction rooms. Không tự động chạy migration khi API khởi động.

Production: cài host Nginx, sửa domain/certificate trong host-tls.conf.example; cấu hình WEB_ORIGIN HTTPS. Container web chỉ bind loopback. Mẫu certificate path cần chứng chỉ thật, chưa phải HTTPS deployed.

Backup: export DB_PASSWORD/DATABASE_URL/WEB_ORIGIN trong shell trước khi chạy `sh infra/backup.sh /private/backups/bidhub.dump`, hoặc đưa env file qua COMPOSE_ENV_FILES. Restore vào DB test riêng: tạo DB bằng createdb rồi chạy pg_restore -U bidhub -d bidhub_restore --no-owner từ archive; không dùng --clean vào DB đang chạy. So sánh counts users/auctions/bids/results và lưu thời gian restore.

## Phần phụ thuộc còn lại

BH-14 scheduler đã có implementation; test PostgreSQL thật đã pass local trong Docker ngày 21/10, nhưng chưa xác minh cùng bid/cancel service BH-11 của Đạt. BH-19 test tranh chấp bid/close vẫn cần BH-11. BH-17 chưa triển khai host thực tế vì chưa có VPS/domain. BH-18 đã pass backup/restore lab local với dữ liệu mẫu ngày 21/10; dashboard host, retention và recovery trên host thực tế còn thiếu. BH-21/BH-22 release/demo cần toàn bộ MVP. Không ghi toàn bộ các mục này là done.

Kiểm tra Docker engine trước khi build containers; trên máy hiện tại engine chưa chạy ở thời điểm bắt đầu triển khai. Unit helper tests dùng client giả để kiểm tra thứ tự commit; socket integration dùng server/client thật, không chứng minh transaction PostgreSQL đồng thời.

## Bổ sung 15/10/2026

- Scheduler quét ngay khi startup, rồi mỗi 3 giây, batch tối đa 100, không chạy chồng tick. Dùng FOR UPDATE SKIP LOCKED để nhiều worker không xử lý cùng row; BEGIN/COMMIT bao toàn batch.
- SCHEDULED đến giờ thành ACTIVE; SCHEDULED đã quá hạn sau downtime được chốt ENDED trực tiếp. ACTIVE quá hạn tạo result từ bid cao nhất, rồi đổi status/version. Nếu không bid thì winner/final price null. Callback realtime chỉ chạy sau commit.
- Bid/cancel service bắt buộc khóa cùng auction row; scheduler dùng clock_timestamp sau khóa và điều kiện due kiểm tra ends_at ở DB. Hiện chưa test race cùng bid service thật vì chưa có service.
- Scheduler dừng và đợi tick đang chạy trước khi đóng pool. Nếu DB/schema chưa sẵn, ghi event lỗi và thử ở tick sau.
- Test DB dùng TEST_DATABASE_URL và schema riêng; CI có PostgreSQL 17, chạy test lifecycle/multiple workers và Docker image builds. Không xem CI là pass trước khi run thực sự hoàn tất.
- Script `infra/restore-test.sh` tạo DB riêng, khôi phục và in counts; giữ DB để kiểm tra rồi xóa thủ công. Dùng cùng environment setup với backup.sh.
- `node scripts/load-health.mjs`: baseline liveness, cấu hình LOAD_URL/LOAD_CLIENTS/LOAD_REQUESTS, in p95/error rate và thời gian. Không đo SQL/bid/realtime và không dùng để tuyên bố hiệu năng toàn ứng dụng.
- Socket test có disconnect/reconnect và rejoin; xác nhận room không tự giữ sau reconnect. REST resync vẫn là phần client cần tích hợp.

## CI full-stack verification

Run `38622632923` cho commit `662e155` đã success trên GitHub: test PostgreSQL lifecycle và build Docker API/web đã chạy thực sự. Local Docker vẫn chưa bật.

CI mở rộng khởi động Compose, chạy migration hai lần để kiểm tra idempotency, rồi test SPA fallback, health routes, Socket.IO polling/WebSocket qua Nginx và từ chối Origin khác. Backup pg_dump rồi restore vào database riêng cũng chạy trong CI. Xem kết quả run của commit mới trước khi coi bộ kiểm tra bổ sung đã pass.

Test locking bổ sung giữ auction row bằng transaction riêng, xác nhận worker SKIP LOCKED không chốt phiên, gia hạn rồi commit và kiểm tra worker vẫn không kết thúc sớm. Đây là kiểm tra primitive PostgreSQL, chưa thay thế test HTTP bid service của Đạt.

Pool giới hạn statement 5 giây và idle transaction 10 giây; services cần giữ transaction ngắn, không gọi network trong transaction. Idle DB disconnect được ghi log thay vì gây unhandled error.
