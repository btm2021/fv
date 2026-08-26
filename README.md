# ⚡ STAT2 FUTURES PRO — REALTIME QUANTITATIVE TRADING TERMINAL & BOT

**STAT2 Futures Pro** là Terminal giao dịch định lượng & Bot phái sinh Crypto tự động thời gian thực được xây dựng bằng **Pure JavaScript / Node.js Express / SQLite3 / CCXT Pro**, kết nối trực tiếp đến **6 sàn giao dịch phái sinh lớn nhất thế giới** (**Binance, Bybit, OKX, Bitget, Gate.io, BingX**), tích hợp **3,945 cặp USDT Perpetual** (chiếm 90% số lượng hợp đồng có thanh khoản tốt nhất), biểu đồ nến **TradingView Lightweight Charts v4**, bộ công cụ vẽ kỹ thuật đa năng (**Line, Rectangle, Measure Tool**), nhật ký giao dịch tương tác (**Interactive Trading Journal & Visual PnL Calendar**) và cơ chế xuất báo cáo chi tiết **JSON Forensics**.

---

## 📚 TÀI LIỆU HƯỚNG DẪN HỆ THỐNG (DOCUMENTATION SUITE)

Hệ thống được tài liệu hóa đầy đủ và chi tiết tại các tài liệu sau:

