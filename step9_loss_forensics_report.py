"""
Step 9: Deep-Dive Loss Forensics & Complete Strategy Master Report
===================================================================
1. Thống kê toàn diện 2 chiến lược:
   - Chiến Lược 1 (Filter Only): 950 lệnh
   - Chiến Lược 2 (Dual: Trend + Fade Liq Traps): 1.531 lệnh

2. Điều tra chi tiết NGUYÊN NHÂN CÁC LỆNH THUA CÒN LẠI:
   - 282 lệnh thua của Trend Strategy
   - 229 lệnh thua của Fade Trap Strategy
   - Đặc điểm kỹ thuật của các lệnh thua:
     * Biến động ATR (Thị trường sideway/nén hay bão giật?)
     * Độ rộng dải Trail Gap (atrbot_trail1 vs trail2)
     * Thời gian tồn tại trước khi chạm SL (bị kill nhanh hay giằng co?)
     * Cản FVG ngược chiều / Order Block cản đường
     * Choch / BOS đảo cấu trúc gần đó

Output:
  analysis/loss_forensics_report.txt
  analysis/trend_losses_details.csv
  analysis/fade_losses_details.csv
  analysis/master_strategy_summary.csv
"""

import os, sys, glob
import numpy as np
import pandas as pd

if sys.stdout.encoding != 'utf-8':
    try: sys.stdout.reconfigure(encoding='utf-8')
    except: pass

BASE_DIR          = os.path.dirname(os.path.abspath(__file__))
ENTRY_DIR_FILT    = os.path.join(BASE_DIR, "entry_filtered")
DATA_ANALISIC_DIR = os.path.join(BASE_DIR, "data_analisic")
ANALYSIS_DIR      = os.path.join(BASE_DIR, "analysis")
os.makedirs(ANALYSIS_DIR, exist_ok=True)

ROE_TARGET = 2.0

def load_symbol_analyzed_data():
    data = {}
    for f in sorted(glob.glob(os.path.join(DATA_ANALISIC_DIR, "*_analyzed.csv"))):
        sym = os.path.basename(f).replace("_analyzed.csv", "")
        adf = pd.read_csv(f)
        data[sym] = adf
    return data

