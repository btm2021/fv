"""
Step 3: ATRBot Entry & Trade Cycle Evaluator
Calculates:
- Entry at next candle Open upon ATRBot Buy / Sell signal
- Evaluates full ATRBot cycle until reverse signal
- Computes:
  * max_roe (%) : Maximum favorable price excursion
  * max_stoploss (%) : Maximum adverse price drawdown
  * net_pnl (%) : Cycle close PnL
  * label : 'win' if max_roe >= 2.0%, else 'lose'
Saves per-symbol trade logs to entry/<symbol>_entry.csv
and consolidates summary to entry/summary_all_symbols.csv
"""

import os
import sys
import glob
import time
import numpy as np
import pandas as pd

if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

DATA_ANALISIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data_analisic")
ENTRY_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "entry")
ROE_THRESHOLD_PCT = 2.0


def evaluate_symbol_entries(file_path: str, roe_threshold: float = 2.0) -> pd.DataFrame:
    """
    Evaluate all ATRBot cycles for a given analyzed symbol CSV
    """
    base_name = os.path.basename(file_path)
    sym = base_name.replace("_analyzed.csv", "").replace(".csv", "")
    print(f"\n[EVALUATE] Evaluating ATRBot Entries for {sym} (Threshold: >={roe_threshold}%)...")

    df = pd.read_csv(file_path)
    n = len(df)
    if n < 10:
        return pd.DataFrame()

    opens = df['open'].values
    highs = df['high'].values
    lows = df['low'].values
    closes = df['close'].values
    timestamps = df['timestamp'].values
    datetimes = df['datetime'].values if 'datetime' in df.columns else [f"Bar {i}" for i in range(n)]
    
    buys = df['atrbot_buy'].fillna(False).astype(bool).values
    sells = df['atrbot_sell'].fillna(False).astype(bool).values

    # Find all signal indices
    signals = []
    for i in range(n):
        if buys[i]:
            signals.append((i, 'BUY'))
        elif sells[i]:
            signals.append((i, 'SELL'))

    if not signals:
        print(f"  No ATRBot signals detected for {sym}!")
        return pd.DataFrame()

    trades = []
    for s_idx in range(len(signals)):
        sig_bar_idx, direction = signals[s_idx]
        
        # Entry is at next candle open to avoid lookahead bias
        entry_bar_idx = sig_bar_idx + 1
        if entry_bar_idx >= n:
            break

        # Exit bar is either the bar of the next opposite signal or last bar of dataset
        if s_idx < len(signals) - 1:
            exit_signal_bar_idx, _ = signals[s_idx + 1]
            exit_bar_idx = exit_signal_bar_idx  # cycle extends to when reverse signal closes
        else:
            exit_bar_idx = n - 1

        if exit_bar_idx < entry_bar_idx:
            exit_bar_idx = entry_bar_idx

        entry_price = float(opens[entry_bar_idx])
        entry_time = int(timestamps[entry_bar_idx])
        entry_dt = datetimes[entry_bar_idx]

        # Scan prices throughout the cycle
        cycle_highs = highs[entry_bar_idx:exit_bar_idx + 1]
        cycle_lows = lows[entry_bar_idx:exit_bar_idx + 1]
        
        if len(cycle_highs) == 0 or entry_price <= 0:
            continue

        highest_price = float(np.max(cycle_highs))
        lowest_price = float(np.min(cycle_lows))

        # Exit price (Open of bar after exit signal or Close of exit bar)
        if exit_bar_idx + 1 < n:
            exit_price = float(opens[exit_bar_idx + 1])
            exit_dt = datetimes[exit_bar_idx + 1]
            exit_time = int(timestamps[exit_bar_idx + 1])
        else:
            exit_price = float(closes[exit_bar_idx])
            exit_dt = datetimes[exit_bar_idx]
            exit_time = int(timestamps[exit_bar_idx])

        duration_bars = exit_bar_idx - entry_bar_idx + 1

        if direction == 'BUY':
            max_roe = ((highest_price - entry_price) / entry_price) * 100.0
            max_stoploss = ((entry_price - lowest_price) / entry_price) * 100.0
            net_pnl = ((exit_price - entry_price) / entry_price) * 100.0
            peak_fav_price = highest_price
            max_adv_price = lowest_price
        else:  # SELL
            max_roe = ((entry_price - lowest_price) / entry_price) * 100.0
            max_stoploss = ((highest_price - entry_price) / entry_price) * 100.0
            net_pnl = ((entry_price - exit_price) / entry_price) * 100.0
            peak_fav_price = lowest_price
            max_adv_price = highest_price

        label = 'win' if max_roe >= roe_threshold else 'lose'

        trades.append({
            'entry_id': len(trades) + 1,
            'symbol': sym,
            'direction': direction,
            'signal_index': sig_bar_idx,
            'signal_time': int(timestamps[sig_bar_idx]),
            'signal_datetime': datetimes[sig_bar_idx],
            'entry_index': entry_bar_idx,
            'entry_time': entry_time,
            'entry_datetime': entry_dt,
            'entry_price': round(entry_price, 4),
            'exit_index': exit_bar_idx,
            'exit_time': exit_time,
            'exit_datetime': exit_dt,
            'exit_price': round(exit_price, 4),
            'duration_bars': duration_bars,
            'peak_favorable_price': round(peak_fav_price, 4),
            'max_adverse_price': round(max_adv_price, 4),
            'max_roe_pct': round(max_roe, 3),
            'max_stoploss_pct': round(max_stoploss, 3),
            'net_pnl_pct': round(net_pnl, 3),
            'label': label
        })

    trades_df = pd.DataFrame(trades)
    
    os.makedirs(ENTRY_DIR, exist_ok=True)
    out_csv = os.path.join(ENTRY_DIR, f"{sym}_entry.csv")
    trades_df.to_csv(out_csv, index=False)

    total = len(trades_df)
    wins = len(trades_df[trades_df['label'] == 'win'])
    losses = len(trades_df[trades_df['label'] == 'lose'])
    winrate = (wins / total * 100) if total > 0 else 0
    avg_roe = trades_df['max_roe_pct'].mean() if total > 0 else 0
    avg_dd = trades_df['max_stoploss_pct'].mean() if total > 0 else 0
    avg_net = trades_df['net_pnl_pct'].mean() if total > 0 else 0

    print(f"  -> Total Trades: {total} | Wins: {wins} | Losses: {losses} | Winrate: {winrate:.1f}%")
    print(f"  -> Avg Max ROE: +{avg_roe:.2f}% | Avg Max DD: -{avg_dd:.2f}% | Avg Net PnL: {avg_net:+.2f}%")
    print(f"  -> Saved {out_csv}")
    return trades_df


