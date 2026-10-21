# Kiểm tra phần Bảo — 15/10/2026 (Asia/Saigon)

- Typecheck: pass, 3 workspaces.
- Build: pass, contracts/API/web.
- Tests: 8 pass, 1 skipped. Test bị skip là integration lifecycle với PostgreSQL vì local chưa có TEST_DATABASE_URL/database đang chạy. CI cấu hình service PostgreSQL để chạy test này.
- Socket integration: validate/public room/cap, event delivery, disconnect/reconnect/rejoin pass.
- Scheduler unit: startup tick ngay, stop đợi work đang chạy và không tạo tick tiếp theo pass.
- Docker engine chưa chạy: chưa xác minh image builds/container runtime/backup restore thực tế. CI đã thêm Docker build cho API/web, kết quả còn chờ run trên GitHub.

## HTTP liveness smoke load

Máy Windows local, Node.js 24, endpoint loopback `/api/v1/health/live`; chạy một lượt 100 requests, 10 workers, timeout 5 giây/request. Kết quả: 0 lỗi, p95 41.13ms, tổng thời gian 155.82ms. Tool timestamp UTC `2026-10-14T19:18:25.250Z` tương ứng 15/10/2026 tại Việt Nam.

Đây là phép đo health endpoint đơn giản, không có database work và không đại diện đấu giá, tải dài hạn, production hoặc bid contention. Khi chạy API không có DB, scheduler log lỗi và retry như thiết kế; integration scheduler vẫn cần PostgreSQL thật.
