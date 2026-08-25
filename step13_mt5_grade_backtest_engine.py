"""
Step 13: Institutional MT5-Grade Backtest Engine
=================================================
Mô phỏng giao dịch chuẩn xác cấp tổ chức (MetaTrader 5 Grade Simulation):
- Nguồn vốn khởi tạo: $10,000
- Phí giao dịch (Commission): 0.05% Taker (Market) / 0.02% Maker (Limit)
- Quản lý vốn: Cố định 1% Risk / lệnh với đòn bẩy hoặc Phân bổ $1,000 / lệnh
- Xử lý xung đột nến (Intra-bar Tie Breaking): Nếu cả TP và SL đều nằm trong biên độ High-Low của cùng 1 cây nến -> Bảo thủ coi như SL bị chạm trước.
- Không có Look-ahead Bias (100% Causal).

So sánh 2 Chiến lược trên 20 Symbols (50,000 nến 5m = 1,000,000 bars):
  Strategy 1: Dual Strategy Nâng Cao (Có lọc ATR + FVG + Swing SL + Limit Fade)
  Strategy 2: Dual Strategy Thuần Túy (Không lọc ATR/FVG, Market Fade)

Output:
  analysis/mt5_backtest_report.txt
  analysis/mt5_performance_comparison.csv
  analysis/mt5_trades_strategy1.csv
  analysis/mt5_trades_strategy2.csv
"""

import os, sys, glob, math
import numpy as np
import pandas as pd
from collections import defaultdict

if sys.stdout.encoding != 'utf-8':
    try: sys.stdout.reconfigure(encoding='utf-8')
    except: pass

BASE_DIR          = os.path.dirname(os.path.abspath(__file__))
DATA_ANALISIC_5M  = os.path.join(BASE_DIR, "data_analisic_5m")
ANALYSIS_DIR      = os.path.join(BASE_DIR, "analysis")
os.makedirs(ANALYSIS_DIR, exist_ok=True)

# ── THÔNG SỐ MT5 ENGINE ──
INITIAL_CAPITAL    = 10000.0   # $10,000 vốn khởi tạo
POSITION_SIZE_USD  = 1000.0    # $1,000 vốn trên mỗi vị thế (đòn bẩy chuẩn x1 cơ sở)
COMMISSION_TAKER   = 0.0005    # 0.05% Taker fee
COMMISSION_MAKER   = 0.0002    # 0.02% Maker fee

ROE_TP_PCT         = 2.0       # 2.0% Take Profit
MIN_ATR_PCT        = 0.35      # 0.35% ATR filter
LIQ_FILTER_PCT     = 1.5       # 1.5% Liquidity Trap threshold
FVG_FILTER_PCT     = 1.5       # 1.5% Counter FVG filter
FADE_HARD_SL_PCT   = 2.5       # 2.5% Hard SL cho Fade
SWING_LOOKBACK     = 30        # Lookback tìm Swing SL


def build_liq_zones(df):
    zones = []
    for i in range(len(df)):
        liq = df['smc_liquidity'][i]
        if pd.isna(liq) or liq == 0: continue
        end_idx = int(df['smc_liq_end_index'][i]) if pd.notna(df['smc_liq_end_index'][i]) else 999999
        swept = int(df['smc_liq_swept_index'][i]) if (pd.notna(df['smc_liq_swept_index'][i]) and df['smc_liq_swept_index'][i] > 0) else None
        lev = float(df['smc_liq_level'][i]) if pd.notna(df['smc_liq_level'][i]) else None
        if lev:
            zones.append({
                'start': i, 'end': end_idx, 'swept': swept,
                'type': 'BSL' if liq > 0 else 'SSL', 'level': lev
            })
    return zones


def check_danger_liq(bar_idx, direction, entry_price, zones):
    nearest_dist = float('inf')
    danger_level = None
    for z in zones:
        if z['start'] <= bar_idx <= z['end']:
            if z['swept'] is not None and z['swept'] <= bar_idx: continue
            if direction == 'BUY' and z['type'] == 'BSL' and z['level'] > entry_price:
                dist = (z['level'] - entry_price) / entry_price * 100.0
                if dist < nearest_dist:
                    nearest_dist = dist
                    danger_level = z['level']
            elif direction == 'SELL' and z['type'] == 'SSL' and z['level'] < entry_price:
                dist = (entry_price - z['level']) / entry_price * 100.0
                if dist < nearest_dist:
                    nearest_dist = dist
                    danger_level = z['level']
    is_danger = nearest_dist < LIQ_FILTER_PCT
    return is_danger, (nearest_dist if nearest_dist != float('inf') else None), danger_level


