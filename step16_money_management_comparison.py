"""
STEP 16: Institutional Money Management Simulation & Comparison
═════════════════════════════════════════════════════════════════════
Applies 5 core position sizing & capital management frameworks
on the verified MT5-grade chronological trade logs (1,751 trades):

1. Fixed Sizing (Fixed $1,000 per trade & Fixed 2% Risk)
2. Martingale (1.5x & 2.0x after loss, capped)
3. Anti-Martingale (Reverse Martingale: compound on win streaks, reset on loss)
4. Kelly Criterion (Full Kelly, Half Kelly 0.5x, Quarter Kelly 0.25x)
5. Hybrid SMC Master (Dynamic Half-Kelly + Anti-Martingale Streak Multiplier + ATR Volatility Parity + Circuit Breaker)
"""

import os
import numpy as np
import pandas as pd
import math

TRADES_CSV = "analysis/mt5_trades_strategy1.csv"
INITIAL_CAPITAL = 10000.0  # $10,000 Starting Balance
MIN_TRADE_USD = 50.0       # Minimum trade size
MAX_LEVERAGE = 10.0        # Max leverage limit (10x)

def load_sorted_trades(filepath):
    df = pd.read_csv(filepath)
    # Sort strictly chronologically by signal_datetime and entry_bar
    if 'signal_datetime' in df.columns:
        df['datetime'] = pd.to_datetime(df['signal_datetime'])
        df = df.sort_values(by=['datetime', 'entry_bar']).reset_index(drop=True)
    else:
        df = df.sort_values(by=['entry_bar']).reset_index(drop=True)
    return df

def calculate_metrics(equity_curve, trade_pnls, name):
    equity = np.array(equity_curve)
    n_trades = len(trade_pnls)
    
    start_eq = equity[0]
    final_eq = equity[-1]
    net_profit = final_eq - start_eq
    net_return_pct = (net_profit / start_eq) * 100.0
    
    # Peak & Drawdown
    peaks = np.maximum.accumulate(equity)
    drawdowns_usd = peaks - equity
    drawdowns_pct = (drawdowns_usd / peaks) * 100.0
    max_dd_usd = np.max(drawdowns_usd)
    max_dd_pct = np.max(drawdowns_pct)
    
    # Win Rate & Wins/Losses
    wins = [p for p in trade_pnls if p > 0]
    losses = [p for p in trade_pnls if p < 0]
    n_wins = len(wins)
    n_losses = len(losses)
    win_rate = (n_wins / n_trades * 100.0) if n_trades > 0 else 0.0
    
    total_gain = sum(wins) if wins else 0.0
    total_loss = abs(sum(losses)) if losses else 0.0
    profit_factor = (total_gain / total_loss) if total_loss > 0 else 999.0
    
    # Returns for Sharpe & Sortino
    pct_returns = np.diff(equity) / equity[:-1]
    if len(pct_returns) > 1 and np.std(pct_returns) > 0:
        sharpe = (np.mean(pct_returns) / np.std(pct_returns)) * np.sqrt(252 * 4)  # ~4 trades/day annualized
        downside_returns = pct_returns[pct_returns < 0]
        downside_std = np.std(downside_returns) if len(downside_returns) > 1 else 1e-6
        sortino = (np.mean(pct_returns) / downside_std) * np.sqrt(252 * 4)
    else:
        sharpe = 0.0
        sortino = 0.0
        
    calmar = (net_return_pct / max_dd_pct) if max_dd_pct > 0 else 999.0
    
    # Consecutive streaks
    max_consec_wins = 0
    max_consec_losses = 0
    cur_w = 0
    cur_l = 0
    for p in trade_pnls:
        if p > 0:
            cur_w += 1
            cur_l = 0
            max_consec_wins = max(max_consec_wins, cur_w)
        elif p < 0:
            cur_l += 1
            cur_w = 0
            max_consec_losses = max(max_consec_losses, cur_l)
            
    # Risk of Ruin (< 50% equity)
    ruined = bool(np.any(equity < start_eq * 0.5))
    
    return {
        'Method': name,
        'Initial Capital': start_eq,
        'Final Equity': final_eq,
        'Net Profit ($)': net_profit,
        'Net Return (%)': net_return_pct,
        'Win Rate (%)': win_rate,
        'Profit Factor': profit_factor,
        'Max Drawdown ($)': max_dd_usd,
        'Max Drawdown (%)': max_dd_pct,
        'Sharpe Ratio': sharpe,
        'Sortino Ratio': sortino,
        'Calmar Ratio': calmar,
        'Max Consec Wins': max_consec_wins,
        'Max Consec Losses': max_consec_losses,
        'Ruin (<50%)': "YES ⚠️" if ruined else "NO 🛡️"
    }

