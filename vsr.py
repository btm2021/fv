"""
Volume Spike Reversal (VSR) Indicator (Python)
Converted 1:1 from vsr.js
"""

import numpy as np
import pandas as pd

def calculate_vsr(
    df: pd.DataFrame,
    length: int = 10,
    threshold: float = 10.0
) -> list:
    """
    Calculate VSR (Volume Spike Reversal) levels and zones.
    Parameters:
        df: DataFrame with 'high', 'low', 'close', 'volume', 'time'
        length: Volume SD length (default 10)
        threshold: Volume spike threshold (default 10.0)
    Returns:
        List of dicts: [{'upper', 'lower', 'signal', 'isSpike', 'time'}]
    """
    n = len(df)
    if n == 0:
        return []

    highs = df['high'].astype(float).values
    lows = df['low'].astype(float).values
    closes = df['close'].astype(float).values
    volumes = df['volume'].astype(float).values
    
    if 'time' in df.columns:
        times_raw = df['time'].values
        times = (times_raw // 1000).astype(int) if times_raw[0] > 1e11 else times_raw.astype(int)
    else:
        times = np.arange(n)

    results = []
    prev_volume = np.nan
    prev_stdev = np.nan
    vsr_upper = np.nan
    vsr_lower = np.nan
    volume_changes = []

    for i in range(n):
        high = float(highs[i])
        low = float(lows[i])
        close = float(closes[i])
        vol = float(volumes[i])
        t = int(times[i])

        # 1. Calculate volume percentage change: vol / prev_volume - 1
        change = 0.0
        if not np.isnan(prev_volume) and prev_volume != 0:
            change = (vol / prev_volume) - 1.0

        volume_changes.append(change)
        if len(volume_changes) > length:
            volume_changes.pop(0)

        # 2. Calculate standard deviation of volume changes (population / length)
        stdev = 0.0
        if len(volume_changes) >= 2:
            mean = sum(volume_changes) / len(volume_changes)
            variance = sum((v - mean) ** 2 for v in volume_changes) / len(volume_changes)
            stdev = np.sqrt(variance)

        # 3. Calculate difference & signal: change / prev_stdev
        difference = 0.0
        signal = 0.0
        if not np.isnan(prev_stdev) and prev_stdev != 0 and len(volume_changes) >= 2:
            difference = change / prev_stdev
            signal = abs(difference)

        # 4. Create / update VSR zone when signal > threshold
        is_spike = False
        if signal > threshold and not np.isnan(high) and not np.isnan(low) and not np.isnan(close):
            is_spike = True
            proposed_upper = max(high, close)
            proposed_lower = min(low, close)

            is_overlap = False
            if not np.isnan(vsr_upper) and not np.isnan(vsr_lower):
                if proposed_lower <= vsr_upper and vsr_lower <= proposed_upper:
                    is_overlap = True

            if is_overlap:
                vsr_upper = max(vsr_upper, proposed_upper)
                vsr_lower = min(vsr_lower, proposed_lower)
            else:
                vsr_upper = proposed_upper
                vsr_lower = proposed_lower

        prev_volume = vol
        prev_stdev = stdev

        results.append({
            'upper': round(vsr_upper, 2) if not np.isnan(vsr_upper) else None,
            'lower': round(vsr_lower, 2) if not np.isnan(vsr_lower) else None,
            'signal': round(signal, 4),
            'isSpike': bool(is_spike),
            'time': t
        })

    return results