def check_counter_fvg(bar_idx, direction, entry_price, sdata):
    start_look = max(0, bar_idx - 15)
    for i in range(bar_idx, start_look - 1, -1):
        fvg = sdata['smc_fvg'][i]
        if np.isnan(fvg) or fvg == 0: continue
        mit = sdata['smc_fvg_mitigated_index'][i]
        if not np.isnan(mit) and 0 < mit <= bar_idx: continue
        top = sdata['smc_fvg_top'][i]
        bot = sdata['smc_fvg_bottom'][i]
        if direction == 'BUY' and fvg < 0 and not np.isnan(bot) and bot > entry_price:
            dist = (bot - entry_price) / entry_price * 100.0
            if dist < FVG_FILTER_PCT: return True, dist
        elif direction == 'SELL' and fvg > 0 and not np.isnan(top) and top < entry_price:
            dist = (entry_price - top) / entry_price * 100.0
            if dist < FVG_FILTER_PCT: return True, dist
    return False, None


def get_swing_sl(bar_idx, direction, entry_price, sdata):
    start_look = max(0, bar_idx - SWING_LOOKBACK)
    for i in range(bar_idx, start_look - 1, -1):
        shl = sdata['smc_swing_hl'][i]
        slev = sdata['smc_swing_level'][i]
        if np.isnan(shl) or np.isnan(slev): continue
        if direction == 'BUY' and shl < 0 and slev < entry_price:
            return slev * (1 - 0.0015)
        elif direction == 'SELL' and shl > 0 and slev > entry_price:
            return slev * (1 + 0.0015)
    return None


def simulate_trade_execution(direction, entry_price, entry_idx, exit_idx, sl_price, tp_price, sdata, is_maker=False):
    """
    Simulate chính xác từng nến từ entry_idx tới exit_idx với kiểm tra TP/SL Intra-bar.
    """
    highs = sdata['high']
    lows  = sdata['low']
    opens = sdata['open']
    n     = len(highs)
    end   = min(exit_idx, n - 1)

    comm_entry = COMMISSION_MAKER if is_maker else COMMISSION_TAKER
    comm_exit  = COMMISSION_TAKER # Khớp stop hoặc market exit

    exit_price = None
    exit_reason = None
    exit_bar = None
    max_roe = 0.0
    max_sl  = 0.0

    for bar_i in range(entry_idx, end + 1):
        h = highs[bar_i]
        l = lows[bar_i]

        if direction == 'BUY':
            cur_roe = (h - entry_price) / entry_price * 100.0
            cur_sl  = (entry_price - l) / entry_price * 100.0
            max_roe = max(max_roe, cur_roe)
            max_sl  = max(max_sl, cur_sl)

            hit_sl = (sl_price is not None) and (l <= sl_price)
            hit_tp = (tp_price is not None) and (h >= tp_price)

            if hit_sl and hit_tp:
                # Conservative MT5 rule: SL hit first
                exit_price = sl_price
                exit_reason = 'SL'
                exit_bar = bar_i
                break
            elif hit_sl:
                exit_price = sl_price
                exit_reason = 'SL'
                exit_bar = bar_i
                break
            elif hit_tp:
                exit_price = tp_price
                exit_reason = 'TP'
                exit_bar = bar_i
                break

        else: # SELL
            cur_roe = (entry_price - l) / entry_price * 100.0
            cur_sl  = (h - entry_price) / entry_price * 100.0
            max_roe = max(max_roe, cur_roe)
            max_sl  = max(max_sl, cur_sl)

            hit_sl = (sl_price is not None) and (h >= sl_price)
            hit_tp = (tp_price is not None) and (l <= tp_price)

            if hit_sl and hit_tp:
                exit_price = sl_price
                exit_reason = 'SL'
                exit_bar = bar_i
                break
            elif hit_sl:
                exit_price = sl_price
                exit_reason = 'SL'
                exit_bar = bar_i
                break
            elif hit_tp:
                exit_price = tp_price
                exit_reason = 'TP'
                exit_bar = bar_i
                break

    # Nếu không chạm TP hay SL trong suốt chu kỳ -> Đóng lệnh tại Open của nến đảo chiều
    if exit_price is None:
        exit_bar = end
        exit_price = opens[min(end + 1, n - 1)]
        exit_reason = 'REVERSE_SIGNAL'

    # Tính PnL Net sau phí
    if direction == 'BUY':
        gross_pnl_pct = (exit_price - entry_price) / entry_price * 100.0
    else:
        gross_pnl_pct = (entry_price - exit_price) / entry_price * 100.0

    fee_pct = (comm_entry + comm_exit) * 100.0
    net_pnl_pct = gross_pnl_pct - fee_pct
    net_profit_usd = (net_pnl_pct / 100.0) * POSITION_SIZE_USD

    return {
        'entry_price'   : round(entry_price, 4),
        'exit_price'    : round(exit_price, 4),
        'entry_bar'     : entry_idx,
        'exit_bar'      : exit_bar,
        'duration_bars' : exit_bar - entry_idx + 1,
        'exit_reason'   : exit_reason,
        'max_roe_pct'   : round(max_roe, 3),
        'max_sl_pct'    : round(max_sl, 3),
        'gross_pnl_pct' : round(gross_pnl_pct, 3),
        'fee_pct'       : round(fee_pct, 4),
        'net_pnl_pct'   : round(net_pnl_pct, 3),
        'net_profit_usd': round(net_profit_usd, 2),
        'is_win'        : net_profit_usd > 0
    }


