"""
ATR Bot Indicator Engine (Python)
Converted 1:1 from atrbot.js
Dynamic Trail with VIDYA / Multi-MA and Trend State Detection
"""

import numpy as np
import pandas as pd

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
        df: DataFrame with 'open', 'high', 'low', 'close', 'time' (or indexed)
        cmo_length: CMO period for VIDYA (default 14)
        ma_length: MA period (default 21)
        atr_length: ATR period (default 14)
        atr_mult: ATR multiplier (default 2.0)
        ma_type: Type of MA ('VIDYA', 'EMA', 'SMA', etc.)
        source: Source price ('close', 'hl2', 'hlc3', 'ohlc4', etc.)
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
    
    if 'time' in df.columns:
        times_raw = df['time'].values
        # Detect if milliseconds or seconds
        if times_raw[0] > 1e11:
            times = (times_raw // 1000).astype(int)
        else:
            times = times_raw.astype(int)
    else:
        times = np.arange(n)

    # 1. Source Price Selection
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

    vidya_buffer = []  # deque / list of (gain, loss)
    vidya_prev = np.nan
    prev_ema = np.nan

    for i in range(n):
        high = float(highs[i])
        low = float(lows[i])
        close = float(closes[i])
        src = float(src_arr[i])
        t = int(times[i])

        # 2. Moving Average (Trail 1)
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

        # 3. Calculate True Range & ATR (Wilder's Smoothing RMA)
        if np.isnan(prev_close):
            tr = high - low
        else:
            tr = max(high - low, abs(high - prev_close), abs(low - prev_close))

        if np.isnan(prev_atr):
            atr = tr
        else:
            atr = (prev_atr * (atr_length - 1) + tr) / atr_length

        atr_value = atr * atr_mult

        # 4. Calculate Trail 2 (Dynamic ATR Trailing Stop)
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

        # 5. Trend and Signals
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
            'trail1': round(trail1, 2),
            'trail2': round(trail2, 2),
            'trend': trend,
            'isBuy': bool(is_buy),
            'isSell': bool(is_sell),
            'atr': round(atr, 2)
        })

    return results
