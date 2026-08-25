"""
STEP 17: Fixed 1% Risk ($1,000 Capital) Comprehensive Backtest & Performance Forensics
══════════════════════════════════════════════════════════════════════════════════════
Capital Management Rules:
- Initial Capital: $1,000.00 USD
- Fixed Risk per trade: 1.00% of Current Account Equity
- Position Size: Position_USD = (Current_Equity * 0.01) / SL_Distance_Pct
- Commission: 0.05% Taker (Market Entry & Market SL) / 0.02% Maker (Limit Fade Entry & TP)
- Strategy: SMC + ATRBot Dual Strategy (Trend & Fade Liquidity Trap)
- Dataset: All 20 Symbols (10 High Vol + 10 Mid Vol), 50,000 candles each (1,000,000 bars total, 5m)
"""

import os
import glob
import numpy as np
import pandas as pd
from datetime import datetime

TRADES_CSV = "analysis/mt5_trades_strategy1.csv"
DATA_DIR = "data_analisic_5m"
INITIAL_EQUITY = 1000.0  # $1,000 USD Starting Capital
RISK_PCT = 0.01          # 1.00% Risk per trade
MAX_LEVERAGE = 10.0      # Max leverage safety cap (10x)

def run_fixed_1pct_simulation():
    if not os.path.exists(TRADES_CSV):
        print(f"Error: {TRADES_CSV} not found!")
        return None
        
    df = pd.read_csv(TRADES_CSV)
    
    # Sort strictly chronologically
    if 'signal_datetime' in df.columns:
        df['datetime'] = pd.to_datetime(df['signal_datetime'])
        df = df.sort_values(by=['datetime', 'entry_bar']).reset_index(drop=True)
    else:
        df = df.sort_values(by=['entry_bar']).reset_index(drop=True)
        
    n_trades = len(df)
    print(f"Loaded {n_trades} historical trades across 20 symbols.")
    
    current_equity = INITIAL_EQUITY
    equity_curve = [current_equity]
    trade_logs = []
    
    peak_equity = current_equity
    max_dd_usd = 0.0
    max_dd_pct = 0.0
    
    for idx, row in df.iterrows():
        # 1. Risk calculation
        risk_usd = current_equity * RISK_PCT
        
        # Stop-loss percentage distance
        sl_pct_raw = abs(row['max_sl_pct']) / 100.0 if row['max_sl_pct'] != 0 else 0.025
        sl_pct = max(sl_pct_raw, 0.015) # floor sl at 1.5% for position sizing safety
        
        # Position sizing: (Equity * 1%) / SL_pct
        pos_size_usd = risk_usd / sl_pct
        # Leverage cap (max 10x account equity)
        pos_size_usd = min(pos_size_usd, current_equity * MAX_LEVERAGE)
        
        # Trade outcome
        net_ret_pct = row['net_pnl_pct'] / 100.0
        pnl_usd = pos_size_usd * net_ret_pct
        
        # Cap loss at exactly -1% risk (if slippage occurred)
        if pnl_usd < -risk_usd * 1.15:
            pnl_usd = -risk_usd * 1.15 # Max loss with realistic slippage
            
        equity_before = current_equity
        current_equity += pnl_usd
        equity_after = current_equity
        
        # Track drawdown
        if current_equity > peak_equity:
            peak_equity = current_equity
        dd_usd = peak_equity - current_equity
        dd_pct = (dd_usd / peak_equity) * 100.0
        
        if dd_usd > max_dd_usd:
            max_dd_usd = dd_usd
        if dd_pct > max_dd_pct:
            max_dd_pct = dd_pct
            
        equity_curve.append(current_equity)
        
        trade_logs.append({
            'trade_idx': idx + 1,
            'datetime': row.get('signal_datetime', ''),
            'symbol': row['symbol'],
            'trade_type': row['trade_type'],
            'direction': row['direction'],
            'entry_price': row['entry_price'],
            'exit_price': row['exit_price'],
            'exit_reason': row['exit_reason'],
            'duration_bars': row['duration_bars'],
            'pos_size_usd': pos_size_usd,
            'leverage_used': pos_size_usd / equity_before,
            'sl_pct': sl_pct * 100.0,
            'net_pnl_pct': row['net_pnl_pct'],
            'pnl_usd': pnl_usd,
            'is_win': pnl_usd > 0,
            'equity_after': equity_after,
            'drawdown_pct': dd_pct
        })
        
    sim_df = pd.DataFrame(trade_logs)
    
    # ── PERFORMANCE METRICS ──
    total_trades = len(sim_df)
    wins = sim_df[sim_df['is_win'] == True]
    losses = sim_df[sim_df['is_win'] == False]
    
    n_wins = len(wins)
    n_losses = len(losses)
    win_rate = (n_wins / total_trades) * 100.0
    
    total_profit_usd = wins['pnl_usd'].sum()
    total_loss_usd = abs(losses['pnl_usd'].sum())
    profit_factor = (total_profit_usd / total_loss_usd) if total_loss_usd > 0 else 999.0
    
    net_profit_usd = current_equity - INITIAL_EQUITY
    net_return_pct = (net_profit_usd / INITIAL_EQUITY) * 100.0
    
    avg_win_usd = wins['pnl_usd'].mean() if n_wins > 0 else 0.0
    avg_loss_usd = losses['pnl_usd'].mean() if n_losses > 0 else 0.0
    
    # Streaks
    consec_w = 0
    max_consec_w = 0
    consec_l = 0
    max_consec_l = 0
    for is_w in sim_df['is_win']:
        if is_w:
            consec_w += 1
            consec_l = 0
            max_consec_w = max(max_consec_w, consec_w)
        else:
            consec_l += 1
            consec_w = 0
            max_consec_l = max(max_consec_l, consec_l)
            
    # Sharpe & Sortino
    pct_returns = np.diff(equity_curve) / np.array(equity_curve[:-1])
    sharpe = (np.mean(pct_returns) / np.std(pct_returns)) * np.sqrt(252 * 4) if len(pct_returns) > 1 and np.std(pct_returns) > 0 else 0.0
    downside_returns = pct_returns[pct_returns < 0]
    sortino = (np.mean(pct_returns) / np.std(downside_returns)) * np.sqrt(252 * 4) if len(downside_returns) > 1 and np.std(downside_returns) > 0 else 0.0
    calmar = (net_return_pct / max_dd_pct) if max_dd_pct > 0 else 999.0

    # ── BREAKDOWNS ──
    # By Symbol
    sym_summary = sim_df.groupby('symbol').agg(
        trades=('trade_idx', 'count'),
        wins=('is_win', lambda x: (x == True).sum()),
        win_rate=('is_win', lambda x: (x == True).mean() * 100.0),
        pnl_usd=('pnl_usd', 'sum')
    ).reset_index()
    
    # By Trade Type (Trend vs Fade)
    type_summary = sim_df.groupby('trade_type').agg(
        trades=('trade_idx', 'count'),
        wins=('is_win', lambda x: (x == True).sum()),
        win_rate=('is_win', lambda x: (x == True).mean() * 100.0),
        pnl_usd=('pnl_usd', 'sum')
    ).reset_index()

    # By Direction (Buy vs Sell)
    dir_summary = sim_df.groupby('direction').agg(
        trades=('trade_idx', 'count'),
        wins=('is_win', lambda x: (x == True).sum()),
        win_rate=('is_win', lambda x: (x == True).mean() * 100.0),
        pnl_usd=('pnl_usd', 'sum')
    ).reset_index()

    # By Exit Reason (TP vs SL vs Reverse)
    exit_summary = sim_df.groupby('exit_reason').agg(
        trades=('trade_idx', 'count'),
        wins=('is_win', lambda x: (x == True).sum()),
        win_rate=('is_win', lambda x: (x == True).mean() * 100.0),
        pnl_usd=('pnl_usd', 'sum')
    ).reset_index()

    # Save detailed CSV
    out_csv = "analysis/fixed_1pct_risk_trade_details.csv"
    sim_df.to_csv(out_csv, index=False)
    print(f"Saved trade-by-trade simulation log to {out_csv}")
    
    # Save text report
    out_report = "analysis/fixed_1pct_risk_report.txt"
    with open(out_report, 'w', encoding='utf-8') as f:
        f.write("═"*100 + "\n")
        f.write("      BÁO CÁO CHI TIẾT CHIẾN LƯỢC QUẢN LÝ VỐN: FIXED 1% RISK ($1,000 USD BAN ĐẦU)\n")
        f.write("═"*100 + "\n\n")
        
        f.write("1. TỔNG QUAN TÀI KHOẢN & TĂNG TRƯỞNG:\n")
        f.write(f"   • Vốn khởi điểm (Initial Capital)   : ${INITIAL_EQUITY:,.2f} USD\n")
        f.write(f"   • Vốn kết thúc (Final Equity)        : ${current_equity:,.2f} USD\n")
        f.write(f"   • Lợi nhuận ròng (Net Profit)        : +${net_profit_usd:,.2f} USD (+{net_return_pct:,.2f}%)\n")
        f.write(f"   • Tỷ lệ sụt giảm tối đa (Max DD %)  : {max_dd_pct:.2f}%\n")
        f.write(f"   • Số tiền sụt giảm tối đa (Max DD $) : ${max_dd_usd:,.2f} USD\n")
        f.write(f"   • Hệ số Lợi nhuận (Profit Factor)    : {profit_factor:.2f}x\n")
        f.write(f"   • Hệ số Sharpe Ratio                 : {sharpe:.2f}\n")
        f.write(f"   • Hệ số Sortino Ratio                : {sortino:.2f}\n")
        f.write(f"   • Hệ số Calmar Ratio                 : {calmar:.2f}\n\n")
        
        f.write("2. THỐNG KÊ LỆNH & HIỆU SUẤT GIAO DỊCH:\n")
        f.write(f"   • Tổng số lệnh (Total Trades)        : {total_trades:,} lệnh\n")
        f.write(f"   • Lệnh Thắng (Winning Trades)        : {n_wins:,} lệnh ({win_rate:.2f}%)\n")
        f.write(f"   • Lệnh Thua (Losing Trades)          : {n_losses:,} lệnh ({100 - win_rate:.2f}%)\n")
        f.write(f"   • Chuỗi Thắng Dài Nhất (Max Win Str) : {max_consec_w} lệnh liên tiếp\n")
        f.write(f"   • Chuỗi Thua Dài Nhất (Max Loss Str): {max_consec_l} lệnh liên tiếp\n")
        f.write(f"   • Lãi trung bình / Lệnh thắng       : +${avg_win_usd:.2f} USD\n")
        f.write(f"   • Lỗ trung bình / Lệnh thua          : ${avg_loss_usd:.2f} USD\n\n")
        
        f.write("3. PHÂN TÁCH THEO LOẠI CHIẾN LƯỢC (STRATEGY TYPE):\n")
        f.write(type_summary.to_string(index=False) + "\n\n")
        
        f.write("4. PHÂN TÁCH THEO HƯỚNG VÀO LỆNH (DIRECTION):\n")
        f.write(dir_summary.to_string(index=False) + "\n\n")
        
        f.write("5. PHÂN TÁCH THEO LÝ DO ĐÓNG LỆNH (EXIT REASON):\n")
        f.write(exit_summary.to_string(index=False) + "\n\n")
        
        f.write("6. PHÂN TÁCH THEO TỪNG CẶP TIỀN (SYMBOL BREAKDOWN - 20 COINS):\n")
        f.write(sym_summary.to_string(index=False) + "\n\n")
        
        f.write("═"*100 + "\n")
        
    print(f"Saved comprehensive report to {out_report}")
    
    # Print console summary
    print("\n" + "═"*90)
    print("🎯 KẾT QUẢ QUẢN LÝ VỐN FIXED 1% RISK - TÀI KHOẢN $1,000 USD")
    print("═"*90)
    print(f"💰 Vốn Ban Đầu        : ${INITIAL_EQUITY:,.2f} USD")
    print(f"📈 Vốn Kết Thúc       : ${current_equity:,.2f} USD")
    print(f"🚀 Lợi Nhuận Ròng     : +${net_profit_usd:,.2f} USD (+{net_return_pct:,.2f}%)")
    print(f"🛡️ Max Drawdown       : {max_dd_pct:.2f}% (${max_dd_usd:,.2f} USD)")
    print(f"🏆 Win Rate           : {win_rate:.2f}% ({n_wins} Win / {n_losses} Loss)")
    print(f"⭐ Profit Factor      : {profit_factor:.2f}x")
    print(f"⭐ Sharpe Ratio       : {sharpe:.2f}")
    print(f"⭐ Max Consec Wins    : {max_consec_w} lệnh liên tiếp")
    print(f"⭐ Max Consec Losses  : {max_consec_l} lệnh liên tiếp")
    print("═"*90)
    
    print("\n📊 PHÂN BỔ THEO LOẠI LỆNH (TREND vs FADE LIQUIDITY):")
    print(type_summary.to_string(index=False))
    
    print("\n📊 PHÂN BỔ THEO 20 SYMBOLS (TOP VOLUME & MID VOLUME):")
    print(sym_summary.to_string(index=False))
    print("═"*90)
    
    return sim_df

if __name__ == '__main__':
    run_fixed_1pct_simulation()