def run_symbol_backtest(df_raw, sym, strategy_mode=1):
    """
    Chạy backtest cho 1 symbol:
    strategy_mode = 1: Enhanced Dual Strategy (Có lọc ATR, FVG, Swing SL, Liq Limit Fade)
    strategy_mode = 2: Raw Dual Strategy (Không lọc ATR/FVG, Market Fade, Dynamic Trail Exit)
    """
    n = len(df_raw)
    sdata = {
        'open': df_raw['open'].values,
        'high': df_raw['high'].values,
        'low': df_raw['low'].values,
        'close': df_raw['close'].values,
        'datetime': df_raw['datetime'].values if 'datetime' in df_raw.columns else [f"Bar {i}" for i in range(n)],
        'atrbot_buy': df_raw['atrbot_buy'].fillna(False).astype(bool).values,
        'atrbot_sell': df_raw['atrbot_sell'].fillna(False).astype(bool).values,
        'atrbot_atr': df_raw['atrbot_atr'].fillna(0).values,
        'atrbot_trail2': df_raw['atrbot_trail2'].values,
        'smc_fvg': df_raw['smc_fvg'].values if 'smc_fvg' in df_raw.columns else np.full(n, np.nan),
        'smc_fvg_top': df_raw['smc_fvg_top'].values if 'smc_fvg_top' in df_raw.columns else np.full(n, np.nan),
        'smc_fvg_bottom': df_raw['smc_fvg_bottom'].values if 'smc_fvg_bottom' in df_raw.columns else np.full(n, np.nan),
        'smc_fvg_mitigated_index': df_raw['smc_fvg_mitigated_index'].values if 'smc_fvg_mitigated_index' in df_raw.columns else np.full(n, np.nan),
        'smc_swing_hl': df_raw['smc_swing_hl'].values if 'smc_swing_hl' in df_raw.columns else np.full(n, np.nan),
        'smc_swing_level': df_raw['smc_swing_level'].values if 'smc_swing_level' in df_raw.columns else np.full(n, np.nan),
    }

    liq_zones = build_liq_zones(df_raw)

    signals = []
    for i in range(n):
        if sdata['atrbot_buy'][i]: signals.append((i, 'BUY'))
        elif sdata['atrbot_sell'][i]: signals.append((i, 'SELL'))

    trades = []

    for s_idx, (sig_bar, direction) in enumerate(signals):
        entry_bar = sig_bar + 1
        if entry_bar >= n: break

        market_entry = float(sdata['open'][entry_bar])
        close_p = float(sdata['close'][sig_bar])
        atr_val = float(sdata['atrbot_atr'][sig_bar])
        atr_pct = (atr_val / close_p * 100.0) if close_p > 0 else 0.0

        if s_idx < len(signals) - 1:
            exit_bar = signals[s_idx + 1][0]
        else:
            exit_bar = n - 1
        if exit_bar < entry_bar: exit_bar = entry_bar

        # Check Liq Trap
        is_liq_danger, danger_dist, danger_level = check_danger_liq(sig_bar, direction, market_entry, liq_zones)

        if not is_liq_danger:
            # ── NHÁNH TREND ──
            if strategy_mode == 1:
                # Enhanced: Lọc ATR + Counter FVG + Swing SL + TP 2%
                if atr_pct < MIN_ATR_PCT: continue
                has_c_fvg, _ = check_counter_fvg(sig_bar, direction, market_entry, sdata)
                if has_c_fvg: continue

                swing_sl = get_swing_sl(sig_bar, direction, market_entry, sdata)
                sl_p = swing_sl if swing_sl else (market_entry * (0.965 if direction == 'BUY' else 1.035))
                tp_p = market_entry * (1 + ROE_TP_PCT/100.0) if direction == 'BUY' else market_entry * (1 - ROE_TP_PCT/100.0)

                res = simulate_trade_execution(direction, market_entry, entry_bar, exit_bar, sl_p, tp_p, sdata, is_maker=False)
            else:
                # Raw: Không lọc, SL theo Trail2, không cài TP cứng
                trail2_p = float(sdata['atrbot_trail2'][sig_bar]) if not np.isnan(sdata['atrbot_trail2'][sig_bar]) else None
                res = simulate_trade_execution(direction, market_entry, entry_bar, exit_bar, trail2_p, None, sdata, is_maker=False)

            res.update({
                'symbol': sym, 'strategy_mode': strategy_mode, 'trade_type': 'TREND',
                'direction': direction, 'signal_bar': sig_bar, 'signal_datetime': sdata['datetime'][sig_bar]
            })
            trades.append(res)

        else:
            # ── NHÁNH FADE LIQ TRAP ──
            fade_dir = 'SELL' if direction == 'BUY' else 'BUY'
            liq_target = danger_level if danger_level else market_entry

            if strategy_mode == 1:
                # Enhanced: Limit Order tại Liq Level + Hard SL 2.5% + TP 2.0%
                fill_bar = None
                for bar_i in range(entry_bar, min(entry_bar + 20, n)):
                    if direction == 'BUY' and sdata['high'][bar_i] >= liq_target:
                        fill_bar = bar_i; break
                    elif direction == 'SELL' and sdata['low'][bar_i] <= liq_target:
                        fill_bar = bar_i; break
                if fill_bar is None: continue # Limit không khớp

                fade_entry = float(liq_target)
                fade_sl = fade_entry * (1 - FADE_HARD_SL_PCT/100.0) if fade_dir == 'BUY' else fade_entry * (1 + FADE_HARD_SL_PCT/100.0)
                fade_tp = fade_entry * (1 + ROE_TP_PCT/100.0) if fade_dir == 'BUY' else fade_entry * (1 - ROE_TP_PCT/100.0)

                res = simulate_trade_execution(fade_dir, fade_entry, fill_bar, exit_bar, fade_sl, fade_tp, sdata, is_maker=True)
            else:
                # Raw: Market Fade ngay nến tiếp theo, Hard SL 3%, không cài TP cứng
                fade_entry = market_entry
                fade_sl = fade_entry * (1 - 3.0/100.0) if fade_dir == 'BUY' else fade_entry * (1 + 3.0/100.0)
                res = simulate_trade_execution(fade_dir, fade_entry, entry_bar, exit_bar, fade_sl, None, sdata, is_maker=False)

            res.update({
                'symbol': sym, 'strategy_mode': strategy_mode, 'trade_type': 'FADE',
                'direction': fade_dir, 'signal_bar': sig_bar, 'signal_datetime': sdata['datetime'][sig_bar]
            })
            trades.append(res)

    return trades


