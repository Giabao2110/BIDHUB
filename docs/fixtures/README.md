# BH-02-A — mock contract scenarios

`auctions.ts` chứa 6 scenario cố định tại serverTime
`2026-10-14T03:00:00.000Z` (10:00 Việt Nam). Đây là dữ liệu tổng hợp,
không phải seed, DB dump hoặc response nhận từ API đang chạy. UI mock nên
dùng đồng hồ fixture; lấy giờ máy thực sẽ làm ACTIVE/SCHEDULED bị lỗi thời.

Mỗi scenario có `response` theo detail contract, `history` là items của
GET bids, `result` chỉ có payload cho ENDED. `result: null` ở scenario khác
là metadata chưa có mẫu, không phải response HTTP null. `audience`,
`openingPriceVnd`, `startsAt`, `name` cũng chỉ là metadata.

| Scenario | Dùng để review |
|---|---|
| draft-owner | Owner detail riêng, không xuất public list/room |
| scheduled | Countdown đến giờ mở; không bid |
| active | Có accepted bid, currentPrice/bidId/history khớp |
| ended-winner | Winner và finalPrice khớp history |
| cancelled-after-publish | Trạng thái hủy; visibility public là đề xuất, result shape chưa chốt |
| ended-no-bids | currentPrice vẫn opening, winner/finalPrice null |

Import trực tiếp fixture khi làm mock; không thêm nó vào app/API runtime hoặc
barrel shared contracts. Bảo review mapping schema/types; Phú review detail,
history và result payload. Chưa có phê duyệt của hai reviewer.

## Request/response mẫu (planned)

Các ví dụ sau không phải lệnh smoke test đối với baseline: routes vẫn chưa có.

```http
GET /api/v1/auctions/30000000-0000-4000-8000-000000000003
```

200 JSON là `scenarios[2].response`, tương đương:

```json
{
  "auction": {
    "id": "30000000-0000-4000-8000-000000000003",
    "title": "Active monitor",
    "status": "ACTIVE",
    "currentPriceVnd": "110000",
    "minimumIncrementVnd": "10000",
    "endsAt": "2026-10-14T03:30:00.000Z",
    "serverTime": "2026-10-14T03:00:00.000Z",
    "version": 2
  },
  "description": "Synthetic demonstration item; no real user data.",
  "imageUrl": null,
  "seller": {"id":"10000000-0000-4000-8000-000000000001","displayName":"Demo Seller"},
  "category": {"id":"20000000-0000-4000-8000-000000000001","name":"Electronics"}
}
```

```http
GET /api/v1/auctions/30000000-0000-4000-8000-000000000003/bids?page=1&pageSize=20
```

200: `{items: scenarios[2].history, total: 1, page: 1, pageSize: 20}`.
GET `/api/v1/auctions/30000000-0000-4000-8000-000000000004/result` trả
200 `scenarios[3].result`. Scenario `[5]` là mẫu result không bid.

Mẫu request đã tạo accepted bid ACTIVE ở `02:30Z`, từ session Demo Buyer:

```http
POST /api/v1/auctions/30000000-0000-4000-8000-000000000003/bids
Content-Type: application/json
Idempotency-Key: 60000000-0000-4000-8000-000000000001
X-CSRF-Token: <token obtained through the reviewed auth flow>
Cookie: <session cookie>
Origin: <configured web origin>

{"amountVnd":"110000"}
```

201 body theo `acceptedBid` (version 2, serverTime `02:30Z`,
bidId `40000000-0000-4000-8000-000000000001`).
Retry cùng key trả 200 với cùng bidId; snapshot replay ban đầu hay mới nhất
sẽ chốt trước BH-11. Không coi fixture serverTime của GET lúc 03:00Z là
quyết định timestamp của response POST/replay.
Request mới giá `"110000"` khi current đã `"110000"` trả 409 `bidTooLow`:

```json
{"error":{"code":"BID_TOO_LOW","message":"Bid must meet the minimum amount.","requestId":"50000000-0000-4000-8000-000000000001"}}
```

Các lỗi cơ sở giữ API-CONTRACT: 401 UNAUTHENTICATED; 403 SELF_BIDDING /
ACCOUNT_DISABLED; 404 NOT_FOUND; 409 AUCTION_NOT_ACTIVE / BID_TOO_LOW /
IDEMPOTENCY_CONFLICT / RESULT_NOT_READY; 422 input sai; 429 rate limit.
Không gán code mới cho 422/429 khi chưa chốt validation/auth contract.

## Kiểm tra

Sau `npm ci`, Node 24/npm 11, từ repo root:

```sh
npm exec -- tsc --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext docs/fixtures/auctions.ts docs/fixtures/auctions.test.ts
node --import tsx --test docs/fixtures/auctions.test.ts
npm run typecheck
npm test
npm run build
git diff --check
```

Fixture tests kiểm tra status/UUID/range tiền/time, lifecycle, result và public
data. Typecheck bổ sung kiểm tra fixture với shared contracts. Main hiện có
policy, after-commit, socket room, lifecycle DB và scheduler tests; đọc script
`apps/api/package.json` để biết suite thực chạy. Lifecycle DB tests cần
`TEST_DATABASE_URL`, có thể bị skip khi thiếu DB; pass suite không đồng nghĩa
DB tests đã chạy. Fixture tests vẫn chạy riêng bằng lệnh trên.
Fixtures không kiểm thử API nghiệp vụ hoặc transaction bid; migrate/seed
mới thuộc BH-03. Khi đồng bộ main `3439b9b` ngày 22/10/2026, typecheck,
build, format check, fixture types/tests và `npm test` đã pass. Suite hiện có
chạy 9/9 tests, không skip, gồm lifecycle trên PostgreSQL 17 tạm cô lập và
socket server/client thật. Đây là regression code chung, không chứng minh
bid/cancel service chưa được xây. Browser preview và full-stack Compose
không chạy local trong lần kiểm tra tài liệu này; xem kết quả CI của PR.
Tài liệu [DB-DOMAIN](../DB-DOMAIN.md) ghi các quyết định còn mở để không dùng
mock thay kết quả tích hợp.
