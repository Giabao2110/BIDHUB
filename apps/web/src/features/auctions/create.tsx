import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { previewCategories } from "../../mocks/auctions";
export function CreateAuction() {
  const [feedback, setFeedback] = useState<{
    error: boolean;
    text: string;
  } | null>(null);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const price = String(data.get("openingPriceVnd")),
      increment = String(data.get("minimumIncrementVnd"));
    if (
      !String(data.get("title")).trim() ||
      !String(data.get("description")).trim()
    ) {
      setFeedback({
        error: true,
        text: "Tên và mô tả cần có nội dung, không chỉ khoảng trắng.",
      });
      return;
    }
    if (
      ![price, increment].every(
        (value) =>
          /^[1-9]\d*$/.test(value) && BigInt(value) <= 9223372036854775807n,
      )
    ) {
      setFeedback({
        error: true,
        text: "Giá và bước giá phải là số nguyên VND dương trong giới hạn BIGINT.",
      });
      return;
    }
    const start = new Date(String(data.get("startsAt"))).getTime(),
      end = new Date(String(data.get("endsAt"))).getTime();
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start <= Date.now() ||
      end <= start
    ) {
      setFeedback({
        error: true,
        text: "Chọn thời gian bắt đầu trong tương lai và kết thúc sau thời gian bắt đầu.",
      });
      return;
    }
    setFeedback({
      error: false,
      text: "Biểu mẫu hợp lệ. Chưa tạo hoặc lưu phiên; chức năng lưu bản nháp và công bố sẽ tích hợp ở BH-10.",
    });
  }
  return (
    <>
      <Link className="back-link" to="/auctions">
        ← Khám phá
      </Link>
      <div className="page-heading">
        <p className="eyebrow">DÀNH CHO NGƯỜI BÁN</p>
        <h1>
          Món đồ của bạn.
          <br />
          <em>Câu chuyện tiếp theo.</em>
        </h1>
        <p>Chuẩn bị thông tin để tạo một phiên đấu giá.</p>
      </div>
      <div className="create-layout">
        <section className="form-panel">
          <span className="sample-chip">Wireframe · Không lưu dữ liệu</span>
          <form onSubmit={submit} onChange={() => setFeedback(null)}>
            <h2>Thông tin sản phẩm</h2>
            <label>
              Tên sản phẩm
              <input
                name="title"
                maxLength={160}
                required
                placeholder="Ví dụ: Máy ảnh Fujifilm X100V"
              />
            </label>
            <label>
              Danh mục
              <select
                name="categoryId"
                aria-label="Danh mục"
                required
                defaultValue=""
              >
                <option value="" disabled>
                  Chọn danh mục
                </option>
                {previewCategories.map((name, index) => (
                  <option
                    key={name}
                    value={`30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`}
                  >
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Mô tả
              <textarea
                name="description"
                rows={4}
                required
                placeholder="Tình trạng, phụ kiện đi kèm và những điều người mua cần biết…"
              />
            </label>
            <p className="helper">
              Tuần 1 dùng hình minh họa có sẵn. Upload ảnh nằm ngoài MVP.
            </p>
            <h2>Thiết lập phiên</h2>
            <div className="form-row">
              <label>
                Giá khởi điểm (VND)
                <input
                  name="openingPriceVnd"
                  type="text"
                  inputMode="numeric"
                  pattern="[1-9][0-9]*"
                  required
                  placeholder="1000000"
                />
              </label>
              <label>
                Bước giá (VND)
                <input
                  name="minimumIncrementVnd"
                  type="text"
                  inputMode="numeric"
                  pattern="[1-9][0-9]*"
                  required
                  placeholder="100000"
                />
              </label>
            </div>
            <div className="form-row">
              <label>
                Bắt đầu
                <input name="startsAt" type="datetime-local" required />
              </label>
              <label>
                Kết thúc
                <input name="endsAt" type="datetime-local" required />
              </label>
            </div>
            <p className="helper">
              Nhập theo múi giờ thiết bị. Khi tích hợp, thời gian được chuyển
              sang ISO UTC trước khi gửi API.
            </p>
            <button className="button" type="submit">
              Kiểm tra bản nháp →
            </button>
            {feedback && (
              <p
                className={`notice ${feedback.error ? "notice-error" : ""}`}
                role={feedback.error ? "alert" : "status"}
              >
                {feedback.text}
              </p>
            )}
          </form>
        </section>
        <aside className="seller-guide">
          <p className="eyebrow">TỪ BẢN NHÁP ĐẾN PHIÊN ĐẤU GIÁ</p>
          <ol>
            <li>
              <strong>Chuẩn bị thông tin</strong>
              <p>Mô tả rõ sản phẩm và đặt mức giá mở đầu.</p>
            </li>
            <li>
              <strong>Xem lại bản nháp</strong>
              <p>Bạn được sửa trước khi công bố.</p>
            </li>
            <li>
              <strong>Công bố phiên</strong>
              <p>
                Sau khi công bố, giá và thời gian được quản lý theo quy tắc hệ
                thống.
              </p>
            </li>
          </ol>
          <p className="helper">
            Luồng thật sẽ yêu cầu đăng nhập và kiểm tra quyền từ server.
          </p>
        </aside>
      </div>
    </>
  );
}