def compute_mt5_metrics(trades_list, initial_capital=10000.0):
    """
    Tính toán bảng chỉ số đo lường hiệu suất tiêu chuẩn MetaTrader 5 (MT5 Grade Metrics).
    """
    if not trades_list:
        return {}

    df = pd.DataFrame(trades_list)
    total_trades = len(df)
    win_trades = df[df['net_profit_usd'] > 0]
    loss_trades = df[df['net_profit_usd'] <= 0]
    
    n_wins = len(win_trades)
    n_loss = len(loss_trades)
    win_rate = (n_wins / total_trades * 100.0) if total_trades > 0 else 0.0

    gross_profit = win_trades['net_profit_usd'].sum() if n_wins > 0 else 0.0
    gross_loss = abs(loss_trades['net_profit_usd'].sum()) if n_loss > 0 else 0.0
    net_profit = gross_profit - gross_loss
    profit_factor = (gross_profit / gross_loss) if gross_loss > 0 else (999.0 if gross_profit > 0 else 0.0)

    # Equity Curve & Drawdown Analysis
    df['cum_profit'] = df['net_profit_usd'].cumsum()
    df['equity'] = initial_capital + df['cum_profit']
    df['peak_equity'] = df['equity'].cummax()
    df['drawdown_usd'] = df['peak_equity'] - df['equity']
    df['drawdown_pct'] = (df['drawdown_usd'] / df['peak_equity']) * 100.0

    max_dd_usd = df['drawdown_usd'].max()
    max_dd_pct = df['drawdown_pct'].max()

    # Consecutive Wins & Losses
    wins_streak = max_wins_streak = 0
    loss_streak = max_loss_streak = 0
    for w in df['is_win'].values:
        if w:
            wins_streak += 1
            loss_streak = 0
            max_wins_streak = max(max_wins_streak, wins_streak)
        else:
            loss_streak += 1
            wins_streak = 0
            max_loss_streak = max(max_loss_streak, loss_streak)

    # Average Trade Metrics
    avg_trade_usd = net_profit / total_trades if total_trades > 0 else 0.0
    avg_win_usd = win_trades['net_profit_usd'].mean() if n_wins > 0 else 0.0
    avg_loss_usd = abs(loss_trades['net_profit_usd'].mean()) if n_loss > 0 else 0.0
    payoff_ratio = (avg_win_usd / avg_loss_usd) if avg_loss_usd > 0 else 0.0

    # Sharpe Ratio (annualized on trade returns)
    returns = df['net_pnl_pct'] / 100.0
    sharpe = (returns.mean() / returns.std() * math.sqrt(total_trades)) if returns.std() > 0 else 0.0
    recovery_factor = (net_profit / max_dd_usd) if max_dd_usd > 0 else 0.0

    # Directional Breakdown
    longs = df[df['direction'] == 'BUY']
    shorts = df[df['direction'] == 'SELL']
    long_wr = (len(longs[longs['is_win']]) / len(longs) * 100.0) if len(longs) > 0 else 0.0
    short_wr = (len(shorts[shorts['is_win']]) / len(shorts) * 100.0) if len(shorts) > 0 else 0.0

    return {
        'total_trades'        : total_trades,
        'win_trades'          : n_wins,
        'loss_trades'         : n_loss,
        'win_rate_pct'        : round(win_rate, 2),
        'net_profit_usd'      : round(net_profit, 2),
        'return_pct'          : round((net_profit / initial_capital) * 100.0, 2),
        'gross_profit_usd'    : round(gross_profit, 2),
        'gross_loss_usd'      : round(gross_loss, 2),
        'profit_factor'       : round(profit_factor, 2),
        'expected_payoff_usd' : round(avg_trade_usd, 2),
        'max_drawdown_usd'    : round(max_dd_usd, 2),
        'max_drawdown_pct'    : round(max_dd_pct, 2),
        'recovery_factor'     : round(recovery_factor, 2),
        'sharpe_ratio'        : round(sharpe, 2),
        'avg_win_usd'         : round(avg_win_usd, 2),
        'avg_loss_usd'        : round(avg_loss_usd, 2),
        'payoff_ratio'        : round(payoff_ratio, 2),
        'max_consec_wins'     : max_wins_streak,
        'max_consec_losses'   : max_loss_streak,
        'long_trades'         : len(longs),
        'long_win_rate_pct'   : round(long_wr, 2),
        'short_trades'        : len(shorts),
        'short_win_rate_pct'  : round(short_wr, 2),
    }


