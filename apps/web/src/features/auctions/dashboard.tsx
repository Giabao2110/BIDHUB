import { useSearchParams, Link } from "react-router-dom";
import { auctionFixtures } from "../../mocks/auctions";
import { StatusBadge } from "../../components/ui";
import { formatMoney } from "../../lib/format";
export function Dashboard() {
  const [params] = useSearchParams();
  const tab = params.get("tab") === "bids" ? "bids" : "auctions";
  const items =
    tab === "auctions"
      ? auctionFixtures.filter((item) =>
          ["DRAFT", "ACTIVE", "SCHEDULED"].includes(item.auction.status),
        )
      : auctionFixtures.filter((item) => item.preview.bidCount > 0);
  return (
    <>
      <div className="page-heading dashboard-heading">
        <div>
          <p className="eyebrow">KHÔNG GIAN CÁ NHÂN · MẪU</p>
          <h1>
            Theo dõi hành trình
            <br />
            <em>đấu giá của bạn.</em>
          </h1>
          <p>Bố cục tài khoản mẫu, chưa có người dùng đăng nhập.</p>
        </div>
        <Link className="button" to="/auctions/new">
          + Tạo phiên mẫu
        </Link>
      </div>
      <div className="dashboard-note notice">
        Dữ liệu bên dưới chỉ minh họa bố cục. Phiên của tôi và lượt trả giá của
        tôi sẽ lấy từ API sau khi xác thực.
      </div>
      <div className="dashboard-tabs" aria-label="Chọn danh sách cá nhân">
        <Link
          to="?tab=auctions"
          aria-current={tab === "auctions" ? "page" : undefined}
        >
          Phiên của tôi
        </Link>
        <Link to="?tab=bids" aria-current={tab === "bids" ? "page" : undefined}>
          Lượt trả giá của tôi
        </Link>
      </div>
      <div className="dashboard-list">
        {items.map((item) => (
          <article className="dashboard-row" key={item.auction.id}>
            <div>
              <p className="eyebrow">{item.category.name}</p>
              <h2>{item.auction.title}</h2>
            </div>
            <StatusBadge status={item.auction.status} />
            <strong>{formatMoney(item.auction.currentPriceVnd)}</strong>
            {item.auction.status === "DRAFT" ? (
              <span className="helper">Chờ tích hợp sửa bản nháp</span>
            ) : (
              <Link className="text-link" to={`/auctions/${item.auction.id}`}>
                Xem phiên ↗
              </Link>
            )}
          </article>
        ))}
      </div>
    </>
  );
}
