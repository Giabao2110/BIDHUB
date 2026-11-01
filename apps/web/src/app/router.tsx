import { createBrowserRouter, Link, Navigate } from "react-router-dom";
import { AppShell } from "./layout";
import { RequireAuth } from "../features/auth/session";
import { Login } from "../features/auth/login";
import { AuctionList, AuctionDetail } from "../features/auctions/browse";
import { CreateAuction } from "../features/auctions/create";
import { Dashboard } from "../features/auctions/dashboard";
import {
  AuctionList as PreviewList,
  AuctionDetail as PreviewDetail,
} from "../features/preview/browse";
import { CreateAuction as PreviewCreate } from "../features/preview/create";
import { Dashboard as PreviewDashboard } from "../features/preview/dashboard";
import { Login as PreviewLogin } from "../features/preview/login";
const notFound = (
  <section className="state-panel">
    <p className="eyebrow">404</p>
    <h1>This page is not on BIDHUB</h1>
    <Link className="button" to="/auctions">
      Back to discover
    </Link>
  </section>
);
export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    errorElement: (
      <main className="page-shell">
        <h1>Unable to open this page</h1>
        <p>
          Please reload the page. The server returned an unexpected response.
        </p>
        <a href="/auctions">Back to discover</a>
      </main>
    ),
    children: [
      { index: true, element: <Navigate to="/auctions" replace /> },
      { path: "auctions", element: <AuctionList /> },
      {
        path: "auctions/new",
        element: (
          <RequireAuth>
            <CreateAuction />
          </RequireAuth>
        ),
      },
      {
        path: "auctions/:id/edit",
        element: (
          <RequireAuth>
            <CreateAuction />
          </RequireAuth>
        ),
      },
      { path: "auctions/:id", element: <AuctionDetail /> },
      { path: "login", element: <Login /> },
      { path: "register", element: <Login register /> },
      {
        path: "dashboard",
        element: (
          <RequireAuth>
            <Dashboard />
          </RequireAuth>
        ),
      },
      { path: "*", element: notFound },
    ],
  },
  {
    path: "/preview",
    element: <AppShell preview />,
    children: [
      { index: true, element: <Navigate to="/preview/auctions" replace /> },
      { path: "auctions", element: <PreviewList /> },
      { path: "auctions/new", element: <PreviewCreate /> },
      { path: "auctions/:id", element: <PreviewDetail /> },
      { path: "login", element: <PreviewLogin /> },
      { path: "dashboard", element: <PreviewDashboard /> },
      { path: "*", element: notFound },
    ],
  },
]);