def main():
    print("=" * 96)
    print("  INSTITUTIONAL MT5-GRADE BACKTEST ENGINE (50,000 CANDLES 5m x 20 SYMBOLS)")
    print("=" * 96)

    analyzed_files = sorted(glob.glob(os.path.join(DATA_ANALISIC_5M, "*_analyzed_5m.csv")))
    if not analyzed_files:
        print(f"  No analyzed 5m files found in {DATA_ANALISIC_5M}!")
        return

    print(f"  Loaded {len(analyzed_files)} analyzed 5m symbol datasets.\n")

    strat1_all_trades = []
    strat2_all_trades = []

    sym_strat1_metrics = []
    sym_strat2_metrics = []

    for idx, f in enumerate(analyzed_files, 1):
        sym = os.path.basename(f).replace("_analyzed_5m.csv", "")
        print(f"[{idx}/{len(analyzed_files)}] Backtesting {sym}...", end='\r')
        df_sym = pd.read_csv(f)

        # Strategy 1: Enhanced Dual Strategy
        t1 = run_symbol_backtest(df_sym, sym, strategy_mode=1)
        strat1_all_trades.extend(t1)
        m1 = compute_mt5_metrics(t1, INITIAL_CAPITAL)
        m1['symbol'] = sym
        sym_strat1_metrics.append(m1)

        # Strategy 2: Raw Dual Strategy
        t2 = run_symbol_backtest(df_sym, sym, strategy_mode=2)
        strat2_all_trades.extend(t2)
        m2 = compute_mt5_metrics(t2, INITIAL_CAPITAL)
        m2['symbol'] = sym
        sym_strat2_metrics.append(m2)

    print(f"\n  Backtest completed for all {len(analyzed_files)} symbols.")

    # Save detailed trade logs
    df_t1 = pd.DataFrame(strat1_all_trades)
    df_t2 = pd.DataFrame(strat2_all_trades)
    df_t1.to_csv(os.path.join(ANALYSIS_DIR, "mt5_trades_strategy1.csv"), index=False)
    df_t2.to_csv(os.path.join(ANALYSIS_DIR, "mt5_trades_strategy2.csv"), index=False)

    # Master portfolio metrics
    overall_m1 = compute_mt5_metrics(strat1_all_trades, INITIAL_CAPITAL)
    overall_m2 = compute_mt5_metrics(strat2_all_trades, INITIAL_CAPITAL)

    # ── FORMAT MT5 GRADE REPORT ──
    sep = "=" * 96
    lines = []
    lines.append(sep)
    lines.append("  META TRADER 5 (MT5) GRADE STRATEGY PERFORMANCE REPORT")
    lines.append(sep)
    lines.append(f"  Timeframe          : 5 Minutes (5m)")
    lines.append(f"  Total Data Sample  : {len(analyzed_files)} Symbols x 50,000 Candles = {len(analyzed_files)*50000:,} Bars")
    lines.append(f"  Initial Capital    : ${INITIAL_CAPITAL:,.2f}")
    lines.append(f"  Position Sizing    : ${POSITION_SIZE_USD:,.2f} per position (with realistic commission)")
    lines.append("")

    lines.append(sep)
    lines.append("  1. COMPARATIVE EXECUTIVE OVERVIEW: STRATEGY 1 VS STRATEGY 2")
    lines.append(sep)
    lines.append(f"  {'METRIC':<36} | {'STRATEGY 1 (ENHANCED DUAL)':>25} | {'STRATEGY 2 (RAW DUAL)':>25}")
    lines.append("  " + "-" * 92)

    fields = [
        ("Total Net Profit", f"${overall_m1['net_profit_usd']:>+12,.2f} ({overall_m1['return_pct']:>+6.2f}%)", f"${overall_m2['net_profit_usd']:>+12,.2f} ({overall_m2['return_pct']:>+6.2f}%)"),
        ("Gross Profit / Gross Loss", f"${overall_m1['gross_profit_usd']:,.0f} / ${overall_m1['gross_loss_usd']:,.0f}", f"${overall_m2['gross_profit_usd']:,.0f} / ${overall_m2['gross_loss_usd']:,.0f}"),
        ("Profit Factor", f"{overall_m1['profit_factor']:>25.2f}", f"{overall_m2['profit_factor']:>25.2f}"),
        ("Expected Payoff (per trade)", f"${overall_m1['expected_payoff_usd']:>+24.2f}", f"${overall_m2['expected_payoff_usd']:>+24.2f}"),
        ("Sharpe Ratio", f"{overall_m1['sharpe_ratio']:>25.2f}", f"{overall_m2['sharpe_ratio']:>25.2f}"),
        ("Recovery Factor", f"{overall_m1['recovery_factor']:>25.2f}", f"{overall_m2['recovery_factor']:>25.2f}"),
        ("Maximal Drawdown ($ & %)", f"${overall_m1['max_drawdown_usd']:,.2f} ({overall_m1['max_drawdown_pct']:.2f}%)", f"${overall_m2['max_drawdown_usd']:,.2f} ({overall_m2['max_drawdown_pct']:.2f}%)"),
        ("Total Executed Trades", f"{overall_m1['total_trades']:>25,}", f"{overall_m2['total_trades']:>25,}"),
        ("Win Rate (%)", f"{overall_m1['win_rate_pct']:>24.2f}%", f"{overall_m2['win_rate_pct']:>24.2f}%"),
        ("Long Win Rate (Count)", f"{overall_m1['long_win_rate_pct']:.1f}% ({overall_m1['long_trades']})", f"{overall_m2['long_win_rate_pct']:.1f}% ({overall_m2['long_trades']})"),
        ("Short Win Rate (Count)", f"{overall_m1['short_win_rate_pct']:.1f}% ({overall_m1['short_trades']})", f"{overall_m2['short_win_rate_pct']:.1f}% ({overall_m2['short_trades']})"),
        ("Average Win / Average Loss", f"${overall_m1['avg_win_usd']:.2f} / ${overall_m1['avg_loss_usd']:.2f}", f"${overall_m2['avg_win_usd']:.2f} / ${overall_m2['avg_loss_usd']:.2f}"),
        ("Payoff Ratio (Win/Loss Size)", f"{overall_m1['payoff_ratio']:>25.2f}", f"{overall_m2['payoff_ratio']:>25.2f}"),
        ("Max Consecutive Wins / Losses", f"{overall_m1['max_consec_wins']} / {overall_m1['max_consec_losses']}", f"{overall_m2['max_consec_wins']} / {overall_m2['max_consec_losses']}"),
    ]

    for label, v1, v2 in fields:
        lines.append(f"  {label:<36} | {v1:>25} | {v2:>25}")

    lines.append("  " + "-" * 92)

    # Section 2: Symbol Breakdown Table for Strategy 1
    lines.append("\n" + sep)
    lines.append("  2. BREAKDOWN BY SYMBOL — STRATEGY 1 (ENHANCED DUAL: HIGH VOL VS MID VOL)")
    lines.append(sep)
    lines.append(f"  {'SYMBOL':<10}|{'VOL GROUP':<10}|{'TRADES':>8}|{'WIN RATE':>10}|{'PROFIT FACTOR':>15}|{'NET PROFIT ($)':>16}|{'MAX DD (%)':>12}|{'SHARPE':>8}")
    lines.append("  " + "-" * 94)

    high_vol_list = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "DOGEUSDT", "XRPUSDT", "ADAUSDT", "AVAXUSDT", "LINKUSDT", "NEARUSDT"]
    for m in sym_strat1_metrics:
        grp = "HIGH VOL" if m['symbol'] in high_vol_list else "MID VOL"
        lines.append(
            f"  {m['symbol']:<10}|{grp:<10}|{m['total_trades']:>8}|{m['win_rate_pct']:>9.1f}%|"
            f"{m['profit_factor']:>14.2f}x|${m['net_profit_usd']:>14,.2f}|{m['max_drawdown_pct']:>11.2f}%|{m['sharpe_ratio']:>7.2f}"
        )
    lines.append("  " + "-" * 94)

    rep_str = "\n".join(lines)
    rep_path = os.path.join(ANALYSIS_DIR, "mt5_backtest_report.txt")
    with open(rep_path, 'w', encoding='utf-8') as f:
        f.write(rep_str)

    print("\n" + rep_str)


if __name__ == "__main__":
    main()