def evaluate_all():
    os.makedirs(ENTRY_DIR, exist_ok=True)
    analyzed_files = sorted(glob.glob(os.path.join(DATA_ANALISIC_DIR, "*_analyzed.csv")))
    if not analyzed_files:
        print(f"No analyzed files found in {DATA_ANALISIC_DIR}. Run step2_analyze_indicators.py first!")
        return

    print(f"============================================================================")
    print(f" ATRBot Entry & Trade Evaluator (Win Criteria: Max ROE >= {ROE_THRESHOLD_PCT}%)")
    print(f" Input Directory : {DATA_ANALISIC_DIR}")
    print(f" Output Directory: {ENTRY_DIR}")
    print(f" Total Symbols   : {len(analyzed_files)}")
    print(f"============================================================================")

    all_summaries = []
    all_trades_list = []

    for f in analyzed_files:
        tdf = evaluate_symbol_entries(f, roe_threshold=ROE_THRESHOLD_PCT)
        if len(tdf) > 0:
            sym = tdf['symbol'].iloc[0]
            total = len(tdf)
            wins = len(tdf[tdf['label'] == 'win'])
            losses = len(tdf[tdf['label'] == 'lose'])
            wr = (wins / total) * 100.0 if total > 0 else 0.0
            
            all_summaries.append({
                'symbol': sym,
                'total_trades': total,
                'wins': wins,
                'losses': losses,
                'winrate_pct': round(wr, 2),
                'avg_max_roe_pct': round(tdf['max_roe_pct'].mean(), 2),
                'max_single_roe_pct': round(tdf['max_roe_pct'].max(), 2),
                'avg_max_drawdown_pct': round(tdf['max_stoploss_pct'].mean(), 2),
                'avg_net_pnl_pct': round(tdf['net_pnl_pct'].mean(), 2),
                'total_net_pnl_pct': round(tdf['net_pnl_pct'].sum(), 2),
                'avg_duration_bars': round(tdf['duration_bars'].mean(), 1)
            })
            all_trades_list.append(tdf)

    if not all_summaries:
        print("No trades generated.")
        return

    summary_df = pd.DataFrame(all_summaries)
    summary_csv = os.path.join(ENTRY_DIR, "summary_all_symbols.csv")
    summary_df.to_csv(summary_csv, index=False)

    # Consolidated Master Trades CSV
    master_df = pd.concat(all_trades_list, ignore_index=True)
    master_csv = os.path.join(ENTRY_DIR, "all_trades_consolidated.csv")
    master_df.to_csv(master_csv, index=False)

    # Print Pretty Console Summary Table
    total_trades_all = summary_df['total_trades'].sum()
    total_wins_all = summary_df['wins'].sum()
    total_losses_all = summary_df['losses'].sum()
    overall_wr = (total_wins_all / total_trades_all * 100) if total_trades_all > 0 else 0

    print(f"\n=========================================================================================================")
    print(f"                                   ATRBot BACKTEST SUMMARY ACROSS 10 SYMBOLS                             ")
    print(f"=========================================================================================================")
    print(f"{'SYMBOL':<10} | {'TRADES':<7} | {'WINS':<6} | {'LOSS':<6} | {'WINRATE':<9} | {'AVG ROE':<9} | {'AVG DD':<9} | {'AVG NET':<9} | {'TOTAL NET':<11}")
    print(f"---------------------------------------------------------------------------------------------------------")
    for _, r in summary_df.iterrows():
        print(f"{r['symbol']:<10} | {r['total_trades']:<7} | {r['wins']:<6} | {r['losses']:<6} | {r['winrate_pct']:>6.2f}%   | +{r['avg_max_roe_pct']:>5.2f}%   | -{r['avg_max_drawdown_pct']:>5.2f}%   | {r['avg_net_pnl_pct']:>+6.2f}%   | {r['total_net_pnl_pct']:>+8.2f}%")
    print(f"=========================================================================================================")
    print(f" OVERALL: {total_trades_all} Total Trades | {total_wins_all} Wins | {total_losses_all} Losses | Winrate: {overall_wr:.2f}%")
    print(f" Avg Max ROE across all trades: +{master_df['max_roe_pct'].mean():.2f}% | Avg Max DD: -{master_df['max_stoploss_pct'].mean():.2f}%")
    print(f" Consolidated summary saved to: {summary_csv}")
    print(f" Master all-trades saved to   : {master_csv}")
    print(f"=========================================================================================================\n")


if __name__ == "__main__":
    evaluate_all()
