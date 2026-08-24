/**
 * TradingView-Style Drawing Tools Engine for STAT1
 * Ultra-Smooth & High Performance Drawing System
 * Supports:
 *  - Trendline (Line Tool)
 *  - Rectangle (Box / Supply-Demand Zone)
 *  - Long Position (Entry, TP, SL, R:R calculation, % Profit/Loss, PnL amounts)
 *  - Short Position (Entry, TP, SL, R:R calculation, % Profit/Loss, PnL amounts)
 *  - Interactive live preview, 12px easy-grab handles, moving, resizing,
 *  - Floating Context Toolbar for instant color changing & deleting
 *  - IndexedDB Persistence per symbol
 */

(function (window) {
  'use strict';

  class DrawToolsEngine {
    constructor() {
      this.activeTool = 'cursor'; // 'cursor' | 'trendline' | 'rectangle' | 'long_position' | 'short_position'
      this.drawings = [];
      this.selectedDrawingId = null;
      this.hoverDrawingId = null;
      this.hoverHandle = null;
      this.dragState = null;      // { drawingId, handle, startCoords, origDrawing }
      this.pendingDrawing = null; // Drawing currently being created
      this.chart = null;
      this.candleSeries = null;
      this.canvas = null;
      this.container = null;
      this.ctx = null;
      this.candles = [];
      this.onDrawingsChanged = null;
      this.onToolChanged = null;
      this.requestRender = null;
      this.floatingToolbarEl = null;
    }

    init(chart, candleSeries, canvas, container, onDrawingsChanged, onToolChanged, requestRender) {
      this.chart = chart;
      this.candleSeries = candleSeries;
      this.canvas = canvas;
      this.container = container || canvas.parentElement;
      this.ctx = canvas.getContext('2d');
      this.onDrawingsChanged = onDrawingsChanged;
      this.onToolChanged = onToolChanged;
      this.requestRender = requestRender || (() => {});

      this.createFloatingToolbar();
      this.bindEvents();
      this.updatePointerEvents();
    }

    setCandles(candles) {
      this.candles = Array.isArray(candles) ? candles : [];
    }

    createFloatingToolbar() {
      if (document.getElementById('drawContextToolbar')) return;

      const tb = document.createElement('div');
      tb.id = 'drawContextToolbar';
      tb.className = 'draw-context-toolbar';
      tb.style.display = 'none';
      tb.innerHTML = `
        <div class="ctx-tb-inner">
          <input type="color" id="ctxDrawColor" class="ctx-color-input" title="Change Color" value="#38bdf8">
          <button id="ctxDrawDelete" class="ctx-btn" title="Delete Drawing (Del)">🗑️</button>
          <button id="ctxDrawClose" class="ctx-btn" title="Deselect">✕</button>
        </div>
      `;
      this.container.appendChild(tb);
      this.floatingToolbarEl = tb;

      // Attach floating toolbar events
      const colorInput = tb.querySelector('#ctxDrawColor');
      const deleteBtn = tb.querySelector('#ctxDrawDelete');
      const closeBtn = tb.querySelector('#ctxDrawClose');

      colorInput.addEventListener('input', (e) => {
        if (!this.selectedDrawingId) return;
        const d = this.drawings.find(item => item.id === this.selectedDrawingId);
        if (!d) return;
        const color = e.target.value;
        if (d.type === 'trendline') {
          d.color = color;
        } else if (d.type === 'rectangle') {
          d.borderColor = color;
          d.fillColor = this.hexToRgba(color, 0.18);
        } else if (d.type === 'long_position' || d.type === 'short_position') {
          d.lineColor = color;
        }
        this.triggerChanged();
        this.requestRender();
      });

      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.deleteSelected();
      });

      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectedDrawingId = null;
        this.updateFloatingToolbar();
        this.updatePointerEvents();
        this.requestRender();
      });
    }

    hexToRgba(hex, alpha) {
      let c = hex.replace('#', '');
      if (c.length === 3) c = c.split('').map(x => x + x).join('');
      const num = parseInt(c, 16);
      return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`;
    }

    updateFloatingToolbar() {
      if (!this.floatingToolbarEl) return;
      if (!this.selectedDrawingId) {
        this.floatingToolbarEl.style.display = 'none';
        return;
      }
      const d = this.drawings.find(item => item.id === this.selectedDrawingId);
      if (!d || !this.chart || !this.candleSeries) {
        this.floatingToolbarEl.style.display = 'none';
        return;
      }

      const timeScale = this.chart.timeScale();
      let x = 0, y = 0;

      if (d.type === 'trendline' || d.type === 'rectangle') {
        const x1 = this.timeToX(d.p1.time);
        const y1 = this.candleSeries.priceToCoordinate(d.p1.price);
        const x2 = this.timeToX(d.p2.time);
        const y2 = this.candleSeries.priceToCoordinate(d.p2.price);
        if (x1 === null || y1 === null || x2 === null || y2 === null) {
          this.floatingToolbarEl.style.display = 'none';
          return;
        }
        x = (x1 + x2) / 2;
        y = Math.min(y1, y2) - 36;
      } else if (d.type === 'long_position' || d.type === 'short_position') {
        const x1 = this.timeToX(d.entryTime);
        const x2 = this.timeToX(d.endTime) || (x1 + 160);
        const yTp = this.candleSeries.priceToCoordinate(d.tpPrice);
        const ySl = this.candleSeries.priceToCoordinate(d.slPrice);
        if (x1 === null || yTp === null || ySl === null) {
          this.floatingToolbarEl.style.display = 'none';
          return;
        }
        x = (x1 + x2) / 2;
        y = Math.min(yTp, ySl) - 36;
      }

      const colorInput = this.floatingToolbarEl.querySelector('#ctxDrawColor');
      if (colorInput) {
        colorInput.value = d.color || d.borderColor || d.lineColor || '#38bdf8';
      }

      this.floatingToolbarEl.style.display = 'block';
      this.floatingToolbarEl.style.left = `${Math.max(60, Math.min(x - 50, this.container.clientWidth - 140))}px`;
      this.floatingToolbarEl.style.top = `${Math.max(10, y)}px`;
    }

    setTool(tool) {
      this.activeTool = tool;
      this.pendingDrawing = null;
      this.dragState = null;
      if (tool !== 'cursor') {
        this.selectedDrawingId = null;
      }
      if (this.onToolChanged) this.onToolChanged(tool);
      this.updatePointerEvents();
      this.updateCursor();
      this.updateFloatingToolbar();
      this.requestRender();
    }

    updatePointerEvents() {
      if (!this.canvas) return;
      if (this.activeTool && this.activeTool !== 'cursor') {
        this.canvas.style.pointerEvents = 'auto';
      } else if (this.selectedDrawingId || this.hoverDrawingId || this.dragState) {
        this.canvas.style.pointerEvents = 'auto';
      } else {
        this.canvas.style.pointerEvents = 'none';
      }
    }

    setDrawings(drawings) {
      this.drawings = Array.isArray(drawings) ? drawings : [];
      this.selectedDrawingId = null;
      this.pendingDrawing = null;
      this.updatePointerEvents();
      this.updateFloatingToolbar();
      this.requestRender();
    }

    getDrawings() {
      return this.drawings;
    }

    clearAll() {
      this.drawings = [];
      this.selectedDrawingId = null;
      this.pendingDrawing = null;
      this.updatePointerEvents();
      this.updateFloatingToolbar();
      this.triggerChanged();
      this.requestRender();
    }

    deleteSelected() {
      if (!this.selectedDrawingId) return;
      this.drawings = this.drawings.filter(d => d.id !== this.selectedDrawingId);
      this.selectedDrawingId = null;
      this.updatePointerEvents();
      this.updateFloatingToolbar();
      this.triggerChanged();
      this.requestRender();
    }

    triggerChanged() {
      if (this.onDrawingsChanged) {
        this.onDrawingsChanged(this.drawings);
      }
    }

    updateCursor() {
      if (!this.canvas) return;
      if (this.activeTool && this.activeTool !== 'cursor') {
        this.canvas.style.cursor = 'crosshair';
      } else if (this.hoverHandle) {
        if (this.hoverHandle === 'tp' || this.hoverHandle === 'sl') {
          this.canvas.style.cursor = 'ns-resize';
        } else if (this.hoverHandle === 'endTime' || this.hoverHandle === 'entry') {
          this.canvas.style.cursor = 'ew-resize';
        } else {
          this.canvas.style.cursor = 'grab';
        }
      } else if (this.hoverDrawingId) {
        this.canvas.style.cursor = 'pointer';
      } else {
        this.canvas.style.cursor = 'default';
      }
    }

    // High reliability time to X coordinate conversion (handles future and unindexed timestamps)
    timeToX(time, fallbackOffsetBars = 0) {
      if (time === null || time === undefined || !this.chart) return null;
      const timeScale = this.chart.timeScale();

      // 1. Direct coordinate lookup
      const directX = timeScale.timeToCoordinate(time);
      if (directX !== null && !isNaN(directX)) return directX;

      // 2. Fallback calculation using candles array
      if (this.candles && this.candles.length > 0) {
        const lastCandle = this.candles[this.candles.length - 1];
        const lastX = timeScale.timeToCoordinate(lastCandle.time);
        if (lastX !== null) {
          const firstX = timeScale.timeToCoordinate(this.candles[0].time);
          const barSpacing = (firstX !== null && this.candles.length > 1)
            ? Math.abs(lastX - firstX) / (this.candles.length - 1)
            : 8;
          
          const intervalSec = (this.candles.length > 1) ? (this.candles[1].time - this.candles[0].time) : 900;
          const timeDiff = time - lastCandle.time;
          const offsetBars = (intervalSec > 0) ? (timeDiff / intervalSec) : fallbackOffsetBars;
          return lastX + (offsetBars * barSpacing);
        }
      }
      return null;
    }

    // Convert mouse event to chart coordinates (time, price)
    getEventCoords(e) {
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (!this.chart || !this.candleSeries) return { x, y, time: null, price: null };

      const timeScale = this.chart.timeScale();
      let time = timeScale.coordinateToTime(x);

      // If time is null (clicked slightly off-candle or on right edge), get nearest candle time
      if (!time && this.candles && this.candles.length > 0) {
        const logical = timeScale.coordinateToLogical(x);
        if (logical !== null) {
          const idx = Math.max(0, Math.min(Math.round(logical), this.candles.length - 1));
          if (this.candles[idx]) {
            time = this.candles[idx].time;
          }
        }
        if (!time) {
          time = this.candles[this.candles.length - 1].time;
        }
      }

      const price = this.candleSeries.coordinateToPrice(y);
      return { x, y, time, price };
    }

    bindEvents() {
      if (!this.canvas) return;

      // 1. Container mousemove for seamless hover detection even when canvas is pointer-events: none
      if (this.container) {
        this.container.addEventListener('mousemove', (e) => {
          if (this.dragState || (this.activeTool && this.activeTool !== 'cursor')) return;

          const coords = this.getEventCoords(e);
          const hit = this.hitTest(coords.x, coords.y);
          const newHover = hit ? hit.drawingId : null;
          const newHandle = hit ? hit.handle : null;

          if (newHover !== this.hoverDrawingId || newHandle !== this.hoverHandle) {
            this.hoverDrawingId = newHover;
            this.hoverHandle = newHandle;
            this.updatePointerEvents();
            this.updateCursor();
          }
        });
      }

      // 2. Canvas mouse events
      this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
      window.addEventListener('mousemove', (e) => this.handleMouseMove(e));
      window.addEventListener('mouseup', (e) => this.handleMouseUp(e));
      window.addEventListener('keydown', (e) => this.handleKeyDown(e));
    }

    handleMouseDown(e) {
      if (e.button !== 0) return; // Only left-click
      const coords = this.getEventCoords(e);
      if (!coords.time || coords.price === null) return;

      // --- Mode A: Creating new drawing ---
      if (this.activeTool && this.activeTool !== 'cursor') {
        e.stopPropagation();
        e.preventDefault();

        const id = 'draw_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);

        if (this.activeTool === 'trendline') {
          if (!this.pendingDrawing) {
            this.pendingDrawing = {
              id,
              type: 'trendline',
              p1: { time: coords.time, price: coords.price },
              p2: { time: coords.time, price: coords.price },
              color: '#38bdf8',
              width: 2,
              style: 'solid'
            };
            this.requestRender();
          } else {
            // Finish trendline
            this.pendingDrawing.p2 = { time: coords.time, price: coords.price };
            this.drawings.push(this.pendingDrawing);
            this.selectedDrawingId = this.pendingDrawing.id;
            this.pendingDrawing = null;
            this.setTool('cursor');
            this.triggerChanged();
            this.requestRender();
          }
          return;
        }

        if (this.activeTool === 'rectangle') {
          if (!this.pendingDrawing) {
            this.pendingDrawing = {
              id,
              type: 'rectangle',
              p1: { time: coords.time, price: coords.price },
              p2: { time: coords.time, price: coords.price },
              fillColor: 'rgba(56, 189, 248, 0.18)',
              borderColor: '#38bdf8',
              borderWidth: 1.5
            };
            this.requestRender();
          } else {
            // Finish rectangle
            this.pendingDrawing.p2 = { time: coords.time, price: coords.price };
            this.drawings.push(this.pendingDrawing);
            this.selectedDrawingId = this.pendingDrawing.id;
            this.pendingDrawing = null;
            this.setTool('cursor');
            this.triggerChanged();
            this.requestRender();
          }
          return;
        }

        if (this.activeTool === 'long_position' || this.activeTool === 'short_position') {
          const isLong = this.activeTool === 'long_position';
          const entryPrice = coords.price;
          // Default 2% TP, 1% SL
          const tpPrice = isLong ? (entryPrice * 1.02) : (entryPrice * 0.98);
          const slPrice = isLong ? (entryPrice * 0.99) : (entryPrice * 1.01);

          // Calculate endTime approx 25 bars ahead
          const tfSec = (this.candles && this.candles.length > 1) ? (this.candles[1].time - this.candles[0].time) : 900;
          const endTime = coords.time + (25 * tfSec);

          const newPos = {
            id,
            type: this.activeTool,
            entryTime: coords.time,
            endTime: endTime,
            entryPrice: entryPrice,
            tpPrice: tpPrice,
            slPrice: slPrice,
            tpColor: 'rgba(16, 185, 129, 0.22)',
            slColor: 'rgba(244, 63, 94, 0.22)',
            lineColor: isLong ? '#38bdf8' : '#f59e0b'
          };

          this.drawings.push(newPos);
          this.selectedDrawingId = id;
          this.setTool('cursor');
          this.triggerChanged();
          this.requestRender();
          return;
        }
      }

      // --- Mode B: Cursor Mode (Selection & Dragging) ---
      const hit = this.hitTest(coords.x, coords.y);
      if (hit) {
        e.stopPropagation();
        e.preventDefault();
        this.selectedDrawingId = hit.drawingId;
        this.dragState = {
          drawingId: hit.drawingId,
          handle: hit.handle,
          startX: coords.x,
          startY: coords.y,
          startTime: coords.time,
          startPrice: coords.price,
          origDrawing: JSON.parse(JSON.stringify(this.drawings.find(d => d.id === hit.drawingId)))
        };
        this.updateFloatingToolbar();
        this.updatePointerEvents();
        this.updateCursor();
        this.requestRender();
      } else {
        // Clicked outside: deselect
        if (this.selectedDrawingId) {
          this.selectedDrawingId = null;
          this.updateFloatingToolbar();
          this.updatePointerEvents();
          this.updateCursor();
          this.requestRender();
        }
      }
    }

    handleMouseMove(e) {
      const coords = this.getEventCoords(e);

      // 1. Updating live preview of pending drawing
      if (this.pendingDrawing) {
        if (coords.time && coords.price !== null) {
          this.pendingDrawing.p2 = { time: coords.time, price: coords.price };
          this.requestRender();
        }
        return;
      }

      // 2. Dragging a drawing or its handles
      if (this.dragState && coords.time && coords.price !== null) {
        const drawing = this.drawings.find(d => d.id === this.dragState.drawingId);
        if (!drawing) return;
        const orig = this.dragState.origDrawing;
        const handle = this.dragState.handle;

        if (drawing.type === 'trendline' || drawing.type === 'rectangle') {
          if (handle === 'p1') {
            drawing.p1 = { time: coords.time, price: coords.price };
          } else if (handle === 'p2') {
            drawing.p2 = { time: coords.time, price: coords.price };
          } else if (handle === 'body') {
            const timeDiff = coords.time - this.dragState.startTime;
            const priceDiff = coords.price - this.dragState.startPrice;
            drawing.p1 = { time: orig.p1.time + timeDiff, price: orig.p1.price + priceDiff };
            drawing.p2 = { time: orig.p2.time + timeDiff, price: orig.p2.price + priceDiff };
          }
        } else if (drawing.type === 'long_position' || drawing.type === 'short_position') {
          if (handle === 'tp') {
            drawing.tpPrice = coords.price;
          } else if (handle === 'sl') {
            drawing.slPrice = coords.price;
          } else if (handle === 'entry') {
            const delta = coords.price - orig.entryPrice;
            drawing.entryPrice = coords.price;
            drawing.tpPrice = orig.tpPrice + delta;
            drawing.slPrice = orig.slPrice + delta;
          } else if (handle === 'endTime') {
            drawing.endTime = Math.max(coords.time, drawing.entryTime + 60);
          } else if (handle === 'body') {
            const timeDiff = coords.time - this.dragState.startTime;
            const priceDiff = coords.price - this.dragState.startPrice;
            drawing.entryTime = orig.entryTime + timeDiff;
            drawing.endTime = orig.endTime + timeDiff;
            drawing.entryPrice = orig.entryPrice + priceDiff;
            drawing.tpPrice = orig.tpPrice + priceDiff;
            drawing.slPrice = orig.slPrice + priceDiff;
          }
        }

        this.updateFloatingToolbar();
        this.requestRender();
        return;
      }

      // 3. Hovering update
      if (!this.activeTool || this.activeTool === 'cursor') {
        const hit = this.hitTest(coords.x, coords.y);
        this.hoverDrawingId = hit ? hit.drawingId : null;
        this.hoverHandle = hit ? hit.handle : null;
        this.updatePointerEvents();
        this.updateCursor();
      }
    }

    handleMouseUp(e) {
      if (this.dragState) {
        this.dragState = null;
        this.triggerChanged();
        this.updateFloatingToolbar();
        this.updatePointerEvents();
        this.updateCursor();
        this.requestRender();
      }
    }

    handleKeyDown(e) {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA' || document.activeElement.tagName === 'SELECT')) {
          return;
        }
        if (this.selectedDrawingId) {
          this.deleteSelected();
        }
      } else if (e.key === 'Escape') {
        if (this.pendingDrawing) {
          this.pendingDrawing = null;
          this.setTool('cursor');
        } else if (this.selectedDrawingId) {
          this.selectedDrawingId = null;
          this.updateFloatingToolbar();
          this.updatePointerEvents();
          this.requestRender();
        }
      }
    }

    // High precision Hit-Test for handles and shape bodies
    hitTest(x, y) {
      if (!this.chart || !this.candleSeries) return null;
      const getY = (p) => this.candleSeries.priceToCoordinate(p);

      const HANDLE_RADIUS = 12; // Generous 12px hit radius for easy clicking!

      for (let i = this.drawings.length - 1; i >= 0; i--) {
        const d = this.drawings[i];

        if (d.type === 'trendline') {
          const x1 = this.timeToX(d.p1.time);
          const y1 = getY(d.p1.price);
          const x2 = this.timeToX(d.p2.time);
          const y2 = getY(d.p2.price);
          if (x1 === null || y1 === null || x2 === null || y2 === null) continue;

          // Check handles
          if (Math.hypot(x - x1, y - y1) <= HANDLE_RADIUS) return { drawingId: d.id, handle: 'p1' };
          if (Math.hypot(x - x2, y - y2) <= HANDLE_RADIUS) return { drawingId: d.id, handle: 'p2' };

          // Line distance
          if (distToSegment(x, y, x1, y1, x2, y2) <= 8) return { drawingId: d.id, handle: 'body' };
        } else if (d.type === 'rectangle') {
          const x1 = this.timeToX(d.p1.time);
          const y1 = getY(d.p1.price);
          const x2 = this.timeToX(d.p2.time);
          const y2 = getY(d.p2.price);
          if (x1 === null || y1 === null || x2 === null || y2 === null) continue;

          // Check 4 corner handles
          if (Math.hypot(x - x1, y - y1) <= HANDLE_RADIUS) return { drawingId: d.id, handle: 'p1' };
          if (Math.hypot(x - x2, y - y2) <= HANDLE_RADIUS) return { drawingId: d.id, handle: 'p2' };
          if (Math.hypot(x - x1, y - y2) <= HANDLE_RADIUS) return { drawingId: d.id, handle: 'p1_y2' };
          if (Math.hypot(x - x2, y - y1) <= HANDLE_RADIUS) return { drawingId: d.id, handle: 'p2_y1' };

          const minX = Math.min(x1, x2);
          const maxX = Math.max(x1, x2);
          const minY = Math.min(y1, y2);
          const maxY = Math.max(y1, y2);
          if (x >= minX - 4 && x <= maxX + 4 && y >= minY - 4 && y <= maxY + 4) {
            return { drawingId: d.id, handle: 'body' };
          }
        } else if (d.type === 'long_position' || d.type === 'short_position') {
          const xEntry = this.timeToX(d.entryTime);
          const xEnd = this.timeToX(d.endTime) || (xEntry !== null ? xEntry + 160 : null);
          const yEntry = getY(d.entryPrice);
          const yTp = getY(d.tpPrice);
          const ySl = getY(d.slPrice);
          if (xEntry === null || xEnd === null || yEntry === null || yTp === null || ySl === null) continue;

          const startX = Math.min(xEntry, xEnd);
          const endX = Math.max(xEntry, xEnd);
          const midX = (startX + endX) / 2;
          const topY = Math.min(yTp, ySl, yEntry);
          const bottomY = Math.max(yTp, ySl, yEntry);

          // Handles: TP line top, SL line bottom, Entry line left, Right edge
          if (Math.hypot(x - midX, y - yTp) <= HANDLE_RADIUS) return { drawingId: d.id, handle: 'tp' };
          if (Math.hypot(x - midX, y - ySl) <= HANDLE_RADIUS) return { drawingId: d.id, handle: 'sl' };
          if (Math.hypot(x - startX, y - yEntry) <= HANDLE_RADIUS) return { drawingId: d.id, handle: 'entry' };
          if (Math.hypot(x - endX, y - yEntry) <= HANDLE_RADIUS) return { drawingId: d.id, handle: 'endTime' };

          if (x >= startX - 4 && x <= endX + 4 && y >= topY - 4 && y <= bottomY + 4) {
            return { drawingId: d.id, handle: 'body' };
          }
        }
      }
      return null;
    }

    // Render all drawings onto overlay canvas
    render(ctx, helpers) {
      const { getY, formatPrice } = helpers;

      const allToRender = [...this.drawings];
      if (this.pendingDrawing) {
        allToRender.push(this.pendingDrawing);
      }

      for (const d of allToRender) {
        const isSelected = d.id === this.selectedDrawingId;
        const isHover = d.id === this.hoverDrawingId;

        if (d.type === 'trendline') {
          this.renderTrendline(ctx, d, getY, isSelected, isHover);
        } else if (d.type === 'rectangle') {
          this.renderRectangle(ctx, d, getY, isSelected, isHover);
        } else if (d.type === 'long_position' || d.type === 'short_position') {
          this.renderPositionTool(ctx, d, getY, isSelected, isHover, formatPrice);
        }
      }

      // Keep floating toolbar synced with current viewport coordinates
      if (this.selectedDrawingId) {
        this.updateFloatingToolbar();
      }
    }

    renderTrendline(ctx, d, getY, isSelected, isHover) {
      const x1 = this.timeToX(d.p1.time);
      const y1 = getY(d.p1.price);
      const x2 = this.timeToX(d.p2.time);
      const y2 = getY(d.p2.price);
      if (x1 === null || y1 === null || x2 === null || y2 === null) return;

      ctx.save();
      ctx.strokeStyle = d.color || '#38bdf8';
      ctx.lineWidth = isSelected ? (d.width || 2) + 1 : (isHover ? (d.width || 2) + 0.5 : (d.width || 2));
      if (d.style === 'dashed') ctx.setLineDash([6, 4]);

      // Glow effect if selected or hovering
      if (isSelected || isHover) {
        ctx.shadowColor = d.color || '#38bdf8';
        ctx.shadowBlur = isSelected ? 8 : 4;
      }

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      ctx.shadowBlur = 0;

      // Handles if selected
      if (isSelected) {
        this.renderHandle(ctx, x1, y1);
        this.renderHandle(ctx, x2, y2);
      }
      ctx.restore();
    }

    renderRectangle(ctx, d, getY, isSelected, isHover) {
      const x1 = this.timeToX(d.p1.time);
      const y1 = getY(d.p1.price);
      const x2 = this.timeToX(d.p2.time);
      const y2 = getY(d.p2.price);
      if (x1 === null || y1 === null || x2 === null || y2 === null) return;

      const minX = Math.min(x1, x2);
      const maxX = Math.max(x1, x2);
      const minY = Math.min(y1, y2);
      const maxY = Math.max(y1, y2);
      const w = Math.max(maxX - minX, 2);
      const h = Math.max(maxY - minY, 2);

      ctx.save();
      ctx.fillStyle = d.fillColor || 'rgba(56, 189, 248, 0.18)';
      ctx.fillRect(minX, minY, w, h);

      ctx.strokeStyle = d.borderColor || '#38bdf8';
      ctx.lineWidth = isSelected ? (d.borderWidth || 1.5) + 1 : (d.borderWidth || 1.5);
      if (isSelected || isHover) {
        ctx.shadowColor = d.borderColor || '#38bdf8';
        ctx.shadowBlur = 6;
      }
      ctx.strokeRect(minX, minY, w, h);
      ctx.shadowBlur = 0;

      if (isSelected) {
        this.renderHandle(ctx, minX, minY);
        this.renderHandle(ctx, maxX, minY);
        this.renderHandle(ctx, minX, maxY);
        this.renderHandle(ctx, maxX, maxY);
      }
      ctx.restore();
    }

    renderPositionTool(ctx, d, getY, isSelected, isHover, formatPrice) {
      const x1 = this.timeToX(d.entryTime);
      const x2 = this.timeToX(d.endTime) || (x1 !== null ? x1 + 160 : null);
      const yEntry = getY(d.entryPrice);
      const yTp = getY(d.tpPrice);
      const ySl = getY(d.slPrice);

      if (x1 === null || x2 === null || yEntry === null || yTp === null || ySl === null) return;

      const startX = Math.min(x1, x2);
      const endX = Math.max(x1, x2);
      const w = Math.max(endX - startX, 20);
      const midX = (startX + endX) / 2;

      const isLong = d.type === 'long_position';

      const entryPrice = d.entryPrice;
      const tpPrice = d.tpPrice;
      const slPrice = d.slPrice;

      const profitPercent = Math.abs((tpPrice - entryPrice) / entryPrice * 100);
      const lossPercent = Math.abs((slPrice - entryPrice) / entryPrice * 100);
      const riskReward = (lossPercent > 0) ? (profitPercent / lossPercent).toFixed(2) : '∞';

      ctx.save();

      // 1. Take Profit (Green Box)
      const tpTop = Math.min(yEntry, yTp);
      const tpH = Math.max(Math.abs(yTp - yEntry), 2);
      ctx.fillStyle = d.tpColor || 'rgba(16, 185, 129, 0.22)';
      ctx.fillRect(startX, tpTop, w, tpH);
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 1.4;
      ctx.strokeRect(startX, tpTop, w, tpH);

      // 2. Stop Loss (Red Box)
      const slTop = Math.min(yEntry, ySl);
      const slH = Math.max(Math.abs(ySl - yEntry), 2);
      ctx.fillStyle = d.slColor || 'rgba(244, 63, 94, 0.22)';
      ctx.fillRect(startX, slTop, w, slH);
      ctx.strokeStyle = '#f43f5e';
      ctx.lineWidth = 1.4;
      ctx.strokeRect(startX, slTop, w, slH);

      // 3. Entry Centerline
      ctx.beginPath();
      ctx.strokeStyle = d.lineColor || '#e2e8f0';
      ctx.lineWidth = 1.8;
      ctx.setLineDash([4, 3]);
      ctx.moveTo(startX, yEntry);
      ctx.lineTo(endX, yEntry);
      ctx.stroke();
      ctx.setLineDash([]);

      // 4. Metric Labels
      const tagX = startX + 8;
      ctx.font = 'bold 10px "JetBrains Mono", monospace';

      // TP Label
      ctx.fillStyle = '#34d399';
      ctx.fillText(`Target: +${profitPercent.toFixed(2)}% | TP: ${formatPrice(tpPrice)}`, tagX, tpTop + 14);

      // SL Label
      ctx.fillStyle = '#fb7185';
      ctx.fillText(`Stop: -${lossPercent.toFixed(2)}% | SL: ${formatPrice(slPrice)}`, tagX, slTop + slH - 6);

      // Center R:R Badge
      const rrText = `${isLong ? 'LONG' : 'SHORT'} R:R ${riskReward}`;
      const rrW = ctx.measureText(rrText).width + 12;
      const rrH = 18;
      const rrX = endX - rrW - 6;
      const rrY = yEntry - rrH / 2;

      ctx.fillStyle = isLong ? '#0284c7' : '#d97706';
      if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(rrX, rrY, rrW, rrH, 4);
        ctx.fill();
      } else {
        ctx.fillRect(rrX, rrY, rrW, rrH);
      }
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(rrText, rrX + rrW / 2, rrY + rrH / 2);

      // Handles if selected
      if (isSelected) {
        this.renderHandle(ctx, midX, yTp, '#10b981');
        this.renderHandle(ctx, midX, ySl, '#f43f5e');
        this.renderHandle(ctx, startX, yEntry, '#38bdf8');
        this.renderHandle(ctx, endX, yEntry, '#38bdf8');
      }

      ctx.restore();
    }

    renderHandle(ctx, x, y, color = '#38bdf8') {
      ctx.save();
      ctx.fillStyle = color;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.shadowColor = color;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  // Distance from point (px, py) to line segment (x1, y1)-(x2, y2)
  function distToSegment(px, py, x1, y1, x2, y2) {
    const l2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
    if (l2 === 0) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
  }

  window.DrawToolsEngine = new DrawToolsEngine();

})(typeof window !== 'undefined' ? window : this);
