# 🤖 HƯỚNG DẪN DÀNH CHO AI AGENT TIẾP NỐI (AGENT PROMPT & SYSTEM CONTINUATION GUIDE)

> [!CAUTION]
> **QUY TẮC BẮT BUỘC & KHÔNG ĐƯỢC PHÉP VI PHẠM (CRITICAL SYSTEM CONSTRAINTS):**
> 1. **KHÔNG ĐƯỢC DỪNG / KILL CÁC NODEJS PROCESS ĐANG CHẠY TRÊN MÁY NÀY.**
> 2. **KHÔNG ĐƯỢC TỰ Ý CHẠY `git push`.**
> 3. **KHÔNG ĐƯỢC CHẠY LỆNH `npm run start` (Server đang chạy nền liên tục; cấu hình cổng nằm tại file `.env`, mặc định port 8080).**

---

## 🎯 1. TỔNG QUAN HỆ THỐNG & CODEBASE

Dự án **STAT2 Futures Pro** là một Terminal giao dịch định lượng chuyên nghiệp kết hợp:
* **Frontend:** React 18 (Pure JSX trong `public/app.jsx` $\rightarrow$ build ra `public/app.js` bằng `node scripts/build.js`).
* **Backend:** Node.js Express (`server/app.js`), SQLite3 (`server/db.js`), WebSocket realtime (`server/notification.js`).
* **Đa Sàn (CCXT Pro):** Hỗ trợ 6 sàn lớn nhất thế giới (**Binance, Bybit, OKX, Bitget, Gate.io, BingX**) với 3,945 cặp phái sinh USDT (chiếm 90% số lượng hợp đồng perpetual có thanh khoản cao nhất).
* **Thuật toán cốt lõi:** Smart Money Concepts thuần JS (`smc.js`), Chande Momentum Oscillator (CMO), Average True Range (ATR).
* **Quản lý vốn:** Fixed Fractional 1% Risk Model, Auto Breakeven sau TP1, Trailing SL.

---

## ⚙️ 2. QUY TRÌNH BUILD & TRIỂN KHAI FRONTEND

Khi sửa đổi giao diện hoặc logic người dùng trong `public/app.jsx`:
1. Chỉnh sửa mã nguồn trong [`public/app.jsx`](file:///c:/Users/Admin/Desktop/fv/public/app.jsx).
2. Chạy lệnh biên dịch Babel:
   ```bash
   node scripts/build.js
   ```
3. Kiểm tra tính hợp lệ cú pháp của `public/app.js`:
   ```bash
   node -e "const fs = require('fs'); new Function(fs.readFileSync('public/app.js', 'utf8')); console.log('OK');"
   ```
4. Người dùng chỉ cần ấn **F5** trên trình duyệt để thấy thay đổi tại `http://localhost:8080`.

---

## 📂 3. CÁC TÀI LIỆU QUAN TRỌNG ĐÃ CÓ

Trước khi thực hiện các thay đổi lớn, AI Agent hãy đọc các tài liệu sau:
* [`STRATEGY_AND_RISK.md`](file:///c:/Users/Admin/Desktop/fv/STRATEGY_AND_RISK.md): Quy tắc vào lệnh Long/Short, tiêu chuẩn FVG/OrderBlock/Liquidity Sweep, công thức tính size lệnh 1% rủi ro, TP1/TP2/Breakeven.
* [`INDICATORS_GUIDE.md`](file:///c:/Users/Admin/Desktop/fv/INDICATORS_GUIDE.md): Công thức toán học và giải thích chi tiết các chỉ báo CMO, EMA, ATR, BOS, CHoCH, OB, FVG, EQH/EQL, VSR.
* [`SERVER.md`](file:///c:/Users/Admin/Desktop/fv/SERVER.md): Toàn bộ cấu trúc server, cơ sở dữ liệu SQLite, danh sách REST API, WebSocket protocol và Scanner background.
* [`PYTHON_TOOLKIT.md`](file:///c:/Users/Admin/Desktop/fv/PYTHON_TOOLKIT.md): Hướng dẫn sử dụng bộ công cụ Python hợp nhất `python_toolkit.py` để backtest, tải nến, phân tích mẫu hình.

---

## 🛡️ 4. NGUYÊN TẮC LẬP TRÌNH & THIẾT KẾ UI

1. **Giao diện người dùng (UI/UX):**
   * Giữ phong cách Dark Mode chuyên nghiệp chuẩn TradingView / Binance Pro (Bảng màu: Nền `#0B0E17`, Vàng `#F3BA2F`, Xanh lá `#0ECB81`, Đỏ `#F6465D`, Cyan `#00E5FF`).
   * Sử dụng font chữ Monospace cho tất cả các con số giá, PnL, ROE, kích thước lệnh để đảm bảo căn lề hoàn hảo.
2. **Cơ sở dữ liệu SQLite:**
   * Luôn sử dụng Parameterized Query (`?`) trong các câu lệnh SQL để chống SQL Injection.
   * Tất cả thao tác thêm vào bảng `whitelist_symbols` phải dùng `ON CONFLICT(symbol, exchange) DO UPDATE`.
3. **Hiệu năng & Debounce:**
   * Các công cụ vẽ trên Canvas (Drawing Tools) phải luôn có cơ chế Debounce 5s trước khi ghi vào Database để tránh làm quá tải máy chủ khi người dùng kéo/thay đổi kích thước.
