import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  AuctionCard,
  Countdown,
  ProductArt,
  StatePanel,
  StatusBadge,
} from "../../components/ui";
import { previewCategories, readPreviewAuctions } from "../../mocks/auctions";
import { formatDate, formatMoney } from "../../lib/format";
export function AuctionList() {
  const [params, setParams] = useSearchParams();
  const query = params.get("query") ?? "",
    category = params.get("category") ?? "",
    status = params.get("status") ?? "",
    state = params.get("state") ?? "";
  const auctions = useQuery({
    queryKey: ["preview-auctions", state],
    queryFn: ({ signal }) => readPreviewAuctions(signal, state === "error"),
  });
  const setFilter = (key: string, value: string) =>
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });
  const filtered = (auctions.data ?? []).filter(
    (item) =>
      item.auction.status !== "DRAFT" &&
      item.auction.title
        .toLocaleLowerCase("vi")
        .includes(query.toLocaleLowerCase("vi")) &&
      (!category || item.category.name === category) &&
      (!status || item.auction.status === status),
  );
  const reset = () => setParams({});
  return (
    <>
      <section className="hero">
        <div>
          <p className="eyebrow">
            <span className="line-mark" />
            SÀN ĐẤU GIÁ TRỰC TUYẾN
          </p>
          <h1>
            Đồ hay có hẹn.
            <br />
            <em>Giá tốt do bạn.</em>
          </h1>
          <p className="hero-copy">
            Khám phá những món đồ đáng sở hữu.
            <br />
            Theo dõi phiên đấu giá và tìm cơ hội của bạn.
          </p>
          <a className="text-link" href="#auction-list">
            Khám phá các phiên <span aria-hidden="true">↓</span>
          </a>
        </div>
        <div className="hero-feature">
          <div className="feature-note">
            <span>GÓC KHÁM PHÁ</span>
            <span>01 / 05</span>
          </div>
          <ProductArt kind="camera" />
          <div className="feature-bottom">
            <span>Những món đồ có câu chuyện.</span>
            <span className="circle-arrow" aria-hidden="true">
              ↗
            </span>
          </div>
        </div>
      </section>
      <section id="auction-list" className="listing-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">CHỌN MÓN ĐỒ BẠN THÍCH</p>
            <h2>
              Khám phá phiên đấu giá<span className="brand-dot">.</span>
            </h2>
          </div>
          <span className="sample-chip">Dữ liệu minh họa</span>
        </div>
        <form
          className="filter-bar"
          onSubmit={(event) => event.preventDefault()}
        >
          <label className="search-field">
            <span className="sr-only">Tìm kiếm phiên đấu giá</span>
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              placeholder="Bạn đang tìm món đồ nào?"
              value={query}
              onChange={(event) => setFilter("query", event.target.value)}
            />
          </label>
          <label>
            <span className="sr-only">Danh mục</span>
            <select
              aria-label="Danh mục"
              value={category}
              onChange={(event) => setFilter("category", event.target.value)}
            >
              <option value="">Tất cả danh mục</option>
              {previewCategories.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Trạng thái phiên</span>
            <select
              aria-label="Trạng thái phiên"
              value={status}
              onChange={(event) => setFilter("status", event.target.value)}
            >
              <option value="">Tất cả trạng thái</option>
              <option value="ACTIVE">Đang diễn ra</option>
              <option value="SCHEDULED">Sắp diễn ra</option>
              <option value="ENDED">Đã kết thúc</option>
              <option value="CANCELLED">Đã hủy</option>
            </select>
          </label>
        </form>
        <div className="listing-meta">
          <span>
            {state === "empty" ? 0 : filtered.length} phiên mẫu
            {(query || category || status) && (
              <button className="inline-button" onClick={reset}>
                Xóa bộ lọc
              </button>
            )}
          </span>
          <label className="preview-control">
            Xem trạng thái UI{" "}
            <select
              aria-label="Trạng thái giao diện mẫu"
              value={state}
              onChange={(event) => setFilter("state", event.target.value)}
            >
              <option value="">Bình thường</option>
              <option value="loading">Đang tải</option>
              <option value="empty">Không có dữ liệu</option>
              <option value="error">Lỗi kết nối</option>
            </select>
          </label>
        </div>
        {auctions.isPending || state === "loading" ? (
          <StatePanel kind="loading" />
        ) : auctions.isError ? (
          <StatePanel kind="error" onRetry={() => setFilter("state", "")} />
        ) : !filtered.length || state === "empty" ? (
          <StatePanel kind="empty" onRetry={reset} />
        ) : (
          <div className="auction-grid">
            {filtered.map((item) => (
              <AuctionCard key={item.auction.id} item={item} />
            ))}
          </div>
        )}
      </section>
      <aside className="bottom-note">
        <span aria-hidden="true">↗</span>
        <div>
          <h2>Bắt đầu từ một món đồ của bạn.</h2>
          <p>Xem trước giao diện tạo phiên dành cho người bán.</p>
        </div>
        <Link className="button secondary" to="/auctions/new">
          Khám phá cách bán →
        </Link>
      </aside>
    </>
  );
}
export function AuctionDetail() {
  const { id } = useParams();
  const data = useQuery({
    queryKey: ["preview-auctions", ""],
    queryFn: ({ signal }) => readPreviewAuctions(signal),
  });
  if (data.isPending) return <StatePanel kind="loading" />;
  if (data.isError)
    return (
      <StatePanel
        kind="error"
        onRetry={() => {
          void data.refetch();
        }}
      />
    );
  const item = data.data.find(
    (row) => row.auction.id === id && row.auction.status !== "DRAFT",
  );
  if (!item)
    return (
      <section className="state-panel">
        <h1>Không tìm thấy phiên đấu giá</h1>
        <p>Phiên không tồn tại hoặc chưa được công bố.</p>
        <Link className="button" to="/auctions">
          Về danh sách
        </Link>
      </section>
    );
  return (
    <>
      <Link className="back-link" to="/auctions">
        ← Khám phá phiên đấu giá
      </Link>
      <div className="detail-grid">
        <div>
          <div className="detail-art">
            <ProductArt kind={item.preview.artwork} />
          </div>
          <section className="description">
            <p className="eyebrow">CHI TIẾT SẢN PHẨM</p>
            <h2>Mỗi món đồ, một câu chuyện</h2>
            <p>{item.description}</p>
            <dl className="facts">
              <div>
                <dt>Người bán</dt>
                <dd>{item.seller.displayName}</dd>
              </div>
              <div>
                <dt>Danh mục</dt>
                <dd>{item.category.name}</dd>
              </div>
              <div>
                <dt>Kết thúc dự kiến</dt>
                <dd>{formatDate(item.auction.endsAt)} (giờ Việt Nam)</dd>
              </div>
            </dl>
          </section>
        </div>
        <section className="bid-panel">
          <StatusBadge status={item.auction.status} />
          <p className="eyebrow detail-category">{item.category.name}</p>
          <h1>{item.auction.title}</h1>
          <p className="muted">
            Thông tin và lượt trả giá bên dưới là dữ liệu mẫu.
          </p>
          <div className="detail-price">
            <span>
              {item.preview.bidCount ? "Giá hiện tại" : "Giá khởi điểm"}
            </span>
            <strong>{formatMoney(item.auction.currentPriceVnd)}</strong>
            <span>
              Bước giá: {formatMoney(item.auction.minimumIncrementVnd)}
            </span>
          </div>
          <div className="timer-block">
            <span>
              {item.auction.status === "ACTIVE"
                ? "Thời gian còn lại"
                : "Trạng thái phiên"}
            </span>
            <strong>
              <Countdown
                auction={item.auction}
                receivedAt={item.preview.receivedAt}
              />
            </strong>
          </div>
          <button className="button full" disabled>
            Chờ tích hợp trả giá
          </button>
          <p className="helper">
            Chưa có API bid hoặc kết nối realtime. Không có giao dịch nào được
            gửi.
          </p>
          <Link className="text-link" to="/login">
            Xem giao diện đăng nhập ↗
          </Link>
          <div className="bid-history">
            <h2>Lịch sử trả giá</h2>
            <p>
              {item.preview.bidCount
                ? `${item.preview.bidCount} lượt trong bộ dữ liệu mẫu. Lịch sử chi tiết sẽ lấy từ API.`
                : "Chưa có lượt trả giá trong dữ liệu mẫu."}
            </p>
            {item.auction.status === "ENDED" && (
              <p role="status">
                Kết quả người thắng sẽ được xác nhận bằng API kết quả.
              </p>
            )}
            {item.auction.status === "CANCELLED" && (
              <p role="status">Phiên mẫu đã hủy, không nhận trả giá.</p>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
