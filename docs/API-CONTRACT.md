# BIDHUB — Contract v0.1 (thiết kế, chưa triển khai đầy đủ)

## Quy ước

Prefix `/api/v1`; JSON; ID UUID; tiền VND chuỗi integer (`"150000"`), không float; ngày ISO 8601 UTC; trang mặc định 1, pageSize 20, tối đa 50. Response lỗi `{ "error": { "code": "BID_TOO_LOW", "message": "...", "requestId": "..." } }`. Frontend xử lý code, không phụ thuộc chuỗi message.

API dưới đây là backlog, ngoại trừ hai health endpoint và GET `/categories`
đã có. Đạt và Phú chốt payload từng route, Bảo cập nhật types tại
packages/contracts. Thay đổi contract phải có PR và reviewer từ phía dùng API.

## Auth — Đạt implement, Phú tích hợp

- POST `/auth/register`: `{email,password,displayName}`; 201 `{user:{id,email,displayName,role}}`, set session cookie. Email tồn tại 409; input sai 422.
- POST `/auth/login`: `{email,password}`; 200 `{user}` và cookie; 401 thông báo chung khi sai thông tin; 429 quá nhiều lần.
- POST `/auth/logout`: 204; revoke token và clear cookie; lặp lại vẫn an toàn.
- GET `/auth/me`: 200 `{user}`; 401 chưa login. Không trả password_hash hoặc session token.
- GET `/auth/csrf`: 200 `{csrfToken}`; frontend gửi `X-CSRF-Token` ở POST/PATCH/DELETE; cơ chế token/session cần Đạt chốt tuần 2.

## Auctions — Đạt implement, Phú UI

- GET `/categories`: `{items:[{id,slug,name}]}`. Implemented public read endpoint;
  thứ tự ổn định theo slug rồi ID, database chưa có danh mục trả `{items:[]}`.
  Query parameters không hỗ trợ được bỏ qua; chưa có category write endpoint.
- GET `/auctions?query=&categoryId=&status=ACTIVE&page=1&pageSize=20`: `{items,total,page,pageSize}`; whitelist sort, không ghép input thành SQL.
- GET `/auctions/:id`: `{auction: AuctionSnapshot, description, imageUrl, seller:{id,displayName}, category:{id,name}}`. Không trả email seller.
- POST `/auctions`: auth; `{title,description,categoryId,imageUrl,openingPriceVnd,minimumIncrementVnd,startsAt,endsAt}`; 201 `{auction}` trạng thái DRAFT.
- PATCH `/auctions/:id`: owner, draft only, 200 `{auction}`; 403 không là owner, 409 sai trạng thái.
- DELETE `/auctions/:id`: owner, draft only; 204. Chưa có bid nên hard delete draft chấp nhận được; không xóa lịch sử auction đã công bố.
- POST `/auctions/:id/publish`: owner; 200 `{auction}` ACTIVE/SCHEDULED, kiểm tra trường bắt buộc/thời gian.
- GET `/me/auctions`: phiên do current user tạo; không nhận sellerId từ client.
- GET `/me/bids`: lịch sử cá nhân + trạng thái các phiên, paginate.
- GET `/auctions/:id/result`: ENDED -> 200 `{auctionId,winner:{id,displayName}|null,finalPriceVnd:null|string,closedAt}`; chưa kết thúc 409 `RESULT_NOT_READY`; CANCELLED trả trạng thái hủy rõ ràng.

## Bids — Đạt chủ nghiệp vụ, Bảo reviewer concurrency

- POST `/auctions/:id/bids`: session + CSRF; header `Idempotency-Key: <uuid>`; body `{amountVnd}`; 201 `{auction,bidId}` nếu tạo mới, 200 khi trả lại request đã chấp nhận. User ID lấy session.
- GET `/auctions/:id/bids?page=1&pageSize=20`: `{items:[{id,amountVnd,bidderDisplayName,createdAt}],total,page,pageSize}`. Không expose email/IP.
- 401 `UNAUTHENTICATED`; 403 `SELF_BIDDING`/`ACCOUNT_DISABLED`; 404 `NOT_FOUND`; 409 `AUCTION_NOT_ACTIVE`/`BID_TOO_LOW`/`IDEMPOTENCY_CONFLICT`; 422 input không hợp lệ; 429 rate limit.
- Client bị timeout không kết luận bid thất bại: resync snapshot/history và retry cùng key. Sau thành công hoặc lỗi nghiệp vụ kết thúc lần thử mới tạo key tiếp theo.

## Admin — Đạt backend, Phú giao diện

- POST `/admin/auctions/:id/cancel`: ADMIN + `{reason}`; cập nhật status/version và audit log; emit trạng thái mới sau commit. ENDED không hủy ngược.
- PATCH `/admin/users/:id`: ADMIN + `{disabled:boolean,reason}`; revoke sessions khi disable, audit log; không cho tự disable admin cuối cùng.

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
Visibility CANCELLED, quyền ADMIN đọc draft, payload list/sort, CSRF bootstrap
và response result CANCELLED còn cần review ở các gate ghi trong DB-DOMAIN.
Ví dụ không chốt các quyết định đó hoặc chứng minh route đã hoạt động.
