# 📊 HƯỚNG DẪN TOÀN TẬP CHỈ BÁO KỸ THUẬT & THUẬT TOÁN (INDICATORS & SMC ENGINE GUIDE)

Tài liệu này cung cấp công thức toán học, cơ chế tính toán, tham số tối ưu và ý nghĩa phân tích của toàn bộ bộ chỉ báo được tích hợp trong **STAT2 Futures Pro**.

---

## 📑 MỤC LỤC
1. [Chande Momentum Oscillator (CMO)](#1-chande-momentum-oscillator-cmo)
2. [Exponential Moving Average (EMA 21) & Dynamic Trend Baseline](#2-exponential-moving-average-ema-21--dynamic-trend-baseline)
3. [Average True Range (ATR) & Bộ Lọc Biến Động](#3-average-true-range-atr--bộ-lọc-biến-động)
4. [Bộ Chỉ Báo Smart Money Concepts (SMC Engine)](#4-bộ-chỉ-báo-smart-money-concepts-smc-engine)
   - [Swing Highs / Swing Lows](#a-swing-highs--swing-lows)
   - [Break of Structure (BOS) & Change of Character (CHoCH)](#b-break-of-structure-bos--change-of-character-choch)
   - [Order Blocks (OB - Bullish & Bearish)](#c-order-blocks-ob---bullish--bearish)
   - [Fair Value Gaps (FVG - Vùng Mất Cân Bằng)](#d-fair-value-gaps-fvg---vùng-mất-cân-bằng)
   - [Liquidity Sweeps & Equal Highs/Lows (EQH/EQL)](#e-liquidity-sweeps--equal-highslows-eqheql)
5. [Volume Spread & Absorption Ratio (VSR)](#5-volume-spread--absorption-ratio-vsr)

---

## 1. CHANDE MOMENTUM OSCILLATOR (CMO)

### 📌 Khái niệm & Khác biệt với RSI:
Khác với RSI (luôn chuẩn hóa từ 0 đến 100), **Chande Momentum Oscillator (CMO)** đo lường trực tiếp động lượng trên thang đo đối xứng từ **-100 đến +100**, tính toán trực tiếp cả ngày tăng và ngày giảm trong tử số, giúp phản ứng nhanh hơn và không bị trễ pha.

### 📐 Công thức Toán học:
Với chu kỳ $N = 14$:
* $S_u = \sum (\text{Giá đóng cửa hôm nay} - \text{Giá đóng cửa hôm qua})$ cho tất cả các nến tăng giá.
* $S_d = \sum |\text{Giá đóng cửa hôm nay} - \text{Giá đóng cửa hôm qua}|$ cho tất cả các nến giảm giá.

$$\text{CMO} = 100 \times \left( \frac{S_u - S_d}{S_u + S_d} \right)$$

### 🎯 Ý nghĩa & Ngưỡng Kích Hoạt trong STAT2:
* $\text{CMO} > +45$: Vùng **Quá Mua Cực Độ (Exhaustion)** $\rightarrow$ Ưu tiên kích hoạt **Short Fade Trap**.
* $+15 \le \text{CMO} \le +40$: Vùng **Động Lượng Tăng Bền Vững** $\rightarrow$ Kích hoạt **Long Trend Continuation**.
* $-15 \le \text{CMO} \le +15$: Vùng **Đi Ngang (Sideway/No-Trade)** $\rightarrow$ Bot tự động bỏ qua tín hiệu.
* $-40 \le \text{CMO} \le -15$: Vùng **Động Lượng Giảm Bền Vững** $\rightarrow$ Kích hoạt **Short Trend Continuation**.
* $\text{CMO} < -45$: Vùng **Quá Bán Cực Độ (Exhaustion)** $\rightarrow$ Ưu tiên kích hoạt **Long Fade Trap**.

---

## 2. EXPONENTIAL MOVING AVERAGE (EMA 21) & DYNAMIC TREND BASELINE

### 📐 Công thức Toán học:
$$\text{Multiplier } (k) = \frac{2}{N + 1} = \frac{2}{21 + 1} \approx 0.0909$$
$$\text{EMA}_t = (\text{Close}_t \times k) + (\text{EMA}_{t-1} \times (1 - k))$$

### 🎯 Ứng dụng:
1. **Xác định Trend Bias:**
   * $\text{Close} > \text{EMA}_{21}$ và độ dốc (Slope) hướng lên: Chỉ xét lệnh **LONG**.
   * $\text{Close} < \text{EMA}_{21}$ và độ dốc hướng xuống: Chỉ xét lệnh **SHORT**.
2. **Dynamic Support/Resistance:** Vùng đệm hồi quy lý tưởng cho các lệnh Trend Continuation.

---

## 3. AVERAGE TRUE RANGE (ATR) & BỘ LỌC BIẾN ĐỘNG

### 📐 Công thức Toán học (Chu kỳ $N=14$):
$$\text{True Range (TR)} = \max \Big( (\text{High}_t - \text{Low}_t), |\text{High}_t - \text{Close}_{t-1}|, |\text{Low}_t - \text{Close}_{t-1}| \Big)$$
$$\text{ATR}_t = \frac{(\text{ATR}_{t-1} \times 13) + \text{TR}_t}{14}$$

### 🎯 Các Tham Số Chiến Lược:
* **`min_atr_pct = 0.35%` (Bộ Lọc Thanh Khoản Tối Thiểu):**
  $$\text{ATR Pct} = \frac{\text{ATR}}{\text{Close}} \times 100\%$$
  Nếu $\text{ATR Pct} < 0.35\%$, hệ thống xác định coin đang chết thanh khoản hoặc biến động quá nhỏ $\rightarrow$ Từ chối mở lệnh để tránh phí spread.
* **`atr_mult = 2.0` (Khoảng Đệm Cắt Lỗ An Toàn):**
  Sử dụng để tính khoảng cách Stop Loss co giãn tự nhiên theo độ rung lắc của thị trường.

---

## 4. BỘ CHỈ BÁO SMART MONEY CONCEPTS (SMC ENGINE)

Hệ thống thuần Pure JavaScript (`smc.js`) mô phỏng 100% logic thuật toán của các tổ chức tài chính lớn (ICT/SMC):

### A. Swing Highs & Swing Lows
* **Lookback = 30 nến:** Tìm kiếm các đỉnh cao nhất và đáy thấp nhất có tính chất cấu trúc trong 30 nến gần nhất.
* Loại bỏ hoàn toàn lỗi nhìn trước tương lai (Zero Lookahead Bias) bằng cách chỉ xác nhận đỉnh/đáy khi đã có đủ số nến đóng cửa bên phải.

### B. Break of Structure (BOS) & Change of Character (CHoCH)
* **BOS (Tiếp diễn cấu trúc):** Giá phá vỡ đỉnh swing trước đó trong xu hướng tăng hoặc phá vỡ đáy swing trong xu hướng giảm với nến thân đặc.
* **CHoCH (Đảo chiều cấu trúc):** Xuất hiện khi giá phá vỡ đáy dẫn tới đỉnh cao nhất (trong uptrend) hoặc phá đỉnh dẫn tới đáy thấp nhất (trong downtrend).

### C. Order Blocks (OB - Bullish & Bearish)
* **Bullish OB:** Cụm nến giảm cuối cùng trước khi có một sóng tăng bốc đầu tạo ra Imbalance/FVG phá vỡ cấu trúc.
* **Bearish OB:** Cụm nến tăng cuối cùng trước khi có một sóng giảm dữ dội phá vỡ đáy.
* **Trạng thái Unmitigated:** Vùng Order Block chỉ có hiệu lực khi giá chưa quay trở lại retest. Khi giá đã chạm vào và phản ứng, Order Block chuyển sang trạng thái *Mitigated* và không được dùng lại.

### D. Fair Value Gaps (FVG - Vùng Mất Cân Bằng)
* **Bullish FVG:** Khoảng trống giữa $\text{High}(\text{Nến } 1)$ và $\text{Low}(\text{Nến } 3)$ khi $\text{Low}_3 > \text{High}_1$.
* **Bearish FVG:** Khoảng trống giữa $\text{Low}(\text{Nến } 1)$ và $\text{High}(\text{Nến } 3)$ khi $\text{High}_3 < \text{Low}_1$.
* **Ngưỡng lọc (`fvg_threshold_pct = 1.5%`):** Chỉ chấp nhận các FVG có biên độ đủ rộng để đảm bảo lực dịch chuyển dòng tiền của Market Maker.

```
       [Nến 1]          [Nến 2 - Nến Xung Lực]          [Nến 3]
       ┌─────┐                  ┌─────┐                 ┌─────┐
       │     │                  │     │                 │     │
───────┴─────┴──────────────────┼─────┼─────────────────┴─────┴─────── Low Nến 3
                                │     │  ◄── [ FAIR VALUE GAP ]
───────┬─────┬──────────────────┼─────┼─────────────────┬─────┬─────── High Nến 1
       │     │                  │     │                 │     │
       └─────┘                  └─────┘                 └─────┘
```

### E. Liquidity Sweeps & Equal Highs/Lows (EQH/EQL)
* **Equal Highs (EQH) / Equal Lows (EQL):** Các vùng 2-3 đỉnh/đáy có mức giá chênh lệch không quá $0.1\%$. Đây là nơi tập trung lượng lớn lệnh Stop Loss của Retail Traders.
* **Liquidity Sweep (Quét Thanh Khoản):** Giá tạo râu nến đâm xuyên qua vùng EQH/EQL để hút thanh khoản rồi đóng nến quay đầu ngược lại. Đây là tín hiệu đảo chiều có xác suất thắng cao nhất của hệ thống.

---

## 5. VOLUME SPREAD & ABSORPTION RATIO (VSR)

* **Khối lượng bất thường (Volume Climax):** $\text{Volume} > 2.5 \times \text{SMA}(\text{Volume}, 20)$.
* **Sự hấp thụ giá (Volume Absorption):** Khối lượng cực lớn nhưng thân nến nhỏ kèm râu dài $\rightarrow$ Báo hiệu dòng tiền thông minh đang gom hàng/phân phối đối ứng.
