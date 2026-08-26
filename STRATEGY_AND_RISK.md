# 📘 HƯỚNG DẪN CHI TIẾT CHIẾN LƯỢC GIAO DỊCH & QUẢN LÝ VỐN (STRATEGY & RISK MANAGEMENT GUIDE)

Hệ thống giao dịch **STAT2 Futures Pro** sử dụng kiến trúc **Dual-Engine Smart Money Concepts (SMC)** kết hợp chỉ báo động lượng **Chande Momentum Oscillator (CMO)**, biến động **Average True Range (ATR)** và bộ lọc thanh khoản **Liquidity Sweeps & Fair Value Gaps (FVG)**.

---

## 📑 MỤC LỤC
1. [Kiến Trúc Dual-Engine: Trend vs Liquidity Fade](#1-kiến-trúc-dual-engine-trend-vs-liquidity-fade)
2. [Bộ Quy Tắc Vào Lệnh (Entry Rules)](#2-bộ-quy-tắc-vào-lệnh-entry-rules)
3. [Điểm Dừng Lỗ & Chốt Lời (SL / TP1 / TP2 & Trailing)](#3-điểm-dừng-lỗ--chốt-lời-sl--tp1--tp2--trailing)
4. [Nguyên Tắc Quản Lý Vốn & Kích Thước Vị Thế (Money Management)](#4-nguyên-tắc-quản-lý-vốn--kích-thước-vị-thế-money-management)
5. [Cơ Chế Bảo Vệ Tài Khoản & Circuit Breaker](#5-cơ-chế-bảo-vệ-tài-khoản--circuit-breaker)

---

## 1. KIẾN TRÚC DUAL-ENGINE: TREND VS LIQUIDITY FADE

Hệ thống hoạt động với 2 chế độ chiến lược bổ trợ lẫn nhau nhằm tối ưu hóa tỷ lệ thắng trong cả thị trường có xu hướng mạnh (Trending) và thị trường tích lũy/quét thanh khoản (Ranging/Trap):

```
                     ┌──────────────────────────────────────┐
                     │     MARKET REGIME DISCRIMINATOR      │
                     └──────────────────┬───────────────────┘
                                        │
             ┌──────────────────────────┴──────────────────────────┐
             ▼                                                     ▼
┌──────────────────────────────┐              ┌──────────────────────────────┐
│   STRATEGY 1: TREND SYSTEM   │              │   STRATEGY 2: FADE SYSTEM    │
│  (Thuận Xu Hướng Tiếp Diễn)  │              │  (Đảo Chiều Bẫy Thanh Khoản) │
├──────────────────────────────┤              ├──────────────────────────────┤
│ • Entry tại FVG Retest       │              │ • Entry sau Liquidity Sweep  │
│ • EMA 21 Slope dốc rõ ràng   │              │ • CMO cực đại (> 45 / < -45) │
│ • CMO nằm trong vùng động    │              │ • Chạm Order Block đối kháng │
│   lượng (+15 đến +40)        │              │ • Quét râu nến (Fakeout)     │
└──────────────────────────────┘              └──────────────────────────────┘
```

---

## 2. BỘ QUY TẮC VÀO LỆNH (ENTRY RULES)

### 🟢 A. QUY TẮC MUA (LONG ENTRY)

#### 1. Chế độ Trend Continuation (Thuận Xu Hướng):
* **Điều kiện 1 (Cấu trúc & Xu hướng):** Giá nằm trên đường EMA 21 và xuất hiện đỉnh/đáy sau cao hơn (BOS - Break of Structure tăng).
* **Điều kiện 2 (Fair Value Gap - FVG):** Xuất hiện vùng Bullish FVG (khoảng trống giá giữa High của nến 1 và Low của nến 3). Giá hồi quy (retest) chạm vào vùng 50% FVG.
* **Điều kiện 3 (Động lượng CMO):** $15 \le \text{CMO} \le 45$ (Động lượng tăng ổn định, không bị quá mua cực độ).
* **Điều kiện 4 (Biến động ATR):** $\text{ATR} \ge \text{Min ATR Pct} \times \text{Price}$ (Tránh vào lệnh khi thị trường đi ngang không có thanh khoản).

#### 2. Chế độ Liquidity Fade (Bẫy Thanh Khoản Đảo Chiều):
* **Điều kiện 1 (Liquidity Sweep):** Giá quét thủng đáy cũ (Equal Lows / Swing Low) nhưng rút râu nến đóng cửa ngược trở lại bên trên vùng hỗ trợ.
* **Điều kiện 2 (Quá bán CMO):** $\text{CMO} \le -45$ (Áp lực bán bị kiệt sức - Exhaustion).
* **Điều kiện 3 (Bullish Order Block):** Nến phản ứng mạnh tạo cụm nến từ chối giảm giá ngay tại vùng Demand.

---

### 🔴 B. QUY TẮC BÁN (SHORT ENTRY)

#### 1. Chế độ Trend Continuation (Thuận Xu Hướng):
* **Điều kiện 1 (Cấu trúc & Xu hướng):** Giá nằm dưới đường EMA 21 và xuất hiện đỉnh/đáy sau thấp hơn (BOS giảm).
* **Điều kiện 2 (Fair Value Gap - FVG):** Xuất hiện vùng Bearish FVG. Giá hồi quy retest chạm vào vùng FVG.
* **Điều kiện 3 (Động lượng CMO):** $-45 \le \text{CMO} \le -15$ (Động lượng giảm vững chắc).
* **Điều kiện 4 (Biến động ATR):** $\text{ATR} \ge \text{Min ATR Pct} \times \text{Price}$.

#### 2. Chế độ Liquidity Fade (Bẫy Thanh Khoản Đảo Chiều):
* **Điều kiện 1 (Liquidity Sweep):** Giá đâm thủng đỉnh cũ (Equal Highs / Swing High) nhằm kích hoạt Stop Loss của phe Short, sau đó rút râu đóng nến bên dưới kháng cự.
* **Điều kiện 2 (Quá mua CMO):** $\text{CMO} \ge +45$ (Áp lực mua suy kiệt).
* **Điều kiện 3 (Bearish Order Block):** Nến từ chối giá quyết liệt tại vùng Supply.

---

## 3. ĐIỂM DỪNG LỖ & CHỐT LỜI (SL / TP1 / TP2 & TRAILING)

```
       Mục Tiêu TP2 (Major Swing / Liq Pool) ───────► [+3.0R] (Đóng 100% vị thế còn lại)
                               ▲
                               │
       Mục Tiêu TP1 (50% FVG / Local High) ────────► [+1.5R] (Chốt 50% + Dời SL về Breakeven)
                               ▲
                               │
       Mức Giá Vào Lệnh (ENTRY) ────────────────────► [ 0.0R]
                               │
                               ▼
       Dừng Lỗ Cơ Sở (SL = Swing ± 2*ATR) ──────────► [-1.0R] (Tối đa 1% rủi ro tài khoản)
```

1. **Stop Loss (SL Cơ Sở):**
   * Đối với lệnh **LONG**: Đặt dưới đáy nến Sweep hoặc dưới đáy Order Block gần nhất một khoảng đệm an toàn:
     $$\text{SL}_{\text{Long}} = \text{SwingLow} - (0.5 \times \text{ATR})$$
   * Đối với lệnh **SHORT**: Đặt trên đỉnh nến Sweep hoặc trên đỉnh Order Block:
     $$\text{SL}_{\text{Short}} = \text{SwingHigh} + (0.5 \times \text{ATR})$$

2. **Take Profit 1 (TP1 - Bảo Toàn Lợi Nhuận):**
   * Đạt mức tối thiểu $1.5R$ hoặc chạm biên đối diện của FVG.
   * **Hành động:** Đóng tự động **50% khối lượng** vị thế.

3. **Auto Breakeven (Dời SL Về Hòa Vốn):**
   * Ngay khi **TP1 được khớp**, hệ thống tự động dời Stop Loss của 50% khối lượng còn lại về mức **Entry + 0.05%** (bù toàn bộ phí Taker/Maker). Đảm bảo lệnh hoàn toàn **Không Thể Thua (Risk-Free)**.

4. **Take Profit 2 (TP2 - Chốt Lãi Toàn Phần):**
   * Mục tiêu $2.5R - 3.5R$ hoặc vùng thanh khoản đối ứng (External Liquidity Pool).
   * **Hành động:** Đóng toàn bộ $50\%$ khối lượng còn lại.

---

## 4. NGUYÊN TẮC QUẢN LÝ VỐN & KÍCH THƯỚC VỊ THẾ (MONEY MANAGEMENT)

> [!IMPORTANT]
> Tuyệt đối không bao giờ đi lệnh với kích thước cố định (Fixed Lot) hoặc all-in số dư. Tất cả lệnh đều được tính toán theo **Mô Hình Quản Lý Rủi Ro Cố Định 1% (Fixed Fractional Risk Model)**.

### 📐 Công Thức Tính Size Lệnh Chính Xác:

$$\text{Rủi Ro Cho Phép (USD)} = \text{Tổng Vốn (Wallet Balance)} \times \text{Risk \%} \quad (\text{Mặc định } 1.0\%)$$

$$\text{Khoảng Cách Cắt Lỗ (\%)} = \frac{|\text{Entry Price} - \text{SL Price}|}{\text{Entry Price}}$$

$$\text{Quy Mô Vị Thế (Position Size USD)} = \frac{\text{Rủi Ro Cho Phép (USD)}}{\text{Khoảng Cách Cắt Lỗ (\%)}}$$

$$\text{Ký Quỹ Cần Thiết (Initial Margin)} = \frac{\text{Position Size USD}}{\text{Đòn Bẩy (Leverage)}}$$

#### 💡 Ví Dụ Thực Tế:
* **Vốn tài khoản:** $\$1,000$
* **Rủi ro chấp nhận:** $1\% = \$10.00$
* **Cặp giao dịch:** `BTCUSDT`
* **Entry:** $\$60,000$ | **SL:** $\$59,100$ (Khoảng cách SL = $1.5\%$)
* **Đòn bẩy:** $20\text{x}$ (Isolated)
* $\rightarrow \text{Quy mô vị thế (Pos Size)} = \frac{\$10}{0.015} = \$666.66$
* $\rightarrow \text{Ký quỹ Margin thực tế bỏ ra} = \frac{\$666.66}{20} = \$33.33$
* **Kết quả:** Nếu giá chạm SL $\rightarrow$ Tài khoản chỉ mất đúng $\$10$ ($1\%$). Nếu giá chạm TP2 ($3R$) $\rightarrow$ Tài khoản lãi $+\$30$ ($+3\%$).

---

## 5. CƠ CHẾ BẢO VỆ TÀI KHOẢN & CIRCUIT BREAKER

1. **Giới Hạn Lệnh Đồng Thời (Max Concurrent Positions):**
   * Tối đa **5 vị thế mở cùng lúc** trên toàn bộ hệ thống (tương đương tổng rủi ro tối đa $5\%$).
2. **Phân Bổ Sàn (Exchange Diversification):**
   * Không mở quá 2 vị thế trên cùng một tài sản cơ sở (ví dụ: không Long đồng thời BTC trên cả Binance, Bybit và OKX).
3. **Daily Drawdown Circuit Breaker:**
   * Nếu tổng lỗ thực nhận trong ngày vượt quá **$4\%$ tổng tài sản**, Bot tự động tạm dừng kích hoạt lệnh mới trong vòng 12 giờ để bảo vệ vốn.
4. **Cơ Chế Khớp Lệnh:**
   * Chế độ Margin: **ISOLATED** (Cách ly rủi ro từng lệnh, không làm ảnh hưởng đến số dư còn lại trong ví).
