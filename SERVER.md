# 🖥️ KIẾN TRÚC SERVER & MULTI-EXCHANGE ENGINE (SERVER ARCHITECTURE GUIDE)

Tài liệu này mô tả chi tiết toàn bộ kiến trúc máy chủ **Node.js Express + SQLite3 + CCXT Pro Multi-Exchange Engine + Realtime WebSocket Hub** của hệ thống **STAT2 Futures Pro**.

---

## 📑 MỤC LỤC
1. [Tổng Quan Kiến Trúc Hệ Thống](#1-tổng-quan-kiến-trúc-hệ-thống)
2. [Cấu Trúc Thư Mục Dự Án](#2-cấu-trúc-thư-mục-dự-án)
3. [Multi-Exchange Engine & CCXT Pro Integration](#3-multi-exchange-engine--ccxt-pro-integration)
4. [Cơ Sở Dữ Liệu SQLite & Schema Chi Tiết](#4-cơ-sở-dữ-liệu-sqlite--schema-chi-tiết)
5. [Tài Liệu REST API Endpoints](#5-tài-liệu-rest-api-endpoints)
6. [Realtime WebSocket Hub & Giao Thức Sự Kiện](#6-realtime-websocket-hub--giao-thức-sự-kiện)
7. [Scanner Engine, Strategy Engine & Trade Executor](#7-scanner-engine-strategy-engine--trade-executor)

---

## 1. TỔNG QUAN KIẾN TRÚC HỆ THỐNG

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                REACT FRONTEND (Tailwind CSS)                                │
│        Lightweight Charts • 60 FPS Drawing Canvas • Trading Journal • Multi-Exchange Desk   │
└───────────────────────────────▲─────────────────────────────▲───────────────────────────────┘
                                │ REST APIs (HTTP)            │ Realtime WebSockets (WSS)
                                ▼                             ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   EXPRESS SERVER (PORT 80 / .env)                            │
│                     server.js / server/app.js / server/notification.js                      │
├───────────────────────────────┬─────────────────────────────┬───────────────────────────────┤
│    SCANNER & RATE PACING      │       STRATEGY ENGINE       │        TRADE EXECUTOR         │
│  24/7 Multi-Exchange Worker   │  Pure JS SMC (smc.js) + ATR │ Fixed 1% Risk • Auto Breakeven│
├───────────────────────────────┴─────────────────────────────┴───────────────────────────────┤
│                        UNIFIED EXCHANGE MANAGER (CCXT & CCXT PRO)                           │
│   🔶 Binance Futures │ ⬛ Bybit Linear │ 🔷 OKX Swap │ 🔵 Bitget │ 🚪 Gate.io │ 💠 BingX   │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│                          PERSISTENCE LAYER (data/trading_system.db)                         │
│         SQLite3 (WAL Mode) • Whitelist Symbols • Strategies • Positions • Audit Logs        │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. CẤU TRÚC THƯ MỤC DỰ ÁN

```
c:\Users\Admin\Desktop\fv\
├── data/
│   └── trading_system.db         # SQLite database chính (WAL Mode)
├── public/
│   ├── app.jsx                   # Toàn bộ mã nguồn React Frontend Component
│   ├── app.js                    # File Bundle sau khi build qua Babel (scripts/build.js)
│   └── index.html                # Trang web chính Single Page Application
├── scripts/
│   ├── build.js                  # Script biên dịch Babel JSX -> JS cực nhanh
│   ├── import_all_exchanges_ccxt.js # Pipeline tự động nạp 90% symbol 6 sàn qua CCXT Pro
│   └── verify_multi_exchanges.js # Script kiểm tra tính toàn vẹn đa sàn
├── server/
│   ├── app.js                    # Express App, Router, Middleware, Controllers
│   ├── db.js                     # Quản lý SQLite connection & Data Access Objects
│   ├── logger.js                 # Unified Logger định dạng màu
│   ├── notification.js           # WebSocket Broadcast Manager
│   ├── scanner.js                # Background Scanner tự động quét tín hiệu 3,945 symbol
│   ├── strategyEngine.js         # Động cơ phân tích SMC, CMO, ATR, FVG, Liq
│   ├── tradeExecutor.js          # Động cơ quản lý vốn, khớp lệnh ảo, Trailing TP/SL
│   └── exchanges/
│       ├── baseExchange.js       # Base Exchange Adapter Interface
│       ├── binanceExchange.js    # Binance Futures USDT-M Adapter
│       ├── bybitExchange.js      # Bybit Linear V5 Adapter
│       ├── okxExchange.js        # OKX Perpetual Swap Adapter
│       ├── bitgetExchange.js     # Bitget USDT-M Perpetual Adapter
│       ├── gateExchange.js       # Gate.io USDT Perpetual Adapter
│       ├── bingxExchange.js      # BingX Perpetual Swap Adapter
│       └── index.js              # Exchange Factory & Registry
├── smc.js                        # Thư viện Smart Money Concepts thuần JavaScript
├── server.js                     # Entry point khởi chạy HTTP & WebSocket Server
├── STRATEGY_AND_RISK.md          # Tài liệu Chiến lược & Quản lý vốn
├── INDICATORS_GUIDE.md           # Tài liệu Chỉ báo kỹ thuật
├── SERVER.md                     # Tài liệu Kiến trúc Server (File này)
└── AGENT_PROMPT.md               # Prompt hướng dẫn AI Agent tiếp nối
```

---

## 3. MULTI-EXCHANGE ENGINE & CCXT PRO INTEGRATION

Hệ thống hỗ trợ chuẩn hóa **6 sàn giao dịch phái sinh lớn nhất thế giới** qua module `server/exchanges/index.js`:

1. **Binance Futures (USDT-M):** 631 symbols (90% của 705 hợp đồng).
2. **Bybit Linear Perpetual (V5):** 655 symbols (90% của 768 hợp đồng).
3. **OKX Perpetual Swap:** 394 symbols (90% của 438 hợp đồng).
4. **Bitget USDT-M Perpetual:** 684 symbols (90% của 759 hợp đồng).
5. **Gate.io Perpetual:** 843 symbols (90% của 967 hợp đồng).
6. **BingX Perpetual:** 738 symbols (90% của 820 hợp đồng).

### 🚀 Quy tắc Pacing & Rate Limit:
* Sử dụng `fetchWithRateLimit` với bộ nhớ đệm Bucket Token.
* Đảm bảo không bao giờ bị vượt ngưỡng Request-Per-Minute của từng sàn.

---

## 4. CƠ SỞ DỮ LIỆU SQLITE & SCHEMA CHI TIẾT

Cơ sở dữ liệu lưu tại `data/trading_system.db`, kích hoạt `PRAGMA journal_mode = WAL;` và `PRAGMA synchronous = NORMAL;`:

1. `system_settings (key, value, updated_at)`: Lưu cấu hình hệ thống, scanner mode, max concurrent trades.
2. `whitelist_symbols (id, symbol, exchange, is_enabled, category, tags, created_at, updated_at)`: Quản lý 3,945 symbol được cấp phép quét.
3. `symbol_strategies (id, symbol, exchange, strategy_name, strategy_type, timeframe, is_enabled, risk_pct, leverage, margin_mode, ...)`: Cấu hình tham số chiến lược riêng biệt cho từng symbol/timeframe.
4. `trade_positions (id, symbol, exchange, direction, leverage, margin_mode, status, entry_price, current_price, exit_price, tp1_price, tp2_price, sl_price, pos_size_usd, initial_margin, net_pnl_usd, roe_pct, fee_usd, open_time, close_time, exit_reason, entry_rationale, features, ...)`: Lưu trữ toàn bộ vị thế đang mở và lịch sử lệnh đã đóng.
5. `order_notes (position_id, notes, updated_at)`: Ghi chú cá nhân của người dùng cho từng lệnh.
6. `drawings (id, symbol, exchange, timeframe, type, points_json, style_json, created_at, updated_at)`: Lưu trữ các công cụ vẽ kỹ thuật (Line, Rectangle, Measure) với cơ chế Debounce 5s.

---

## 5. TÀI LIỆU REST API ENDPOINTS

### 📡 Public & Market Feeds:
* `GET /api/status`: Lấy trạng thái hệ thống, bot uptime, số dư ví, tổng quan PnL.
* `GET /api/exchanges`: Trả về danh sách 6 sàn kèm số lượng symbol active và thông số phí.
* `GET /api/whitelist`: Lấy danh sách symbol whitelist (lọc theo sàn `?exchange=BINANCE`).
* `GET /api/signals`: Lấy danh sách tín hiệu gần nhất (hỗ trợ `?limit=150`).
* `GET /api/positions`: Lấy các vị thế đang mở và thống kê hiệu suất.
* `GET /api/journal`: Lấy toàn bộ dữ liệu nhật ký giao dịch, thống kê Win/Loss, lịch sử kèm ghi chú.
* `GET /api/chart/:symbol/:timeframe?exchange=:ex`: Lấy nến Klines kèm tính toán các vùng SMC (Cards, FVG, Liq, ATR).
* `GET /api/drawings?symbol=:sym&exchange=:ex&timeframe=:tf`: Lấy danh sách hình vẽ trên biểu đồ.

### ⚙️ Thao Tác Lệnh & Admin:
* `POST /api/positions/close/:id`: Đóng khẩn cấp vị thế đang mở theo giá thị trường.
* `POST /api/positions/notes/:id`: Cập nhật ghi chú cá nhân cho lệnh.
* `POST /api/drawings`: Lưu/cập nhật công cụ vẽ (Line, Box, Measure).
* `DELETE /api/drawings/:id`: Xóa công cụ vẽ.
* `POST /api/admin/import-all-exchanges`: Kích hoạt nạp 90% symbol của cả 6 sàn qua CCXT Pro.
* `POST /api/admin/import-:exchange`: Nạp 90% symbol riêng cho 1 sàn.
* `POST /api/admin/reset-trades`: Reset danh sách lệnh về số dư ban đầu $1,000.

---

## 6. REALTIME WEBSOCKET HUB & GIAO THỨC SỰ KIỆN

Máy chủ WebSocket tích hợp sẵn trên cổng 8080 (cùng cổng HTTP), hỗ trợ tự động gửi các sự kiện:

* `POSITIONS_UPDATE`: Broadcast khi có thay đổi trong danh sách vị thế hoặc số dư ví.
* `SIGNALS_UPDATE` / `NEW_SIGNAL`: Broadcast tức thì khi Scanner phát hiện tín hiệu mới.
* `LOG`: Gửi log thời gian thực về bảng điều khiển người dùng.

---

## 7. SCANNER ENGINE, STRATEGY ENGINE & TRADE EXECUTOR

1. **Scanner Engine (`scanner.js`):**
   * Quét liên tục danh sách 3,945 symbol theo mô hình Bucket Micro-batching.
   * Tính toán nến đóng cửa mới nhất để phát hiện tín hiệu không có độ trễ.
2. **Strategy Engine (`strategyEngine.js`):**
   * Gọi thư viện `smc.js` để tìm Swing High/Low, BOS, CHoCH, Order Blocks, FVG, Liquidity Sweeps.
   * Kết hợp bộ lọc CMO và ATR.
3. **Trade Executor (`tradeExecutor.js`):**
   * Áp dụng công thức quản lý rủi ro cố định 1% vốn.
   * Quản lý tự động các mốc TP1 (chốt 50%), Auto Breakeven (dời SL về điểm hòa vốn + phí), và TP2 (chốt toàn bộ).