def main():
    print("=" * 90)
    print("  DEEP-DIVE LOSS FORENSICS & MASTER STRATEGY EVALUATION")
    print("=" * 90)

    sym_data = load_symbol_analyzed_data()
    print(f"\n[1/4] Loaded analyzed dataset for {len(sym_data)} symbols.")

    # 1. Load Taken (Trend) Trades
    taken_file = os.path.join(ENTRY_DIR_FILT, "all_taken_trades.csv")
    df_trend = pd.read_csv(taken_file)
    trend_wins = df_trend[df_trend['label'] == 'win'].copy()
    trend_loses = df_trend[df_trend['label'] == 'lose'].copy()

    # 2. Load Skipped (Fade) Trades
    rev_file = os.path.join(ANALYSIS_DIR, "reverse_liq_trap_trades.csv")
    df_fade = pd.read_csv(rev_file)
    fade_wins = df_fade[df_fade['rev_label'] == 'win'].copy()
    fade_loses = df_fade[df_fade['rev_label'] == 'lose'].copy()

    print(f"  - Trend Trades: {len(df_trend)} | Wins: {len(trend_wins)} ({len(trend_wins)/len(df_trend)*100:.1f}%) | Losses: {len(trend_loses)} ({len(trend_loses)/len(df_trend)*100:.1f}%)")
    print(f"  - Fade Trades : {len(df_fade)} | Wins: {len(fade_wins)} ({len(fade_wins)/len(df_fade)*100:.1f}%) | Losses: {len(fade_loses)} ({len(fade_loses)/len(df_fade)*100:.1f}%)")

    # 3. Analyze Trend Losses
    print("\n[2/4] Extracting indicators context for 282 Trend Losses...")
    trend_loss_features = []
    for _, t in trend_loses.iterrows():
        sym = t['symbol']
        sig_idx = int(t['signal_index'])
        if sym not in sym_data or sig_idx >= len(sym_data[sym]):
            continue
        adf = sym_data[sym]
        bar = adf.iloc[sig_idx]
        prev_10 = adf.iloc[max(0, sig_idx-10):sig_idx+1]

        close = float(bar['close'])
        atr = float(bar['atrbot_atr']) if pd.notna(bar['atrbot_atr']) else 0.0
        trail1 = float(bar['atrbot_trail1']) if pd.notna(bar['atrbot_trail1']) else close
        trail2 = float(bar['atrbot_trail2']) if pd.notna(bar['atrbot_trail2']) else close

        atr_pct = (atr / close * 100.0) if close > 0 else 0.0
        trail_gap_pct = abs(trail1 - trail2) / close * 100.0 if close > 0 else 0.0

        # Counter FVG in last 10 bars
        fvg_col = prev_10['smc_fvg'].fillna(0)
        has_counter_fvg = ((t['direction'] == 'BUY' and (fvg_col < 0).any()) or
                           (t['direction'] == 'SELL' and (fvg_col > 0).any()))

        # ChoCH / BOS in last 10 bars
        has_choch = (prev_10['smc_choch'].fillna(0) != 0).any()
        has_bos = (prev_10['smc_bos'].fillna(0) != 0).any()

        trend_loss_features.append({
            'symbol': sym,
            'direction': t['direction'],
            'signal_datetime': t.get('signal_datetime', ''),
            'entry_price': t['entry_price'],
            'max_roe_pct': t['max_roe_pct'],
            'max_stoploss_pct': t['max_stoploss_pct'],
            'duration_bars': t['duration_bars'],
            'atr_pct': round(atr_pct, 3),
            'trail_gap_pct': round(trail_gap_pct, 3),
            'is_low_volatility': atr_pct < 0.35,
            'is_tight_gap': trail_gap_pct < 0.5,
            'has_counter_fvg': bool(has_counter_fvg),
            'has_recent_choch': bool(has_choch),
            'has_recent_bos': bool(has_bos),
            'quick_loss_under_10_bars': t['duration_bars'] <= 10
        })

    df_trend_loss_feats = pd.DataFrame(trend_loss_features)
    df_trend_loss_feats.to_csv(os.path.join(ANALYSIS_DIR, "trend_losses_details.csv"), index=False)

    # 4. Analyze Fade Losses
    print("[3/4] Extracting indicators context for 229 Fade Losses...")
    fade_loss_features = []
    for _, t in fade_loses.iterrows():
        sym = t['symbol']
        sig_idx = int(t['signal_index'])
        if sym not in sym_data or sig_idx >= len(sym_data[sym]):
            continue
        adf = sym_data[sym]
        bar = adf.iloc[sig_idx]
        close = float(bar['close'])
        atr = float(bar['atrbot_atr']) if pd.notna(bar['atrbot_atr']) else 0.0
        atr_pct = (atr / close * 100.0) if close > 0 else 0.0

        fade_loss_features.append({
            'symbol': sym,
            'rev_direction': t['rev_direction'],
            'entry_price': t['entry_price'],
            'rev_max_roe_pct': t['rev_max_roe_pct'],
            'rev_max_sl_pct': t['rev_max_sl_pct'],
            'duration_bars': t['duration_bars'],
            'atr_pct': round(atr_pct, 3),
            'strong_breakout_loss': t['rev_max_sl_pct'] > 3.0,
            'sideway_stuck_loss': t['rev_max_roe_pct'] < 1.0 and t['rev_max_sl_pct'] < 2.0
        })
    df_fade_loss_feats = pd.DataFrame(fade_loss_features)
    df_fade_loss_feats.to_csv(os.path.join(ANALYSIS_DIR, "fade_losses_details.csv"), index=False)

    # 5. Build Master Strategy Performance
    master_stats = []
    # By symbol comparison
    for sym in sorted(sym_data.keys()):
        t_sub = df_trend[df_trend['symbol'] == sym]
        f_sub = df_fade[df_fade['symbol'] == sym]

        t_win = (t_sub['label'] == 'win').sum()
        t_tot = len(t_sub)
        t_pnl = t_sub['net_pnl_pct'].sum()

        f_win = (f_sub['rev_label'] == 'win').sum()
        f_tot = len(f_sub)
        f_pnl = f_sub['rev_net_pnl_pct'].sum()

        tot_trades = t_tot + f_tot
        tot_wins = t_win + f_win
        tot_pnl = t_pnl + f_pnl

        master_stats.append({
            'symbol': sym,
            'trend_trades': t_tot,
            'trend_wins': t_win,
            'trend_wr': round(t_win / t_tot * 100, 1) if t_tot > 0 else 0,
            'trend_pnl': round(t_pnl, 1),
            'fade_trades': f_tot,
            'fade_wins': f_win,
            'fade_wr': round(f_win / f_tot * 100, 1) if f_tot > 0 else 0,
            'fade_pnl': round(f_pnl, 1),
            'dual_total_trades': tot_trades,
            'dual_total_wins': tot_wins,
            'dual_overall_wr': round(tot_wins / tot_trades * 100, 1) if tot_trades > 0 else 0,
            'dual_total_pnl': round(tot_pnl, 1)
        })

    df_master = pd.DataFrame(master_stats)
    df_master.to_csv(os.path.join(ANALYSIS_DIR, "master_strategy_summary.csv"), index=False)

    # 6. Generate Comprehensive Text Report
    print("\n[4/4] Writing master forensics report...")
    sep = "=" * 96
    lines = []
    lines.append(sep)
    lines.append("  BÁO CÁO GIẢI PHẪU NGUYÊN NHÂN LỆNH THUA & TỔNG KẾT CHIẾN LƯỢC TOÀN DIỆN")
    lines.append(sep)
    lines.append(f"  Tổng Quy Mô Kiểm Thử : 10 Symbols | 300.000 nến 15m (10/2025 - 08/2026)")
    lines.append(f"  Tổng Số Tín Hiệu Gốc : 1.531 Tín Hiệu ATRBot\n")

    # Table 1: Dual Master Performance
    lines.append(sep)
    lines.append("  1. BẢNG TỔNG HỢP HIỆU SUẤT CHIẾN LƯỢC KÉP (DUAL STRATEGY: TREND + FADE LIQ TRAP)")
    lines.append(sep)
    lines.append(f"  {'SYMBOL':<10}|{'TREND LỆNH':>11}|{'TREND WR':>9}|{'TREND PNL':>10}|{'FADE LỆNH':>10}|{'FADE WR':>8}|{'FADE PNL':>9}|{'TỔNG LỆNH':>10}|{'DUAL WR':>8}|{'TỔNG PNL':>10}")
    lines.append("  " + "-" * 94)
    for _, r in df_master.iterrows():
        lines.append(
            f"  {r['symbol']:<10}|{r['trend_trades']:>11}|{r['trend_wr']:>8.1f}%|{r['trend_pnl']:>9.1f}%|"
            f"{r['fade_trades']:>10}|{r['fade_wr']:>7.1f}%|{r['fade_pnl']:>8.1f}%|"
            f"{r['dual_total_trades']:>10}|{r['dual_overall_wr']:>7.1f}%|{r['dual_total_pnl']:>9.1f}%"
        )
    lines.append("  " + "-" * 94)
    t_tot_all = df_master['trend_trades'].sum()
    t_win_all = df_master['trend_wins'].sum()
    f_tot_all = df_master['fade_trades'].sum()
    f_win_all = df_master['fade_wins'].sum()
    d_tot_all = df_master['dual_total_trades'].sum()
    d_win_all = df_master['dual_total_wins'].sum()
    t_pnl_all = df_master['trend_pnl'].sum()
    f_pnl_all = df_master['fade_pnl'].sum()
    d_pnl_all = df_master['dual_total_pnl'].sum()

    lines.append(
        f"  {'TỔNG HỢP':<10}|{t_tot_all:>11}|{(t_win_all/t_tot_all*100):>8.1f}%|{t_pnl_all:>9.1f}%|"
        f"{f_tot_all:>10}|{(f_win_all/f_tot_all*100):>7.1f}%|{f_pnl_all:>8.1f}%|"
        f"{d_tot_all:>10}|{(d_win_all/d_tot_all*100):>7.1f}%|{d_pnl_all:>9.1f}%"
    )

    # Section 2: Trend Loss Analysis
    lines.append("\n" + sep)
    lines.append("  2. GIẢI PHẪU NGUYÊN NHÂN 282 LỆNH THUA CÒN LẠI CỦA PHẦN TREND")
    lines.append(sep)

    tl_low_vol = df_trend_loss_feats['is_low_volatility'].mean() * 100
    tl_tight_gap = df_trend_loss_feats['is_tight_gap'].mean() * 100
    tl_counter_fvg = df_trend_loss_feats['has_counter_fvg'].mean() * 100
    tl_choch = df_trend_loss_feats['has_recent_choch'].mean() * 100
    tl_quick = df_trend_loss_feats['quick_loss_under_10_bars'].mean() * 100
    avg_sl_hit = df_trend_loss_feats['max_stoploss_pct'].mean()
    avg_max_roe = df_trend_loss_feats['max_roe_pct'].mean()

    lines.append(f"  Tổng số lệnh thua Trend : 282 lệnh (chiếm 29.7% tổng số lệnh Trend)")
    lines.append(f"  - Max Adverse Sụt giảm TB: -{avg_sl_hit:.2f}% | Max ROE đạt được trước khi thua: +{avg_max_roe:.2f}%")
    lines.append(f"")
    lines.append(f"  CÁC ĐẶC ĐIỂM KỸ THUẬT NỔI BẬT CỦA LỆNH THUA:")
    lines.append(f"  [1] Thị trường nén / Volatility thấp (ATR < 0.35%) : {tl_low_vol:.1f}% ({int(df_trend_loss_feats['is_low_volatility'].sum())} lệnh)")
    lines.append(f"      -> Giá dao động hẹp, không tạo đủ sóng 2.0% ROE trước khi bị dải Trail quét stop.")
    lines.append(f"  [2] Dải Trail Gap quá hẹp (< 0.50% giá)           : {tl_tight_gap:.1f}% ({int(df_trend_loss_feats['is_tight_gap'].sum())} lệnh)")
    lines.append(f"      -> ATRBot vừa mới cắt mỏng, chưa hình thành đà bứt phá rõ ràng.")
    lines.append(f"  [3] Có FVG cản ngược chiều trong 10 nến trước     : {tl_counter_fvg:.1f}% ({int(df_trend_loss_feats['has_counter_fvg'].sum())} lệnh)")
    lines.append(f"      -> Vướng khối thanh khoản FVG đối kháng chặn đầu hướng đi của giá.")
    lines.append(f"  [4] Có CHoCH (Đổi tính chất cấu trúc) trước đó    : {tl_choch:.1f}% ({int(df_trend_loss_feats['has_recent_choch'].sum())} lệnh)")
    lines.append(f"      -> Thị trường đang trong pha giằng co xoay chiều (whipsaw).")
    lines.append(f"  [5] Bị quét dừng lỗ nhanh (dưới 10 nến 15m)       : {tl_quick:.1f}% ({int(df_trend_loss_feats['quick_loss_under_10_bars'].sum())} lệnh)")

    # Section 3: Fade Loss Analysis
    lines.append("\n" + sep)
    lines.append("  3. GIẢI PHẪU NGUYÊN NHÂN 229 LỆNH THUA CỦA PHẦN FADE LIQ TRAP")
    lines.append(sep)
    fl_strong_break = df_fade_loss_feats['strong_breakout_loss'].mean() * 100
    fl_sideway = df_fade_loss_feats['sideway_stuck_loss'].mean() * 100
    fl_avg_sl = df_fade_loss_feats['rev_max_sl_pct'].mean()
    fl_avg_roe = df_fade_loss_feats['rev_max_roe_pct'].mean()

    lines.append(f"  Tổng số lệnh thua Fade : 229 lệnh (chiếm 39.4% tổng số lệnh Fade)")
    lines.append(f"  - Max Adverse Sụt giảm TB: -{fl_avg_sl:.2f}% | Max ROE đảo chiều đạt được: +{fl_avg_roe:.2f}%")
    lines.append(f"")
    lines.append(f"  NGUYÊN NHÂN CHÍNH:")
    lines.append(f"  [1] Breakout quá mạnh (Real Trend Runaway) : {fl_strong_break:.1f}% ({int(df_fade_loss_feats['strong_breakout_loss'].sum())} lệnh)")
    lines.append(f"      -> Không phải bẫy quét thanh khoản mà là dòng tiền lớn đẩy thẳng bứt phá qua vùng BSL/SSL.")
    lines.append(f"  [2] Giá đi ngang tích lũy sau khi quét Liq : {fl_sideway:.1f}% ({int(df_fade_loss_feats['sideway_stuck_loss'].sum())} lệnh)")
    lines.append(f"      -> Giá chạm Liq nhưng không đảo chiều mạnh ngay, biên độ dao động dưới 2% đến hết chu kỳ.")

    # Section 4: Ultimate Actionable Checklist
    lines.append("\n" + sep)
    lines.append("  4. CHECKLIST KHUYẾN NGHỊ BỔ SUNG ĐỂ GIẢM THÊM LỆNH THUA")
    lines.append(sep)
    lines.append("  [A] Đối với Lệnh TREND:")
    lines.append("      - Thêm điều kiện lọc Volatility: Chỉ vào khi ATR% > 0.35% (tránh thị trường ngủ đông).")
    lines.append("      - Kiểm tra Trail Gap: Ưu tiên tín hiệu có khoảng cách Trail1 - Trail2 >= 0.5%.")
    lines.append("      - Đặt Stop-Loss dưới Swing Low (BUY) hoặc trên Swing High (SELL) để tránh dính wick quét ngắn.")
    lines.append("")
    lines.append("  [B] Đối với Lệnh FADE LIQ TRAP:")
    lines.append("      - Sử dụng Limit Order tại mức giá Liquidity thay vì Market Order để tối ưu thêm WinRate (74.1%).")
    lines.append("      - Luôn đặt Hard SL 2.5% - 3.0% phía ngoài vùng Liquidity để bảo vệ vốn khi gặp sóng Breakout thật.")
    lines.append(sep)

    rep_str = "\n".join(lines)
    rep_path = os.path.join(ANALYSIS_DIR, "loss_forensics_report.txt")
    with open(rep_path, 'w', encoding='utf-8') as f:
        f.write(rep_str)

    print("\n" + rep_str)


if __name__ == "__main__":
    main()
