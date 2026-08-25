"""
ATR Bot Indicator Engine (Python)
Matches 1:1 with atrbot.js / TradingView Pine Script
Dynamic Trail with VIDYA / Multi-MA and Dynamic ATR Trailing Stop
"""

import sys
import numpy as np
import pandas as pd

if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass


def calculate_atr_bot(
    df: pd.DataFrame,
    cmo_length: int = 14,
    ma_length: int = 21,
    atr_length: int = 14,
    atr_mult: float = 2.0,
    ma_type: str = "VIDYA",
    source: str = "close"
) -> list:
    """
    Calculate ATR Bot Moving Average (Trail 1) and ATR Dynamic Trailing Stop (Trail 2)
    Parameters:
        df: DataFrame with 'open', 'high', 'low', 'close', 'time' (or 'timestamp')
        cmo_length: CMO period for VIDYA (default 14)
        ma_length: MA smoothing period (default 21)
        atr_length: ATR period (default 14)
        atr_mult: ATR multiplier (default 2.0)
        ma_type: Type of MA ('VIDYA', 'EMA', 'SMA')
        source: Source price ('close', 'hl2', 'hlc3', 'ohlc4', 'open')
    Returns:
        List of dicts: [{'time', 'trail1', 'trail2', 'trend', 'isBuy', 'isSell', 'atr'}]
    """
    n = len(df)
    if n == 0:
        return []

    opens = df['open'].astype(float).values
    highs = df['high'].astype(float).values
    lows = df['low'].astype(float).values
    closes = df['close'].astype(float).values

    time_col = 'time' if 'time' in df.columns else ('timestamp' if 'timestamp' in df.columns else None)
    if time_col:
        times_raw = df[time_col].values
        if times_raw[0] > 1e11:
            times = (times_raw // 1000).astype(int)
        else:
            times = times_raw.astype(int)
    else:
        times = np.arange(n)

    # Source Price Selection
    if source == "open":
        src_arr = opens
    elif source == "high":
        src_arr = highs
    elif source == "low":
        src_arr = lows
    elif source == "hl2":
        src_arr = (highs + lows) / 2.0
    elif source == "hlc3":
        src_arr = (highs + lows + closes) / 3.0
    elif source == "ohlc4":
        src_arr = (opens + highs + lows + closes) / 4.0
    else:
        src_arr = closes

    results = []

    prev_close = np.nan
    prev_atr = np.nan
    prev_trail1 = np.nan
    prev_trail2 = np.nan
    prev_trend = 0

    vidya_buffer = []  # list of (gain, loss)
    vidya_prev = np.nan
    prev_ema = np.nan

    for i in range(n):
        high = float(highs[i])
        low = float(lows[i])
        close = float(closes[i])
        src = float(src_arr[i])
        t = int(times[i])

        # 1. Moving Average (Trail 1)
        if ma_type.upper() == "VIDYA":
            if np.isnan(vidya_prev):
                trail1 = src
                vidya_prev = src
            else:
                prev_bar_close = closes[i - 1] if i > 0 else src
                change = src - prev_bar_close
                if change > 0:
                    vidya_buffer.append((change, 0.0))
                elif change < 0:
                    vidya_buffer.append((0.0, abs(change)))
                else:
                    vidya_buffer.append((0.0, 0.0))

                if len(vidya_buffer) > cmo_length:
                    vidya_buffer.pop(0)

                cmo = 0.0
                sum_gains = sum(b[0] for b in vidya_buffer)
                sum_losses = sum(b[1] for b in vidya_buffer)
                sum_total = sum_gains + sum_losses
                if sum_total > 0:
                    cmo = ((sum_gains - sum_losses) / sum_total) * 100.0

                ema_alpha = 2.0 / (ma_length + 1)
                alpha = ema_alpha * (abs(cmo) / 100.0)
                trail1 = alpha * src + (1.0 - alpha) * vidya_prev
                vidya_prev = trail1
        else:
            # Default to EMA
            if np.isnan(prev_ema):
                trail1 = src
            else:
                alpha = 2.0 / (ma_length + 1)
                trail1 = alpha * src + (1.0 - alpha) * prev_ema
            prev_ema = trail1

        # 2. Calculate True Range & ATR (Wilder's Smoothing RMA)
        if np.isnan(prev_close):
            tr = high - low
        else:
            tr = max(high - low, abs(high - prev_close), abs(low - prev_close))

        if np.isnan(prev_atr):
            atr = tr
        else:
            atr = (prev_atr * (atr_length - 1) + tr) / atr_length

        atr_value = atr * atr_mult

        # 3. Calculate Trail 2 (Dynamic ATR Trailing Stop)
        trail2 = trail1
        t2_prev = 0.0 if np.isnan(prev_trail2) else prev_trail2
        t1_prev = trail1 if np.isnan(prev_trail1) else prev_trail1

        if trail1 > t2_prev:
            if t1_prev > t2_prev:
                trail2 = max(t2_prev, trail1 - atr_value)
            else:
                trail2 = trail1 - atr_value
        else:
            if trail1 < t2_prev and t1_prev < t2_prev:
                trail2 = min(t2_prev, trail1 + atr_value)
            else:
                trail2 = trail1 + atr_value

        # 4. Trend State and Signals
        if trail1 > trail2:
            trend = 1
        elif trail1 < trail2:
            trend = -1
        else:
            trend = prev_trend

        is_buy = (trend == 1 and prev_trend == -1)
        is_sell = (trend == -1 and prev_trend == 1)

        # Store History
        prev_close = close
        prev_atr = atr
        prev_trail1 = trail1
        prev_trail2 = trail2
        prev_trend = trend

        results.append({
            'time': t,
            'trail1': round(trail1, 4),
            'trail2': round(trail2, 4),
            'trend': trend,
            'isBuy': bool(is_buy),
            'isSell': bool(is_sell),
            'atr': round(atr, 4)
        })

    return results


def calculate_atr_bot_df(
    df: pd.DataFrame,
    cmo_length: int = 14,
    ma_length: int = 21,
    atr_length: int = 14,
    atr_mult: float = 2.0,
    ma_type: str = "VIDYA",
    source: str = "close"
) -> pd.DataFrame:
    """
    Calculate ATR Bot and return as pandas DataFrame aligned with input df
    """
    raw_list = calculate_atr_bot(
        df,
        cmo_length=cmo_length,
        ma_length=ma_length,
        atr_length=atr_length,
        atr_mult=atr_mult,
        ma_type=ma_type,
        source=source
    )
    if not raw_list:
        return pd.DataFrame(columns=[
            'atrbot_trail1', 'atrbot_trail2', 'atrbot_trend', 'atrbot_buy', 'atrbot_sell', 'atrbot_atr'
        ])

    return pd.DataFrame({
        'atrbot_trail1': [r['trail1'] for r in raw_list],
        'atrbot_trail2': [r['trail2'] for r in raw_list],
        'atrbot_trend': [r['trend'] for r in raw_list],
        'atrbot_buy': [r['isBuy'] for r in raw_list],
        'atrbot_sell': [r['isSell'] for r in raw_list],
        'atrbot_atr': [r['atr'] for r in raw_list]
    }, index=df.index)
