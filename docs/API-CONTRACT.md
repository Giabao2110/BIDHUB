# BIDHUB — Contract v0.1 (thiết kế, chưa triển khai đầy đủ)

## Quy ước

Prefix `/api/v1`; JSON; ID UUID; tiền VND chuỗi integer (`"150000"`), không float; ngày ISO 8601 UTC; trang mặc định 1, pageSize 20, tối đa 50. Response lỗi `{ "error": { "code": "BID_TOO_LOW", "message": "...", "requestId": "..." } }`. Frontend xử lý code, không phụ thuộc chuỗi message.

Hai health endpoint, auth, categories, auction list/detail, my auctions và
draft/publish, đặt giá, lịch sử giá công khai và kết quả phiên đã có. Đạt và Phú chốt payload từng route, Bảo cập nhật types tại
packages/contracts. Thay đổi contract phải có PR và reviewer từ phía dùng API.

## Auth — Đạt implement, Phú tích hợp

- POST `/auth/register`: `{email,password,displayName}`; 201 `{user:{id,email,displayName,role}}`, set session cookie. Email tồn tại 409; input sai 422.
- POST `/auth/login`: `{email,password}`; 200 `{user}` và cookie; 401 `INVALID_CREDENTIALS` khi sai thông tin hoặc tài khoản bị vô hiệu; 429 `RATE_LIMITED` kèm `Retry-After`.
- POST `/auth/logout`: 204; revoke token và clear cookie; lặp lại vẫn an toàn.
- GET `/auth/me`: 200 `{user}`; 401 chưa login. Không trả password_hash hoặc session token.
- GET `/auth/csrf`: 200 `{csrfToken}` cho cả khách và người đã đăng nhập. Gửi cookie và `X-CSRF-Token` khi ghi. Sau login/register/logout, lấy token mới vì session đã đổi. CSRF hoặc Origin sai trả 403 `INVALID_CSRF`. Xem [AUTH.md](AUTH.md).

## Auctions — Đạt implement, Phú UI

- GET `/categories`: `{items:[{id,slug,name}]}`. Implemented public read endpoint;
  thứ tự ổn định theo slug rồi ID, database chưa có danh mục trả `{items:[]}`.
  Query parameters không hỗ trợ được bỏ qua; chưa có category write endpoint.
- GET `/auctions?query=&categoryId=&status=ACTIVE&page=1&pageSize=20`: `{items,total,page,pageSize}`. Mỗi item có shape detail. Tìm chuỗi con theo title/description, không phân biệt hoa thường. Sort `newest` mặc định (createdAt giảm dần) hoặc `endingSoon` (endsAt tăng dần), dùng ID để phá hòa. Filter hoặc pagination sai trả 422 `INVALID_QUERY`.
- GET `/auctions/:id`: `{auction: AuctionSnapshot, description, imageUrl, seller:{id,displayName}, category:{id,name}, startsAt, openingPriceVnd}`. Hai field metadata cuối hỗ trợ form chỉnh draft của Phú. `imageUrl` nullable. Public list/detail và socket chỉ mở SCHEDULED/ACTIVE/ENDED và CANCELLED có dấu đã công bố. Chủ sở hữu xem được phiên riêng qua detail; khách và tài khoản khác nhận 404, kể cả ADMIN.
- POST `/auctions`: session và CSRF; `{title,description,categoryId,imageUrl,openingPriceVnd,minimumIncrementVnd,startsAt,endsAt}`; 201 `{auction}` trạng thái DRAFT. Title tối đa 160, description tối đa 10.000 ký tự. `imageUrl` là HTTPS hoặc null. Thời gian dùng UTC với hậu tố Z và tối đa ba chữ số phần giây; end phải sau start. Tiền dương trong signed BIGINT. Input hoặc category sai trả 422.
- PATCH `/auctions/:id`: session và CSRF, owner, draft only; cập nhật một hoặc nhiều field của POST. 200 `{auction}`; 403 `FORBIDDEN` cho tài khoản khác, 409 `AUCTION_NOT_DRAFT` khi đã đổi trạng thái.
- DELETE `/auctions/:id`: session và CSRF, owner, draft only; hard delete draft và trả 204.
- POST `/auctions/:id/publish`: session và CSRF, owner, draft only; 200 `{auction}` ACTIVE nếu đã đến giờ bắt đầu, SCHEDULED nếu start trong tương lai. Dựa vào đồng hồ DB sau khi khóa row. Hết hạn trả 422 `INVALID_AUCTION_TIME`; publish lặp trả 409 `AUCTION_NOT_DRAFT`.
- GET `/me/auctions`: `{items,total,page,pageSize}` với cùng shape detail, lọc theo user từ session và gồm cả phiên riêng. Các tham số lọc/sort/phân trang giống list public. Guest nhận 401.
- GET `/me/bids`: session, `{items:[{id,amountVnd,createdAt,auctionId,auctionTitle,auctionStatus}],total,page,pageSize}`. Chỉ trả bid của user từ session.
- GET `/auctions/:id/result`: ENDED -> 200 `{auctionId,winner:{id,displayName}|null,finalPriceVnd:null|string,closedAt}`; chưa kết thúc 409 `RESULT_NOT_READY`; phiên công khai bị hủy trả 409 `AUCTION_CANCELLED`.