# ─────────────────────────────────────────────────────────────────────────────
# SIMULATION ENGINES
# ─────────────────────────────────────────────────────────────────────────────

def run_fixed_amount(df, amount=1000.0):
    equity = INITIAL_CAPITAL
    eq_curve = [equity]
    pnls = []
    
    for idx, row in df.iterrows():
        ret_pct = row['net_pnl_pct'] / 100.0
        pos_size = min(amount, equity * MAX_LEVERAGE)
        if equity <= MIN_TRADE_USD:
            pos_size = 0.0
        pnl = pos_size * ret_pct
        equity += pnl
        eq_curve.append(equity)
        pnls.append(pnl)
        
    return eq_curve, pnls

def run_fixed_fractional(df, risk_pct=0.02):
    equity = INITIAL_CAPITAL
    eq_curve = [equity]
    pnls = []
    
    for idx, row in df.iterrows():
        ret_pct = row['net_pnl_pct'] / 100.0
        # Position sizing based on SL risk: Position = (Equity * Risk) / SL_dist
        sl_pct = abs(row['max_sl_pct']) / 100.0 if row['max_sl_pct'] != 0 else 0.025
        sl_pct = max(sl_pct, 0.015) # floor sl at 1.5%
        
        pos_size = (equity * risk_pct) / sl_pct
        pos_size = min(pos_size, equity * MAX_LEVERAGE)
        if equity <= MIN_TRADE_USD:
            pos_size = 0.0
            
        pnl = pos_size * ret_pct
        equity += pnl
        eq_curve.append(equity)
        pnls.append(pnl)
        
    return eq_curve, pnls

def run_martingale(df, base_risk_pct=0.01, mult=1.5, max_steps=4):
    equity = INITIAL_CAPITAL
    eq_curve = [equity]
    pnls = []
    step = 0
    
    for idx, row in df.iterrows():
        ret_pct = row['net_pnl_pct'] / 100.0
        current_mult = mult ** step
        effective_risk = min(base_risk_pct * current_mult, 0.15) # Cap at 15% risk max
        
        sl_pct = abs(row['max_sl_pct']) / 100.0 if row['max_sl_pct'] != 0 else 0.025
        sl_pct = max(sl_pct, 0.015)
        
        pos_size = (equity * effective_risk) / sl_pct
        pos_size = min(pos_size, equity * MAX_LEVERAGE)
        if equity <= MIN_TRADE_USD:
            pos_size = 0.0
            
        pnl = pos_size * ret_pct
        equity += pnl
        eq_curve.append(equity)
        pnls.append(pnl)
        
        # State transition
        if pnl < 0:
            step = min(step + 1, max_steps)
        else:
            step = 0 # Reset on win
            
    return eq_curve, pnls

def run_anti_martingale(df, base_risk_pct=0.015, boost_pct=0.30, max_boost=2.5):
    equity = INITIAL_CAPITAL
    eq_curve = [equity]
    pnls = []
    streak = 0
    
    for idx, row in df.iterrows():
        ret_pct = row['net_pnl_pct'] / 100.0
        
        # Scale UP on consecutive wins, reset on loss
        multiplier = min(1.0 + (streak * boost_pct), max_boost)
        effective_risk = base_risk_pct * multiplier
        
        sl_pct = abs(row['max_sl_pct']) / 100.0 if row['max_sl_pct'] != 0 else 0.025
        sl_pct = max(sl_pct, 0.015)
        
        pos_size = (equity * effective_risk) / sl_pct
        pos_size = min(pos_size, equity * MAX_LEVERAGE)
        if equity <= MIN_TRADE_USD:
            pos_size = 0.0
            
        pnl = pos_size * ret_pct
        equity += pnl
        eq_curve.append(equity)
        pnls.append(pnl)
        
        # State transition
        if pnl > 0:
            streak += 1
        else:
            streak = 0 # Immediate reset on loss (capital preservation)
            
    return eq_curve, pnls