| Tài Liệu | Nội Dung Chính | Liên Kết |
| :--- | :--- | :---: |
| 📘 **Chiến Lược & Quản Lý Vốn** | Bộ quy tắc vào lệnh Long/Short, tiêu chuẩn SMC Order Block, FVG Retest, Liquidity Sweep, mô hình quản trị vốn cố định 1% rủi ro, TP1/TP2/Breakeven. | [STRATEGY_AND_RISK.md](file:///c:/Users/Admin/Desktop/fv/STRATEGY_AND_RISK.md) |
| 📊 **Chỉ Báo Kỹ Thuật & SMC** | Công thức toán học, cơ chế tính toán và tham số của Chande Momentum Oscillator (CMO), EMA 21, ATR 14, BOS, CHoCH, OB, FVG, EQH/EQL, VSR. | [INDICATORS_GUIDE.md](file:///c:/Users/Admin/Desktop/fv/INDICATORS_GUIDE.md) |
| 🖥️ **Kiến Trúc Máy Chủ (Server)** | Cấu trúc máy chủ Express, SQLite database schema, REST API endpoints, WebSocket Hub, Scanner Engine và Multi-Exchange CCXT Pro Adapter. | [SERVER.md](file:///c:/Users/Admin/Desktop/fv/SERVER.md) |
| 🤖 **Hướng Dẫn Dành Cho AI Agent** | Quy tắc bắt buộc, các ràng buộc cấm vi phạm, quy trình build frontend (`node scripts/build.js`), và hướng dẫn duy trì hệ thống. | [AGENT_PROMPT.md](file:///c:/Users/Admin/Desktop/fv/AGENT_PROMPT.md) |
| 🐍 **Bộ Công Cụ Python Hợp Nhất** | Hướng dẫn sử dụng CLI `python_toolkit.py` để tải nến, tính chỉ báo, chạy backtest MT5-grade 1% rủi ro và audit Zero Lookahead. | [PYTHON_TOOLKIT.md](file:///c:/Users/Admin/Desktop/fv/PYTHON_TOOLKIT.md) |

---

## 🌟 CÁC TÍNH NĂNG NỔI BẬT

### 1. 🌐 Đa Sàn (6 Sàn Phái Sinh Top Tier Toàn Cầu)
* **6 Sàn tích hợp qua CCXT Pro:** 🔶 Binance Futures (631), ⬛ Bybit Linear (655), 🔷 OKX Swap (394), 🔵 Bitget (684), 🚪 Gate.io (843), 💠 BingX (738) $\rightarrow$ **Tổng cộng 3,945 cặp USDT Perpetual** (Top 90% thanh khoản).
* Tự động stream WebSocket trực tiếp từ sàn và fallback an toàn qua REST Proxy của Server.

### 2. 📈 Biểu Đồ & Bộ Công Cụ Vẽ Kỹ Thuật (Drawing Tools)
* **Thước đo khoảng giá (Measure Tool):** Đo chính xác %, khoảng giá USD, số nến và thời gian.
* **Hộp chữ nhật (Rectangle Tool):** Vẽ vùng Order Block / FVG với các điểm neo (Resize/Move Anchor Handles).
* **Đường xu hướng (Line Tool):** Kéo vẽ Trendline, hỗ trợ/kháng cự.
* **Auto-Save Debounce 5s:** Tự động lưu hình vẽ vào SQLite với cơ chế debounce 5s mượt mà.

### 3. 📖 Nhật Ký Giao Dịch & Lịch PnL (Trading Journal & Calendar)
* **Visual Calendar:** Lưới lịch trực quan tô màu xanh (ngày lãi) / đỏ (ngày lỗ) kèm số tiền PnL và tỷ lệ Win/Loss.
* **Tương tác lọc ngày:** Click vào ngày bất kỳ trên lịch để lọc danh sách lệnh bên dưới.
* **Xuất báo cáo JSON:** Tải file `.json` chi tiết từng entry/exit, features định lượng, ghi chú cá nhân và forensics để phân tích chuyên sâu.

### 4. 🔴 Trang Giám Sát Livestream & Mobile (Livestream Entry Monitor)
* **URL Trực Tiếp:** 👉 **`http://localhost:8080/livestream`**
* Thiết kế tối ưu cho **Livestream OBS Studio / Browser Capture** và **Thiết bị Di động (Mobile Responsive)**.
* **Theo dõi vị thế mở (Active Positions):** Thẻ thông tin trực quan, PnL phát sáng xanh/đỏ thời gian thực, tiến trình TP/SL.
* **Bộ sắp xếp PnL thông minh (PnL Sorter):** Lọc và sắp xếp theo PnL Lãi nhất ➔ Thấp nhất, Lỗ nhất ➔ Cao nhất, ROE %, Size lệnh, Thời gian.
* **Báo cáo chi tiết Forensics:** Tích hợp đầy đủ cửa sổ phân tích chi tiết lệnh, lý do vào lệnh SMC, tính toán rủi ro và xuất JSON.

### 5. 🧙‍♂️ Trình Hướng Dẫn Cài Đặt Mới (Initial Setup Wizard)
* **Quy trình 4 bước trực quan:**
  1. **Khởi tạo Database & Vốn:** Làm sạch bảng SQLite, cài đặt vốn ban đầu ($500, $1,000, $5,000...).
  2. **Quản trị rủi ro & Vốn:** Cấu hình % Rủi ro/lệnh (0.5% - 2.0%), Đòn bẩy, Ký quỹ Isolated, TP1 (1.5R @ 50%), Auto Breakeven, TP2 (3.0R), Max concurrent positions.
  3. **Lựa chọn 6 Sàn Phái Sinh:** Bật/Tắt riêng lẻ Binance, Bybit, OKX, Bitget, Gate.io, BingX kèm tùy chọn tự động nạp 90% symbol perpetual qua CCXT Pro.
  4. **Xác nhận & Khởi chạy:** Xem lại thông số và áp dụng 1-click trực tiếp.

### 6. ⚡ Quản Trị Vốn & Khớp Lệnh Tự Động 24/7
* **Mô hình 1% Rủi Ro Cố Định (Fixed Fractional 1% Risk Model):** Tự động tính Size lệnh dựa trên khoảng cách SL thực tế.
* **Auto Breakeven:** Dời SL về điểm hòa vốn + phí ngay khi chạm TP1 (1.5R).
* **Chốt lời từng phần:** TP1 chốt 50% khối lượng, TP2 (3.0R) chốt 50% còn lại.

---

## 🚀 KHỞI CHẠY HỆ THỐNG

1. **Truy cập Giao Diện Người Dùng:**
   👉 Mở trình duyệt tại: **`http://localhost:8080`**
2. **Biên dịch Frontend (khi có thay đổi JSX):**
   ```bash
   node scripts/build.js
   ```
3. **Đồng bộ 90% Symbol 6 Sàn (CCXT Pro):**
   ```bash
   node scripts/import_all_exchanges_ccxt.js
   ```
