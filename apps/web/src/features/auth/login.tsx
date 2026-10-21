import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
export function Login() {
  const [message, setMessage] = useState("");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(
      "Biểu mẫu hợp lệ trên trình duyệt. Chưa gửi thông tin: API đăng nhập sẽ được tích hợp ở BH-06.",
    );
  }
  return (
    <div className="auth-layout">
      <section className="auth-story">
        <p className="eyebrow">CHÀO MỪNG ĐẾN BIDHUB</p>
        <h1>
          Cơ hội tiếp theo
          <br />
          đang chờ <em>bạn.</em>
        </h1>
        <p>
          Một tài khoản để tạo phiên, theo dõi món đồ yêu thích và tham gia đấu
          giá.
        </p>
        <div className="auth-outline">
          <span>01</span>
          <p>Khám phá món đồ</p>
          <span>02</span>
          <p>Đặt mức giá của bạn</p>
          <span>03</span>
          <p>Theo dõi đến phút cuối</p>
        </div>
      </section>
      <section className="form-panel">
        <span className="sample-chip">Wireframe · Chưa tích hợp auth</span>
        <h2>Đăng nhập</h2>
        <p className="muted">Chào bạn, hãy tiếp tục hành trình khám phá.</p>
        <form onSubmit={submit} onChange={() => setMessage("")}>
          <label>
            Email
            <input
              name="email"
              type="email"
              autoComplete="email"
              placeholder="ban@example.com"
              required
              maxLength={254}
            />
          </label>
          <label>
            Mật khẩu
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="Nhập mật khẩu"
              required
              aria-describedby="login-note"
            />
          </label>
          <p id="login-note" className="helper">
            Bản xem trước chỉ kiểm tra biểu mẫu, không xác thực hoặc lưu mật
            khẩu.
          </p>
          <button className="button full" type="submit">
            Kiểm tra biểu mẫu →
          </button>
          {message && (
            <p className="notice" role="status">
              {message}
            </p>
          )}
        </form>
        <p className="helper">
          Đăng ký và khôi phục phiên sẽ được bổ sung trong giai đoạn tài khoản.
        </p>
        <Link className="text-link" to="/auctions">
          ← Tiếp tục khám phá
        </Link>
      </section>
    </div>
  );
}
