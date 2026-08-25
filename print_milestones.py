import pandas as pd

df = pd.read_csv("analysis/fixed_1pct_risk_trade_details.csv")
print("Total Trades:", len(df))

milestones = [1500, 2000, 3000, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000]
hit = {}

for idx, row in df.iterrows():
    eq = row['equity_after']
    for m in milestones:
        if m not in hit and eq >= m:
            hit[m] = {
                'trade_num': row['trade_idx'],
                'date': row['datetime'],
                'equity': eq,
                'drawdown_at_time': row['drawdown_pct']
            }

print("=== ACCOUNT GROWTH MILESTONES (STARTING FROM $1,000) ===")
for m in milestones:
    if m in hit:
        info = hit[m]
        print(f"🎯 Target ${m:,.0f}: Reached at Trade #{info['trade_num']} ({info['date']}) | Equity: ${info['equity']:,.2f} | Current DD: {info['drawdown_at_time']:.2f}%")
