"""
Update stat1.js and stat2.js to support Trade Decision Modal and Card Click Detection
"""

def update_file(filename):
    with open(filename, 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. Update cacheDomElements
    old_cache = "    el.tabFilterGainers = document.getElementById('tabFilterGainers');"
    new_cache = """    el.tabFilterGainers = document.getElementById('tabFilterGainers');
    // Trade Decision Modal
    el.tradeDecisionModal = document.getElementById('tradeDecisionModal');
    el.btnCloseTradeDecisionModal = document.getElementById('btnCloseTradeDecisionModal');
    el.btnOkTradeDecisionModal = document.getElementById('btnOkTradeDecisionModal');
    el.tradeDecisionModalBody = document.getElementById('tradeDecisionModalBody');
    el.tdModalBadge = document.getElementById('tdModalBadge');
    el.tdModalSymbol = document.getElementById('tdModalSymbol');"""
    if old_cache in content:
        content = content.replace(old_cache, new_cache)

    # 2. Add openTradeDecisionModal & closeTradeDecisionModal functions
    modal_funcs = """
  // --- Trade Decision & Forensics Modal ---
  function openTradeDecisionModal(card) {
    if (!card || !el.tradeDecisionModal) return;

    const pEntry = formatPrice(card.entryPrice);
    const pTp1   = formatPrice(card.tp1Price);
    const pTp2   = formatPrice(card.tp2Price);
    const pSl    = formatPrice(card.slPrice);

    const isLong = card.tradeDir === 'BUY';
    const badgeCol = card.signalType.startsWith('FADE') ? (isLong ? '#06b6d4' : '#f59e0b') : (isLong ? '#10b981' : '#f43f5e');
    const badgeTitle = card.signalType === 'FADE_SHORT' ? '⚡ FADE SHORT' : (card.signalType === 'FADE_LONG' ? '⚡ FADE LONG' : (isLong ? '▲ BUY TREND' : '▼ SELL TREND'));

    if (el.tdModalBadge) {
      el.tdModalBadge.textContent = badgeTitle;
      el.tdModalBadge.style.background = hexToRgba(badgeCol, 0.25);
      el.tdModalBadge.style.color = badgeCol;
      el.tdModalBadge.style.border = `1px solid ${badgeCol}`;
    }
    if (el.tdModalSymbol) {
      el.tdModalSymbol.textContent = `${state.settings.symbol} • ${state.settings.timeframe}`;
    }

    if (el.tradeDecisionModalBody) {
      el.tradeDecisionModalBody.innerHTML = `
        <!-- Price Overview Grid -->
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; background: #1e293b; padding: 12px; border-radius: 8px; text-align: center; font-family: 'JetBrains Mono', monospace;">
          <div>
            <div style="color: #94a3b8; font-size: 10px; text-transform: uppercase;">Entry</div>
            <div style="color: #f8fafc; font-weight: 700; font-size: 13px; margin-top: 2px;">${pEntry}</div>
          </div>
          <div>
            <div style="color: #10b981; font-size: 10px; text-transform: uppercase;">TP1 (50%)</div>
            <div style="color: #10b981; font-weight: 700; font-size: 13px; margin-top: 2px;">${pTp1}</div>
            <div style="font-size: 10px; color: #10b981; font-weight: 600;">+${card.tp1Pct.toFixed(1)}%</div>
          </div>
          <div>
            <div style="color: #38bdf8; font-size: 10px; text-transform: uppercase;">TP2 (50%)</div>
            <div style="color: #38bdf8; font-weight: 700; font-size: 13px; margin-top: 2px;">${pTp2}</div>
            <div style="font-size: 10px; color: #38bdf8; font-weight: 600;">+${card.tp2Pct.toFixed(1)}%</div>
          </div>
          <div>
            <div style="color: #f43f5e; font-size: 10px; text-transform: uppercase;">Stop-Loss</div>
            <div style="color: #f43f5e; font-weight: 700; font-size: 13px; margin-top: 2px;">${pSl}</div>
            <div style="font-size: 10px; color: #f43f5e; font-weight: 600;">-${card.slPct.toFixed(1)}%</div>
          </div>
        </div>

        <!-- Section 1: Side & Entry Rationale -->
        <div style="background: rgba(30, 41, 59, 0.6); border: 1px solid #334155; padding: 14px; border-radius: 8px;">
          <div style="font-weight: 700; color: #38bdf8; margin-bottom: 6px; font-size: 13.5px; display: flex; align-items: center; gap: 6px;">
            <span>1️⃣ Tại sao chọn Side ${card.tradeDir} & Mốc Entry?</span>
          </div>
          <p style="margin-bottom: 8px; color: #e2e8f0;">${card.sideRationale}</p>
          <div style="background: rgba(15, 23, 42, 0.8); padding: 8px 12px; border-radius: 6px; font-size: 12px; color: #94a3b8;">
            <strong style="color: #f8fafc;">📌 Mức Giá Entry (${pEntry}):</strong> ${card.entryRationale}
          </div>
        </div>

        <!-- Section 2: TP1 & TP2 Rationale -->
        <div style="background: rgba(30, 41, 59, 0.6); border: 1px solid #334155; padding: 14px; border-radius: 8px;">
          <div style="font-weight: 700; color: #10b981; margin-bottom: 6px; font-size: 13.5px; display: flex; align-items: center; gap: 6px;">
            <span>2️⃣ Tại sao chốt lời tại TP1 (${pTp1}) & TP2 (${pTp2})?</span>
          </div>
          <p style="margin-bottom: 8px; color: #e2e8f0;"><strong style="color: #10b981;">🎯 Mốc TP1 (Opposing FVG Target):</strong> ${card.tp1Rationale}</p>
          <p style="color: #e2e8f0;"><strong style="color: #38bdf8;">🏆 Mốc TP2 (Opposing Liquidity Pool):</strong> ${card.tp2Rationale}</p>
        </div>

        <!-- Section 3: Stop-Loss Rationale -->
        <div style="background: rgba(30, 41, 59, 0.6); border: 1px solid #334155; padding: 14px; border-radius: 8px;">
          <div style="font-weight: 700; color: #f43f5e; margin-bottom: 6px; font-size: 13.5px; display: flex; align-items: center; gap: 6px;">
            <span>3️⃣ Tại sao đặt Stop-Loss tại ${pSl}? (Kiểm Soát Rủi Ro)</span>
          </div>
          <p style="color: #e2e8f0;">${card.slRationale}</p>
        </div>

        <!-- Section 4: Quantitative Metrics & Risk -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-family: 'JetBrains Mono', monospace; font-size: 11.5px;">
          <div style="background: #1e293b; padding: 10px; border-radius: 6px;">
            <div style="color: #94a3b8;">Tỷ Lệ Risk / Reward (R:R)</div>
            <div style="font-size: 14px; font-weight: 700; color: #f8fafc; margin-top: 2px;">1 : ${card.rrRatio.toFixed(2)}</div>
          </div>
          <div style="background: #1e293b; padding: 10px; border-radius: 6px;">
            <div style="color: #94a3b8;">Động cơ Biến động ATR</div>
            <div style="font-size: 14px; font-weight: 700; color: #38bdf8; margin-top: 2px;">${card.atrPct.toFixed(2)}%</div>
          </div>
          <div style="background: #1e293b; padding: 10px; border-radius: 6px;">
            <div style="color: #94a3b8;">Thời điểm Tín hiệu</div>
            <div style="font-size: 12px; font-weight: 600; color: #f8fafc; margin-top: 2px;">${card.datetimeStr}</div>
          </div>
          <div style="background: #1e293b; padding: 10px; border-radius: 6px;">
            <div style="color: #94a3b8;">Trạng Thái Lệnh</div>
            <div style="font-size: 12px; font-weight: 700; color: ${card.statusColor}; margin-top: 2px;">${card.statusBadge}</div>
          </div>
        </div>
      `;
    }

    el.tradeDecisionModal.style.display = 'flex';
  }

  function closeTradeDecisionModal() {
    if (el.tradeDecisionModal) el.tradeDecisionModal.style.display = 'none';
  }
"""

    old_modal_end = "    if (el.indicatorSettingsModal) {\n      el.indicatorSettingsModal.addEventListener('click', (e) => {\n        if (e.target === el.indicatorSettingsModal) closeIndicatorSettingsModal();\n      });\n    }"
    new_modal_end = old_modal_end + """

    // Trade Decision Modal Events
    if (el.btnCloseTradeDecisionModal) {
      el.btnCloseTradeDecisionModal.addEventListener('click', closeTradeDecisionModal);
    }
    if (el.btnOkTradeDecisionModal) {
      el.btnOkTradeDecisionModal.addEventListener('click', closeTradeDecisionModal);
    }
    if (el.tradeDecisionModal) {
      el.tradeDecisionModal.addEventListener('click', (e) => {
        if (e.target === el.tradeDecisionModal) closeTradeDecisionModal();
      });
    }

    // Chart Canvas Card Click & Hover Detection
    if (el.chartContainer) {
      el.chartContainer.addEventListener('click', (e) => {
        if (typeof IndicatorRegistry !== 'undefined') {
          const stat2BoxDef = IndicatorRegistry.get('stat2_box_strategy');
          if (stat2BoxDef && typeof stat2BoxDef.findCardAt === 'function' && el.overlayCanvas) {
            const rect = el.overlayCanvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            const clickedCard = stat2BoxDef.findCardAt(mouseX, mouseY);
            if (clickedCard) {
              openTradeDecisionModal(clickedCard);
            }
          }
        }
      });

      el.chartContainer.addEventListener('mousemove', (e) => {
        if (typeof IndicatorRegistry !== 'undefined') {
          const stat2BoxDef = IndicatorRegistry.get('stat2_box_strategy');
          if (stat2BoxDef && typeof stat2BoxDef.findCardAt === 'function' && el.overlayCanvas) {
            const rect = el.overlayCanvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            const hoveredCard = stat2BoxDef.findCardAt(mouseX, mouseY);
            if (hoveredCard) {
              el.chartContainer.style.cursor = 'pointer';
            } else if (typeof DrawToolsEngine !== 'undefined' && DrawToolsEngine.activeTool === 'cursor') {
              el.chartContainer.style.cursor = 'crosshair';
            }
          }
        }
      });
    }"""

    if old_modal_end in content:
        content = content.replace(old_modal_end, new_modal_end)

    # Insert modal_funcs before setupEventListeners
    old_setup = "  // --- 10. UI Interactions & Event Listeners ---"
    if old_setup in content:
        content = content.replace(old_setup, modal_funcs + "\n\n" + old_setup)

    with open(filename, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f'Successfully updated {filename}')

update_file('stat2.js')
update_file('stat1.js')