def calculate_kelly_fraction(df):
    wins = df[df['net_pnl_pct'] > 0]['net_pnl_pct']
    losses = abs(df[df['net_pnl_pct'] < 0]['net_pnl_pct'])
    
    p = len(wins) / len(df) # Win Rate
    q = 1.0 - p
    avg_win = wins.mean() if len(wins) > 0 else 2.0
    avg_loss = losses.mean() if len(losses) > 0 else 2.0
    b = avg_win / avg_loss # Win/Loss Ratio
    
    kelly_f = (p * b - q) / b
    return max(0.01, min(kelly_f, 0.35)), p, b

def run_kelly(df, fraction_multiplier=1.0):
    full_kelly, p_win, b_ratio = calculate_kelly_fraction(df)
    target_f = full_kelly * fraction_multiplier
    
    equity = INITIAL_CAPITAL
    eq_curve = [equity]
    pnls = []
    
    for idx, row in df.iterrows():
        ret_pct = row['net_pnl_pct'] / 100.0
        
        # Position size = Equity * target_f
        pos_size = equity * target_f
        pos_size = min(pos_size, equity * MAX_LEVERAGE)
        if equity <= MIN_TRADE_USD:
            pos_size = 0.0
            
        pnl = pos_size * ret_pct
        equity += pnl
        eq_curve.append(equity)
        pnls.append(pnl)
        
    return eq_curve, pnls, full_kelly, p_win, b_ratio

def run_hybrid_smc_master(df):
    """
    Institutional Hybrid Engine:
    1. Base Sizing: Half-Kelly (f* / 2 ~ 12-15%)
    2. Streak Multiplier: +15% per consecutive win (cap 1.6x)
    3. Volatility Normalization: Size inversely proportional to ATR/SL distance
    4. Circuit Breaker: If Drawdown > 4%, cut risk in half until new High Watermark
    """
    full_kelly, _, _ = calculate_kelly_fraction(df)
    base_f = full_kelly * 0.5  # Half-Kelly baseline
    
    equity = INITIAL_CAPITAL
    eq_curve = [equity]
    pnls = []
    streak = 0
    peak_equity = INITIAL_CAPITAL
    
    for idx, row in df.iterrows():
        ret_pct = row['net_pnl_pct'] / 100.0
        if equity > peak_equity:
            peak_equity = equity
            
        current_dd_pct = (peak_equity - equity) / peak_equity * 100.0
        
        # 1. Base fraction
        f = base_f
        
        # 2. Anti-Martingale Streak Booster
        if streak >= 2:
            f *= min(1.0 + (streak - 1) * 0.15, 1.5)
            
        # 3. Drawdown Circuit Breaker
        if current_dd_pct > 3.5:
            f *= 0.50 # Defensive halving during market regime shifts
            
        # 4. Volatility Parity Normalization
        sl_pct = abs(row['max_sl_pct']) / 100.0 if row['max_sl_pct'] != 0 else 0.025
        vol_adj = 0.025 / max(sl_pct, 0.015)
        
        pos_size = equity * f * vol_adj
        pos_size = min(pos_size, equity * 4.0) # Max 4x leverage cap for safety
        if equity <= MIN_TRADE_USD:
            pos_size = 0.0
            
        pnl = pos_size * ret_pct
        equity += pnl
        eq_curve.append(equity)
        pnls.append(pnl)
        
        if pnl > 0:
            streak += 1
        else:
            streak = 0
            
    return eq_curve, pnls

# ─────────────────────────────────────────────────────────────────────────────
# MAIN EXECUTION
# ─────────────────────────────────────────────────────────────────────────────

