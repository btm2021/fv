"""
Generate stat2.js and stat2.html
"""
import os

with open('stat1.js', 'r', encoding='utf-8') as f:
    js_code = f.read()

# Replace DB_NAME and default instances
js_code = js_code.replace("const DB_NAME = 'SMC_STAT1_DB';", "const DB_NAME = 'SMC_STAT2_DB';")
js_code = js_code.replace("STAT1 Engine", "STAT2 Engine")

old_inst = """    indicatorInstances: [
      {
        id: 'inst_smc_1',
        type: 'smc',
        name: 'Smart Money Concepts',
        visible: true,
        inputs: { swingLength: 20, closeBreak: 'true', rangePercent: 1.0, unmitigatedOnly: 'false' },
        style: { showOB: true, bullOBColor: '#3b82f6', bearOBColor: '#f59e0b', showFVG: true, bullFVGColor: '#10b981', bearFVGColor: '#f43f5e', showLiquidity: true, bslColor: '#d946ef', sslColor: '#6366f1', showBOS: true, bosColor: '#06b6d4', chochColor: '#ec4899', showSwings: true }
      },
      {
        id: 'inst_atr_1',
        type: 'atrbot',
        name: 'ATRBot',
        visible: true,
        inputs: { maType: 'VIDYA', source: 'close', maLength: 21, cmoLength: 14, atrLength: 14, atrMult: 2.0 },
        style: { showRibbon: true, bullCloudColor: '#10b981', bearCloudColor: '#f43f5e', showVidyaLine: true, vidyaColor: '#06b6d4', vidyaWidth: 2, showStopLine: true, stopColor: '#f59e0b', stopWidth: 2, showSignals: true }
      },
      {
        id: 'inst_vsr_1',
        type: 'vsr',
        name: 'VSR Zones',
        visible: true,
        inputs: { length: 10, threshold: 10.0 },
        style: { showZones: true, zoneColor: '#a855f7', borderDash: 'dashed', showLabels: true }
      },
      {
        id: 'inst_ema_1',
        type: 'ema',
        name: 'EMA Ribbon',
        visible: true,
        inputs: { period1: 21, period2: 50, period3: 200, source: 'close' },
        style: { showEma1: true, ema1Color: '#38bdf8', ema1Width: 1.5, showEma2: true, ema2Color: '#a855f7', ema2Width: 1.5, showEma3: true, ema3Color: '#f59e0b', ema3Width: 2 }
      },
      {
        id: 'inst_vwap_1',
        type: 'vwap',
        name: 'VWAP',
        visible: true,
        inputs: { anchor: 'session', rollingPeriod: 200, source: 'hlc3', stdevMult1: 1.0, stdevMult2: 2.0, stdevMult3: 3.0 },
        style: { showVwap: true, vwapColor: '#fbbf24', vwapWidth: 2, showBand1: false, band1Color: '#38bdf8', showBand2: false, band2Color: '#a855f7' }
      }
    ]"""

new_inst = """    indicatorInstances: [
      {
        id: 'inst_stat2_box_1',
        type: 'stat2_box_strategy',
        name: 'STAT2 Pro Box Strategy',
        visible: true,
        inputs: {
          strategyMode: 'dual',
          cmoLength: 14,
          maLength: 21,
          atrLength: 14,
          atrMult: 2.0,
          minAtrPct: 0.35,
          liqThresholdPct: 1.5,
          fvgThresholdPct: 1.5,
          swingLookback: 30,
          maxCardsVisible: 12
        },
        style: {
          showCards: true,
          cardWidth: 165,
          cardBackground: '#0f172a',
          cardOpacity: 0.92,
          showGuideLines: true,
          showFVG: true,
          showLiquidity: true,
          showRibbon: true,
          showTrail2: true,
          bullCloudColor: '#10b981',
          bearCloudColor: '#f43f5e',
          stopColor: '#a855f7',
          buyColor: '#10b981',
          sellColor: '#f43f5e',
          fadeShortColor: '#f59e0b',
          fadeLongColor: '#06b6d4'
        }
      },
      {
        id: 'inst_ema_1',
        type: 'ema',
        name: 'EMA Ribbon',
        visible: true,
        inputs: { period1: 21, period2: 50, period3: 200, source: 'close' },
        style: { showEma1: true, ema1Color: '#38bdf8', ema1Width: 1.5, showEma2: true, ema2Color: '#a855f7', ema2Width: 1.5, showEma3: true, ema3Color: '#f59e0b', ema3Width: 2 }
      },
      {
        id: 'inst_vwap_1',
        type: 'vwap',
        name: 'VWAP',
        visible: true,
        inputs: { anchor: 'session', rollingPeriod: 200, source: 'hlc3', stdevMult1: 1.0, stdevMult2: 2.0, stdevMult3: 3.0 },
        style: { showVwap: true, vwapColor: '#fbbf24', vwapWidth: 2, showBand1: false, band1Color: '#38bdf8', showBand2: false, band2Color: '#a855f7' }
      }
    ]"""

js_code = js_code.replace(old_inst, new_inst)

with open('stat2.js', 'w', encoding='utf-8') as f:
    f.write(js_code)

print('Generated stat2.js')

# Generate stat2.html
with open('stat1.html', 'r', encoding='utf-8') as f:
    html_code = f.read()

html_code = html_code.replace(
    '<title>STAT1 • SMC + ATRBot + VSR (Binance Futures & IndexedDB Cache)</title>',
    '<title>STAT2 • Pro Box Strategy (Entry / TP / SL / Status Cards)</title>'
)
html_code = html_code.replace('STAT1 • SMC SUITE', 'STAT2 • PRO BOX HUD')
html_code = html_code.replace('<script src="stat1.js"></script>', '<script src="stat2.js"></script>')

with open('stat2.html', 'w', encoding='utf-8') as f:
    f.write(html_code)

print('Generated stat2.html')
