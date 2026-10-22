import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { AuctionSnapshot, AuctionStatus } from "@bidhub/contracts";
import type { PreviewAuction } from "../mocks/auctions";
import { formatMoney } from "../lib/format";
const labels: Record<AuctionStatus, string> = {
  ACTIVE: "Đang diễn ra",
  SCHEDULED: "Sắp diễn ra",
  ENDED: "Đã kết thúc",
  CANCELLED: "Đã hủy",
  DRAFT: "Bản nháp",
};
export function StatusBadge({ status }: { status: AuctionStatus }) {
  return (
    <span className={`badge badge-${status.toLowerCase()}`}>
      <span aria-hidden="true">●</span> {labels[status]}
    </span>
  );
}
export function StatePanel({
  kind,
  onRetry,
}: {
  kind: "loading" | "error" | "empty";
  onRetry?: () => void;
}) {
  const content = {
    loading: ["Đang tải phiên đấu giá", "Vui lòng chờ trong giây lát."],
    error: [
      "Chưa thể tải dữ liệu",
      "Đây là trạng thái lỗi mô phỏng. Bạn có thể thử tải lại.",
    ],
    empty: [
      "Chưa tìm thấy phiên phù hợp",
      "Thử từ khóa khác hoặc bỏ bớt bộ lọc để tiếp tục khám phá.",
    ],
  }[kind];
  return (
    <section
      className={`state-panel ${kind}`}
      role={kind === "error" ? "alert" : "status"}
      aria-live="polite"
    >
      <span className="state-symbol" aria-hidden="true">
        {kind === "loading" ? "◌" : kind === "error" ? "!" : "⌕"}
      </span>
      <h2>{content[0]}</h2>
      <p>{content[1]}</p>
      {onRetry && (
        <button className="button secondary" onClick={onRetry}>
          {kind === "error" ? "Thử lại" : "Xóa bộ lọc"}
        </button>
      )}
    </section>
  );
}
export function Countdown({
  auction,
  receivedAt,
}: {
  auction: AuctionSnapshot;
  receivedAt: number;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (auction.status !== "ACTIVE") return <span>{labels[auction.status]}</span>;
  const seconds = Math.max(
    0,
    Math.floor(
      (Date.parse(auction.endsAt) -
        (Date.parse(auction.serverTime) + now - receivedAt)) /
        1000,
    ),
  );
  if (!seconds) return <span>Chờ server xác nhận kết quả</span>;
  const h = Math.floor(seconds / 3600),
    m = Math.floor((seconds % 3600) / 60),
    s = seconds % 60;
  return (
    <span className="countdown">
      {[h, m, s].map((value) => String(value).padStart(2, "0")).join(" : ")}
    </span>
  );
}
export function ProductArt({
  kind,
}: {
  kind: PreviewAuction["preview"]["artwork"];
}) {
  return (
    <div className={`product-art art-${kind}`}>
      <svg
        viewBox="0 0 320 220"
        role="img"
        aria-label="Hình vẽ minh họa sản phẩm mẫu"
      >
        <ellipse
          cx="160"
          cy="178"
          rx="90"
          ry="10"
          fill="currentColor"
          opacity=".08"
        />
        {kind === "camera" && (
          <g stroke="#323d39" strokeWidth="3">
            <path d="M77 80h40l10-16h57l13 16h45v91H77z" fill="#d1d5ca" />
            <path d="M77 102h165v57H77z" fill="#43544d" />
            <circle cx="164" cy="125" r="45" fill="#a9b5a8" />
            <circle cx="164" cy="125" r="34" fill="#263a32" />
            <circle cx="164" cy="125" r="22" fill="#172b25" />
            <circle cx="157" cy="117" r="8" fill="#a1b3a6" opacity=".5" />
            <path d="M90 72h22v8H90z" fill="#2e4037" />
            <rect x="209" y="88" width="21" height="12" rx="2" fill="#eef0df" />
          </g>
        )}
        {kind === "headphones" && (
          <g stroke="#3b443e" strokeWidth="11" fill="none">
            <path d="M104 134V99a56 56 0 0 1 112 0v35" />
            <path
              d="M111 103V94a49 49 0 0 1 98 0v9"
              stroke="#b4b6a7"
              strokeWidth="7"
            />
            <rect
              x="90"
              y="113"
              width="36"
              height="65"
              rx="17"
              fill="#657265"
              strokeWidth="3"
            />
            <rect
              x="194"
              y="113"
              width="36"
              height="65"
              rx="17"
              fill="#657265"
              strokeWidth="3"
            />
          </g>
        )}
        {kind === "watch" && (
          <g>
            <rect
              x="140"
              y="26"
              width="40"
              height="165"
              rx="10"
              fill="#665749"
            />
            <circle cx="160" cy="110" r="46" fill="#b8aa87" />
            <circle
              cx="160"
              cy="110"
              r="39"
              fill="#f8f1dd"
              stroke="#625b47"
              strokeWidth="2"
            />
            <path
              d="M160 80v31l21 13"
              stroke="#3c493d"
              strokeWidth="3"
              fill="none"
            />
            <circle cx="160" cy="110" r="3" fill="#3c493d" />
            <path
              d="M160 76v5m0 58v5m-34-34h5m58 0h5"
              stroke="#3c493d"
              strokeWidth="2"
            />
          </g>
        )}
        {kind === "chair" && (
          <g stroke="#846c50" strokeWidth="9" strokeLinecap="round">
            <path
              d="M112 130l-10 50m100-50 12 50M105 85l9 46h88l12-46"
              fill="none"
            />
            <rect
              x="109"
              y="63"
              width="102"
              height="58"
              rx="19"
              fill="#a0a58c"
              strokeWidth="3"
            />
            <rect
              x="104"
              y="120"
              width="112"
              height="21"
              rx="9"
              fill="#b2b69d"
              strokeWidth="3"
            />
          </g>
        )}
        {kind === "turntable" && (
          <g>
            <rect
              x="65"
              y="72"
              width="190"
              height="102"
              rx="5"
              fill="#8d7358"
            />
            <rect x="72" y="78" width="176" height="83" rx="3" fill="#bba68b" />
            <ellipse cx="145" cy="118" rx="56" ry="34" fill="#29352f" />
            <ellipse cx="145" cy="118" rx="23" ry="14" fill="#bd9670" />
            <path
              d="M222 92v41l-33 10"
              fill="none"
              stroke="#e7e5cf"
              strokeWidth="5"
            />
            <circle cx="223" cy="91" r="7" fill="#3d4942" />
          </g>
        )}
      </svg>
      <span className="art-caption">Hình minh họa</span>
    </div>
  );
}
export function AuctionCard({ item }: { item: PreviewAuction }) {
  return (
    <article className="auction-card">
      <Link
        className="card-image"
        to={`/auctions/${item.auction.id}`}
        aria-label={`Xem ${item.auction.title}`}
      >
        <ProductArt kind={item.preview.artwork} />
        <StatusBadge status={item.auction.status} />
      </Link>
      <div className="card-content">
        <p className="eyebrow">{item.category.name}</p>
        <h3>
          <Link to={`/auctions/${item.auction.id}`}>{item.auction.title}</Link>
        </h3>
        <div className="card-price">
          <div>
            <span className="field-caption">
              {item.preview.bidCount ? "Giá hiện tại" : "Giá khởi điểm"}
            </span>
            <strong>{formatMoney(item.auction.currentPriceVnd)}</strong>
          </div>
          <span className="muted">{item.preview.bidCount} lượt mẫu</span>
        </div>
        <div className="card-bottom">
          <span>
            {item.auction.status === "ACTIVE" ? "Còn lại" : "Trạng thái"}
          </span>
          <Countdown
            auction={item.auction}
            receivedAt={item.preview.receivedAt}
          />
        </div>
      </div>
    </article>
  );
}
