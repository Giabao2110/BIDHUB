import { createBrowserRouter, Link, Navigate } from "react-router-dom";
import { Layout } from "./layout";
import { AuctionList, AuctionDetail } from "../features/auctions/browse";
import { CreateAuction } from "../features/auctions/create";
import { Login } from "../features/auth/login";
import { Dashboard } from "../features/auctions/dashboard";
export const router = createBrowserRouter([
  {
    element: <Layout />,
    errorElement: (
      <main className="page-shell">
        <h1>Không thể mở trang</h1>
        <p>Hãy tải lại trang hoặc quay về danh sách.</p>
        <a className="button" href="/auctions">
          Về khám phá
        </a>
      </main>
    ),
    children: [
      { index: true, element: <Navigate to="/auctions" replace /> },
      { path: "auctions", element: <AuctionList /> },
      { path: "auctions/new", element: <CreateAuction /> },
      { path: "auctions/:id", element: <AuctionDetail /> },
      { path: "login", element: <Login /> },
      { path: "dashboard", element: <Dashboard /> },
      {
        path: "*",
        element: (
          <section className="state-panel">
            <p className="eyebrow">404</p>
            <h1>Trang này chưa có ở BIDHUB</h1>
            <p>Quay lại để khám phá các phiên đấu giá mẫu.</p>
            <Link className="button" to="/auctions">
              Về khám phá
            </Link>
          </section>
        ),
      },
    ],
  },
]);
