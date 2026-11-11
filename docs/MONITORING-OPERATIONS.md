# Bảo — Monitoring và vận hành BH-18

## Phạm vi

Đây là bổ sung hạ tầng trong dự án môn học; không thay phần backend nghiệp vụ của Đạt hoặc frontend của Phú. Cổng metrics riêng 9464 đo HTTP/process/pool/socket/scheduler. Chưa có VPS/domain, Alertmanager/email notification hoặc SLA production.

## Chạy lab

Giữ cấu hình DB_PASSWORD/DATABASE_URL/WEB_ORIGIN theo BAO-IMPLEMENTATION.md; thêm GRAFANA_PASSWORD riêng. Không commit env/password. Nếu api chạy local ngoài Docker, metrics bind cùng HOST (mặc định loopback); không mở 9464 trên firewall/public host.

```
docker compose --env-file /private/operations.env -f infra/compose.app.yaml -f infra/compose.monitoring.yaml up -d --build
docker compose --env-file /private/operations.env -f infra/compose.app.yaml exec -T api node apps/api/dist/database/migrate.js
```

Dashboard lab: http://127.0.0.1:3001, user admin với password riêng đã đặt. Prometheus: http://127.0.0.1:9090. Hai cổng chỉ bind loopback; truy cập VPS bằng SSH tunnel, không mở public. API/db/metrics không publish cổng Docker. Không đưa password vào screenshot/evidence.

Dashboard provision tự động có 8 panel: requests/s, p95 thời gian request hoàn tất (giây), RSS (bytes), CPU process (cores), socket connections, DB pool counts, scheduler failures và 5xx/s. Process CPU/RAM không phải CPU/RAM toàn host; socket gauge là transport connections, không phải số người dùng thật. Query rate dùng window 5 phút nên chờ đủ traffic/window; không dùng dữ liệu trống làm số 0 hoặc tuyên bố đạt SLO.

Labels HTTP chỉ dùng method whitelist, route template và status; không có ID người dùng, auction ID cụ thể, token hay query string. Metrics trên listener riêng, không đăng ký Express `/metrics`; web proxy không chuyển tiếp tới cổng này.

Prometheus giữ 7 ngày dữ liệu. Alert rules đánh giá target unavailable (1 phút), lỗi scheduler và tỷ lệ 5xx >5% trong 5 phút. Chỉ cấu hình/evaluate rules, chưa có kênh gửi thông báo; cấu hình Alertmanager là bước triển khai riêng. Không tuyên bố đã có cảnh báo đến điện thoại/email.

## Kiểm chứng

`npm test` có test HTTP metric labels không lộ ID/query và failure counters. `node scripts/smoke-monitoring.mjs` kiểm tra public không trả metric, target Prometheus up, pool series, rule được nạp và dashboard 8 panel. Yêu cầu biến GRAFANA_PASSWORD trong process; không in password.

CI chạy smoke này sau migration/Nginx/socket và backup/restore. CLI `promtool check config` kiểm tra cú pháp rule/config. Bằng chứng mới phải dựa vào run đã hoàn tất, không chỉ workflow đã viết.

## Backup lịch và retention

Mẫu `infra/systemd/bidhub-backup.service` và `.timer` dành Linux host. Trước khi cài: repo ở /opt/bidhub; tạo /var/backups/bidhub với quyền riêng; /etc/bidhub/operations.env mode 0600 chứa biến Docker Compose cần thiết, kể cả DATABASE_URL/WEB_ORIGIN/DB_PASSWORD. Copy unit rồi daemon-reload/enable timer bởi operator. Agent chưa cài timer trên máy hoặc host nào. Timer dùng 02:00 UTC (09:00 Việt Nam), có jitter tối đa 5 phút và catch-up sau downtime. Docker quyền cao: chỉ operator được sửa repo/env/unit.

Retention tách riêng và mặc định dry-run:

```
node scripts/backup-retention.mjs /var/backups/bidhub 7
```

Chỉ thêm `--apply` sau khi kiểm tra danh sách và có ít nhất một archive đã restore kiểm chứng. Chỉ xóa archive thường có tên `bidhub-YYYYMMDDTHHMMSSZ.dump`, giữ 7 bản mới nhất theo timestamp tên, không phải giữ 7 ngày; bỏ qua directory/symlink/file khác, không recursive. Không có lịch tự xóa được kích hoạt. Archive hỏng vẫn có thể chiếm một slot nên operator phải kiểm tra backup/restore trước khi prune. Đây không phải backup offsite; cần bản sao riêng ngoài host trước production.

## Handoff và các phần còn chờ

- BH-12/BH-14: socket/after-commit/scheduler sẵn; chờ bid/cancel service thật dùng chung row lock và snapshot DTO thống nhất.
- BH-17: Docker/Nginx đã kiểm chứng lab/CI; TLS host template có sẵn nhưng chưa có host/domain để triển khai.
- BH-18: monitoring + timer/retention tooling; cảnh báo gửi ngoài, offsite backup và host recovery chưa triển khai.
- BH-19: có test DB lock primitive, chưa thể đo HTTP bid/close race khi bid API chưa có. Health benchmark không thay thế bid benchmark.
- BH-21/BH-22: report/demo/release tổng thể cần MVP. Không tag release hoặc coi đồ án hoàn thành chỉ vì hạ tầng pass.

Client metrics theo API chính thức [Prometheus JavaScript client](https://github.com/prometheus/client_js); các ngưỡng alert là lựa chọn lab của BIDHUB, chưa được xác thực thành cam kết production.