def main():
    if not os.path.exists(TRADES_CSV):
        print(f"Error: {TRADES_CSV} not found!")
        return
        
    df = load_sorted_trades(TRADES_CSV)
    print(f"Loaded {len(df)} historical trades across 20 symbols.")
    
    full_k, p_w, b_r = calculate_kelly_fraction(df)
    print(f"Calculated Kelly Metrics: WinRate={p_w*100:.2f}%, Win/Loss Payoff Ratio={b_r:.2f}, Full Kelly f*={full_k*100:.2f}%\n")
    
    results = []
    
    # 1. Fixed Amount ($1,000)
    eq, pnls = run_fixed_amount(df, amount=1000.0)
    results.append(calculate_metrics(eq, pnls, "1. Fixed Sizing ($1,000 / Trade)"))
    
    # 2. Fixed Fractional Risk 1.0%
    eq, pnls = run_fixed_fractional(df, risk_pct=0.01)
    results.append(calculate_metrics(eq, pnls, "2. Fixed Risk (1.0% Equity Risk)"))
    
    # 3. Fixed Fractional Risk 2.0%
    eq, pnls = run_fixed_fractional(df, risk_pct=0.02)
    results.append(calculate_metrics(eq, pnls, "3. Fixed Risk (2.0% Equity Risk)"))
    
    # 4. Martingale (1.5x on Loss, Cap 4)
    eq, pnls = run_martingale(df, base_risk_pct=0.01, mult=1.5, max_steps=4)
    results.append(calculate_metrics(eq, pnls, "4. Martingale (1.5x on Loss, Cap 4)"))
    
    # 5. Martingale (2.0x on Loss, Cap 3)
    eq, pnls = run_martingale(df, base_risk_pct=0.01, mult=2.0, max_steps=3)
    results.append(calculate_metrics(eq, pnls, "5. Martingale (2.0x on Loss, Cap 3)"))
    
    # 6. Anti-Martingale (+30% on Win Streak, Reset on Loss)
    eq, pnls = run_anti_martingale(df, base_risk_pct=0.015, boost_pct=0.30, max_boost=2.5)
    results.append(calculate_metrics(eq, pnls, "6. Anti-Martingale (+30% Win Booster)"))
    
    # 7. Full Kelly
    eq, pnls, _, _, _ = run_kelly(df, fraction_multiplier=1.0)
    results.append(calculate_metrics(eq, pnls, f"7. Full Kelly Criterion ({full_k*100:.1f}%)"))
    
    # 8. Half Kelly (0.5x - Institutional Standard)
    eq, pnls, _, _, _ = run_kelly(df, fraction_multiplier=0.5)
    results.append(calculate_metrics(eq, pnls, f"8. Half Kelly ({full_k*50:.1f}% - Hedge Fund)"))
    
    # 9. Quarter Kelly (0.25x - Conservative)
    eq, pnls, _, _, _ = run_kelly(df, fraction_multiplier=0.25)
    results.append(calculate_metrics(eq, pnls, f"9. Quarter Kelly ({full_k*25:.1f}% - Conservative)"))
    
    # 10. Hybrid SMC Master
    eq, pnls = run_hybrid_smc_master(df)
    results.append(calculate_metrics(eq, pnls, "10. Hybrid SMC Master (Optimal)"))
    
    res_df = pd.DataFrame(results)
    
    # Save CSV
    out_csv = "analysis/money_management_comparison.csv"
    res_df.to_csv(out_csv, index=False)
    print(f"Saved results to {out_csv}")
    
    # Print formatted table
    print("\n" + "═"*110)
    print("📊 BẢNG SO SÁNH CÁC PHƯƠNG PHÁP QUẢN LÝ VỐN TRÊN 1,751 LỆNH (VỐN $10,000)")
    print("═"*110)
    
    disp_cols = ['Method', 'Final Equity', 'Net Profit ($)', 'Net Return (%)', 'Max Drawdown (%)', 'Profit Factor', 'Sharpe Ratio', 'Calmar Ratio', 'Ruin (<50%)']
    print(res_df[disp_cols].to_string(index=False, justify='center', formatters={
        'Final Equity': '${:,.2f}'.format,
        'Net Profit ($)': '${:,.2f}'.format,
        'Net Return (%)': '{:+.2f}%'.format,
        'Max Drawdown (%)': '{:.2f}%'.format,
        'Profit Factor': '{:.2f}x'.format,
        'Sharpe Ratio': '{:.2f}'.format,
        'Calmar Ratio': '{:.2f}'.format
    }))
    print("═"*110)

if __name__ == '__main__':
    main()
