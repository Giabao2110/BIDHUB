import { useEffect, useRef } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
export function Layout() {
  const { pathname } = useLocation();
  const previousPath = useRef(pathname);
  useEffect(() => {
    window.scrollTo(0, 0);
    if (previousPath.current !== pathname) {
      document.getElementById("content")?.focus();
      previousPath.current = pathname;
    }
  }, [pathname]);
  return (
    <>
      <a className="skip-link" href="#content">
        Đến nội dung chính
      </a>
      <div className="preview-banner">
        <span className="preview-dot" />
        Bản xem trước tuần 1 <span className="banner-divider">/</span> Dữ liệu
        mẫu · Chưa kết nối giao dịch thật
      </div>
      <header className="site-header">
        <div className="header-inner">
          <Link className="brand" to="/" aria-label="BIDHUB — Trang khám phá">
            <span className="brand-mark" aria-hidden="true">
              b.
            </span>
            BIDHUB
          </Link>
          <nav aria-label="Điều hướng chính">
            <NavLink to="/auctions" end>
              Khám phá
            </NavLink>
            <NavLink to="/auctions/new">Tạo phiên</NavLink>
            <NavLink to="/dashboard">Cá nhân</NavLink>
          </nav>
          <Link className="button small secondary login-link" to="/login">
            Đăng nhập <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </header>
      <main id="content" className="page-shell" tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="site-footer">
        <Link className="brand" to="/">
          BIDHUB<span className="brand-dot">.</span>
        </Link>
        <p>Một món đồ hay. Một cơ hội mới.</p>
        <span>Đồ án Web · Giao diện mẫu 2026</span>
      </footer>
    </>
  );
}
