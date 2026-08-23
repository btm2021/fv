# SMC • VSR • Dual ATR Bot Real-Time Trading Engine (Pure JavaScript)

Hệ thống biểu đồ phân tích kỹ thuật thời gian thực chạy hoàn toàn bằng **Pure JavaScript**, kết nối trực tiếp đến **Binance Futures API & WebSocket**, tải và lưu trữ **20.000 nến (20k)** vào `localStorage` của trình duyệt, tích hợp các chỉ báo nâng cao (**SMC FVG**, **VSR 10-10**, **Dual ATR Bot VIDYA**) và công cụ đo lường chuyên nghiệp (**Shift + Click Measure**).

---

## 📁 Cấu trúc thư mục dự án

```
testforexflow/
├── index.html       # Giao diện chính (mở trực tiếp bằng Live Server)
├── style.css        # Giao diện Dark Glassmorphism, Toolbar, Dropdown & Measure styles
├── app.js           # Xử lý chính: Tải 20k nến, Caching, WebSocket, Search Symbol, Measure Tool
├── smc.js           # Engine tính Smart Money Concepts (Fair Value Gap - FVG 1:1)
├── vsr.js           # Engine tính Volume Spike Reversal (VSR 10-10 & Zones)
├── atrbot.js        # Engine tính ATR Dynamic Trailing Stop (Hỗ trợ VIDYA CMO-9)
├── libs/            # Thư viện cục bộ (TradingView Lightweight Charts v4, PapaParse)
└── README.md        # Tài liệu hướng dẫn sử dụng
```

---

## 🚀 Các tính năng chính

### 1. Tải & Lưu trữ 20.000 nến vào `localStorage` (Crypto & Forex)
- Hỗ trợ cả **Binance Futures API** (Crypto) và **Yahoo Finance API v8** (Forex, Vàng `GC=F`, DXY, Dầu thô `CL=F`, v.v.).
- Tải lên đến 20.000 nến lịch sử và lưu trữ dạng mảng nén (`[time, open, high, low, close, volume]`) vào `localStorage`.
- **Cache-First**: Mở trang là nạp ngay 20.000 nến trong **< 15ms**, tự động kiểm tra và kéo bù nến mới (Delta Sync).
- **Multi-tier CORS Resilience**: Tự động chuyển đổi mượt mà qua các kênh kết nối và proxy dự phòng nếu trình duyệt gặp hạn chế CORS.
- **Real-time Live Streaming**: Tự động stream WebSocket cho Binance và vòng lặp Live Polling 5s cho Yahoo Forex.

### 2. Tìm kiếm Symbol & Lọc Danh mục
- Hỗ trợ toàn bộ cặp tiền tệ Forex chính (`EURUSD=X`, `GBPUSD=X`, `USDJPY=X`, `USDVND=X`, `GC=F` Vàng, v.v.) và hơn 700+ cặp coin USDT Perpetual.
- Hiển thị đầy đủ **Giá mới nhất**, **% Biến động 24h**, **Khối lượng giao dịch**.
- Sắp xếp nhanh theo Volume (`Vol ▾`) hoặc % Tăng giảm (`Chg%`).
- Lọc theo danh mục: `ALL`, `💱 FOREX`, `🔥 HOT`, `USDT`, `MEME`, `L1/L2`.

### 3. Bộ 3 chỉ báo phân tích kỹ thuật (Pure JavaScript)
1. **SMC Fair Value Gap (FVG)**:
   - Phát hiện chính xác khoảng trống thanh khoản Bullish (+FVG) và Bearish (-FVG).
   - Theo dõi trạng thái đã lấp (Mitigated) hay chưa lấp (Active).
   - Thống kê tỷ lệ Mitigation Rate, kích thước trung bình và bảng nhảy nến.
2. **VSR (Volume Spike Reversal 10-10)**:
   - Phát hiện đột biến khối lượng với ngưỡng chuẩn độ lệch chuẩn (10-10).
   - Tự động vẽ vùng cản hỗ trợ/kháng cự Upper & Lower Zone và đánh dấu tia sét `⚡ VSR`.
3. **Dual ATR Bot (VIDYA Moving Average)**:
   - **ATR Bot 1 (Trend / Dài hạn)**: VIDYA chu kỳ 14, độ dài MA 55, hệ số Multiplier 4.0.
   - **ATR Bot 2 (Scalp / Ngắn hạn)**: VIDYA chu kỳ 14, độ dài MA 21, hệ số Multiplier 2.0.
   - Tự động hiển thị dải mây xu hướng (Trend Ribbon) và tín hiệu mũi tên Buy/Sell.

### 4. Thước đo khoảng giá & số nến (Shift + Click Measure Tool)
- Giữ phím **`Shift`** và click chuột trái trên biểu đồ để đo vùng giá.
- Di chuột và click lần 2 để ghim thước đo cố định.
- Thẻ thông số hiển thị trực tiếp: Biến động giá `$`, Tỷ lệ `%`, Số lượng nến `bars`, Thời gian `duration`, và Tổng khối lượng giao dịch `Volume`.
- Nhấn phím **`Escape`** hoặc click chuột bình thường để đóng thước đo.

### 5. Sidebar trượt ẩn/hiện & Phím tắt
- Bấm nút `◀` trên Sidebar để ẩn bảng chỉ báo sang mép trái, biểu đồ tự bung 100% màn hình.
- Phím tắt: **`[`** hoặc **`Ctrl + B`** để ẩn/hiện Sidebar nhanh.

---

## 💻 Cách chạy ứng dụng

1. Mở thư mục `testforexflow` trong VS Code.
2. Click chuột phải vào `index.html` và chọn **Open with Live Server** (hoặc mở cổng `http://localhost:5500/index.html`).
3. Ứng dụng tự động kết nối và tải nến trực tiếp từ Binance Futures mà không cần cài đặt thêm bất kỳ phần mềm hay Python backend nào.