## Bids — Đạt chủ nghiệp vụ, Bảo reviewer concurrency

- POST `/auctions/:id/bids`: session + CSRF; header `Idempotency-Key: <uuid>`; body `{amountVnd}`; 201 `{auction,bidId}` nếu tạo mới, 200 khi trả lại request đã chấp nhận. User ID lấy session.
- GET `/auctions/:id/bids?page=1&pageSize=20`: `{items:[{id,amountVnd,bidderDisplayName,createdAt}],total,page,pageSize}`. Không expose email/IP.
- 401 `UNAUTHENTICATED`; 403 `SELF_BIDDING`/`ACCOUNT_DISABLED`; 404 `NOT_FOUND`; 409 `AUCTION_NOT_ACTIVE`/`BID_TOO_LOW`/`IDEMPOTENCY_CONFLICT`; 422 input không hợp lệ; 429 rate limit.
- Cửa sổ giới hạn tại API: 30 lần/10 giây/tài khoản trên mỗi API process, 429 kèm `Retry-After`. Phiên chưa công khai trả 404 khi đọc lịch sử/kết quả hoặc đặt giá.
- Client bị timeout không kết luận bid thất bại: resync snapshot/history và retry cùng key. Sau thành công hoặc lỗi nghiệp vụ kết thúc lần thử mới tạo key tiếp theo.

## Admin — Đạt backend, Phú giao diện

- POST `/admin/auctions/:id/cancel`: session ADMIN + CSRF + `{reason}`; 200 `{auction}` sau khi cập nhật status/version và audit trong cùng transaction. Chỉ phát sự kiện sau commit nếu phiên đã công khai. ENDED/CANCELLED trả 409 `AUCTION_TERMINAL`.
- PATCH `/admin/users/:id`: session ADMIN + CSRF + `{disabled:boolean,reason}`; 200 `{user:{id,disabled}}`, revoke sessions khi disable, audit khi trạng thái đổi. Giữ ít nhất một admin đang hoạt động (`LAST_ADMIN`, 409).

## Socket — Bảo server, Phú client

Transport `/socket.io`, cùng origin với web qua Nginx; không thay thế HTTP write route.

- Client `auction:join` `{auctionId}` -> ack `{ok:true}` hoặc lỗi; validate UUID/existence, join room `auction:<id>`; giới hạn số room mỗi socket.
- Client `auction:leave` `{auctionId}` -> rời room.
- Server `auction:updated` `{auction:AuctionSnapshot}` sau bid/cancel/close commit. Dùng một event snapshot để client không tự ghép các thay đổi rời rạc.
- Reconnect: join lại room rồi GET snapshot. Không chờ socket tự gửi lại event bị mất.
- Phú bỏ event có version <= version đã hiển thị; REST snapshot cũng kiểm tra version. ServerTime phục vụ chỉnh countdown; kết quả cuối cùng vẫn từ server.
- Khi socket hỏng: hiện trạng thái kết nối, polling REST 15 giây, vẫn cho bid qua HTTP nếu HTTP hoạt động; cleanup listener khi unmount.

## Gate contract tuần 1

Chốt payload success/error; fixtures đủ DRAFT/SCHEDULED/ACTIVE/ENDED/CANCELLED; thống nhất ID/type/time/money; dùng fixtures cho frontend trong tuần 2 nhưng gắn nhãn mock. Tuần 3 bỏ mocks trên những route đã có backend thật. API docs không ghi tính năng planned là đã chạy.

## BH-02-A — bộ ví dụ để review

[ERD/rules/visibility và quyết định mở](DB-DOMAIN.md),
[fixtures mock typed](fixtures/auctions.ts), [cách dùng và request mẫu](fixtures/README.md).
Snapshot fixtures được kiểm tra với shared types hiện hành; không thêm field
vào `AuctionSnapshot`. `openingPriceVnd` và `startsAt` ở metadata scenario để
đối chiếu rules, không tự thêm chúng vào response detail.

`image_url` nullable trong SQL nên fixture detail dùng `imageUrl: null`.
Fixtures là dữ liệu mock. Dùng `test:auth-db` và `test:auctions-db` để kiểm tra
các route đã triển khai trên PostgreSQL riêng. Response result CANCELLED vẫn
cần chốt trước khi triển khai.
