# 🐍 HƯỚNG DẪN SỬ DỤNG BỘ CÔNG CỤ PYTHON (PYTHON TOOLKIT GUIDE)

File [`python_toolkit.py`](file:///c:/Users/Admin/Desktop/fv/python_toolkit.py) là bộ công cụ hợp nhất toàn diện thay thế toàn bộ 17 script Python riêng lẻ trước đây, cung cấp giao diện dòng lệnh (CLI) mạnh mẽ để tải dữ liệu, tính toán chỉ báo, backtest và audit tính toàn vẹn.

---

## 📑 MỤC LỤC & CÁC LỆNH HỖ TRỢ
1. [Tải Dữ Liệu Nến Trực Tiếp (Download)](#1-tải-dữ-liệu-nến-trực-tiếp-download)
2. [Phân Tích Chỉ Báo Kỹ Thuật & SMC (Analyze)](#2-phân-tích-chỉ-báo-kỹ-thuật--smc-analyze)
3. [Chạy Backtest Khớp Lệnh Mô Phỏng MT5 (Backtest)](#3-chạy-backtest-khớp-lệnh-mô-phỏng-mt5-backtest)
4. [Kiểm Tra Tính Toàn Vẹn Zero Lookahead (Audit)](#4-kiểm-tra-tính-toàn-vẹn-zero-lookahead-audit)

---

## 1. TẢI DỮ LIỆU NẾN TRỰC TIẾP (DOWNLOAD)

Tải nến Klines từ Binance, Bybit, OKX:
```bash
python python_toolkit.py download --symbol BTCUSDT --timeframe 15m --exchange BINANCE --limit 500
```
* `--symbol`: Cặp giao dịch (ví dụ: `BTCUSDT`, `ETHUSDT`, `SOLUSDT`).
* `--timeframe`: Khung thời gian (`1m`, `5m`, `15m`, `1h`, `4h`, `1d`).
* `--exchange`: Sàn giao dịch (`BINANCE`, `BYBIT`, `OKX`).
* `--limit`: Số lượng nến (mặc định: `500`).

---

## 2. PHÂN TÍCH CHỈ BÁO KỸ THUẬT & SMC (ANALYZE)

Tính toán tức thì giá trị CMO 14, EMA 21, ATR 14, Swing High/Low, Fair Value Gaps (FVG) và Liquidity Sweeps:
```bash
python python_toolkit.py analyze --symbol ETHUSDT --timeframe 15m --exchange BINANCE
```

---

## 3. CHẠY BACKTEST KHỚP LỆNH MÔ PHỎNG MT5 (BACKTEST)

Chạy kiểm thử chiến lược với **Mô hình quản lý rủi ro cố định 1% vốn (Fixed 1% Risk)**, tự động chốt lời TP1 (1.5R - đóng 50%), Auto Breakeven (dời SL về điểm hòa vốn) và TP2 (3.0R - đóng 50% còn lại):
```bash
python python_toolkit.py backtest --symbol BTCUSDT --timeframe 15m --risk 1.0 --balance 1000
```
* `--risk`: % Rủi ro trên mỗi lệnh (Mặc định: `1.0%`).
* `--balance`: Số dư tài khoản khởi tạo (Mặc định: `$1,000`).

---

## 4. KIỂM TRA TÍNH TOÀN VẸN ZERO LOOKAHEAD (AUDIT)

Kiểm tra thuật toán đảm bảo không có bất kỳ lỗi "nhìn trước tương lai" (Zero Lookahead Bias) nào trong quá trình phát hiện đỉnh/đáy, FVG và Order Blocks:
```bash
python python_toolkit.py audit
```
