/**
 * TradingView-Style Bar Replay Engine for STAT1
 * Ultra-Smooth & High Performance Candle Playback System
 * 
 * Features:
 *  - ✂️ Cut / Jump to any historical bar with live vertical cursor guide
 *  - ▶ / ⏸ Play & Pause with variable speeds (0.1s, 0.25s, 0.5s, 1s, 2s, 3s)
 *  - ⏭ Step Forward & ⏮ Step Backward (1 bar per step)
 *  - Recalculates all active SMC indicators & series on every tick
 *  - Keyboard shortcuts: Spacebar (Play/Pause), Arrow Right (Step), Arrow Left (Back), Esc (Exit)
 */

(function (window) {
  'use strict';

  class ReplayEngine {
    constructor() {
      this.inReplay = false;
      this.isSelectingCut = false;
      this.isPlaying = false;
      this.timer = null;
      this.speedMs = 400; // default 400ms per bar

      this.allCandles = [];
      this.cutoffIndex = 0;

      this.chart = null;
      this.candleSeries = null;
      this.volumeSeries = null;
      this.container = null;
      this.canvas = null;

      this.onReplayUpdate = null;
      this.onExit = null;
      this.scheduleRender = null;

      this.hoverX = null;
      this.hoverTime = null;

      this.toolbarEl = null;
    }

    init(chart, candleSeries, volumeSeries, canvas, container, onReplayUpdate, onExit, scheduleRender) {
      this.chart = chart;
      this.candleSeries = candleSeries;
      this.volumeSeries = volumeSeries;
      this.canvas = canvas;
      this.container = container || canvas.parentElement;
      this.onReplayUpdate = onReplayUpdate;
      this.onExit = onExit;
      this.scheduleRender = scheduleRender || (() => {});

      this.createReplayToolbar();
      this.bindEvents();
    }

    createReplayToolbar() {
      if (document.getElementById('replayToolbar')) return;

      const tb = document.createElement('div');
      tb.id = 'replayToolbar';
      tb.className = 'replay-toolbar';
      tb.style.display = 'none';
      tb.innerHTML = `
        <div class="replay-tb-inner">
          <div class="replay-badge">⏪ REPLAY</div>
          <button id="btnReplayCut" class="replay-btn" title="Jump to bar (Cut chart)">✂️ Cut</button>
          <div class="replay-sep"></div>
          <button id="btnReplayPrev" class="replay-btn" title="Step Back 1 bar (←)">⏮</button>
          <button id="btnReplayPlay" class="replay-btn btn-play" title="Play / Pause (Space)">▶</button>
          <button id="btnReplayNext" class="replay-btn" title="Step Forward 1 bar (→)">⏭</button>
          <div class="replay-sep"></div>
          <select id="selectReplaySpeed" class="replay-select" title="Playback Speed">
            <option value="100">10x (0.1s)</option>
            <option value="250">4x (0.25s)</option>
            <option value="400" selected>2.5x (0.4s)</option>
            <option value="800">1.25x (0.8s)</option>
            <option value="1500">1x (1.5s)</option>
            <option value="3000">0.5x (3.0s)</option>
          </select>
          <div class="replay-progress" id="replayProgressText">--/--</div>
          <div class="replay-sep"></div>
          <button id="btnReplayExit" class="replay-btn btn-exit" title="Exit Replay (Esc)">✕</button>
        </div>
      `;
      this.container.appendChild(tb);
      this.toolbarEl = tb;

      // Event listeners for toolbar buttons
      tb.querySelector('#btnReplayCut').addEventListener('click', () => this.startCutSelection());
      tb.querySelector('#btnReplayPrev').addEventListener('click', () => this.stepBackward());
      tb.querySelector('#btnReplayPlay').addEventListener('click', () => this.togglePlay());
      tb.querySelector('#btnReplayNext').addEventListener('click', () => this.stepForward());
      tb.querySelector('#selectReplaySpeed').addEventListener('change', (e) => this.setSpeed(parseInt(e.target.value, 10)));
      tb.querySelector('#btnReplayExit').addEventListener('click', () => this.exitReplay());
    }

    bindEvents() {
      if (this.container) {
        this.container.addEventListener('mousemove', (e) => {
          if (!this.isSelectingCut || !this.chart) return;
          const rect = this.canvas.getBoundingClientRect();
          this.hoverX = e.clientX - rect.left;
          this.hoverTime = this.chart.timeScale().coordinateToTime(this.hoverX);
          this.scheduleRender();
        });

        this.container.addEventListener('click', (e) => {
          if (!this.isSelectingCut || !this.allCandles || this.allCandles.length === 0) return;
          const rect = this.canvas.getBoundingClientRect();
          const clickX = e.clientX - rect.left;
          const time = this.chart.timeScale().coordinateToTime(clickX);

          let targetIdx = -1;
          if (time) {
            targetIdx = this.allCandles.findIndex(c => c.time >= time);
          }
          if (targetIdx === -1) {
            // Fallback: logical index
            const logical = this.chart.timeScale().coordinateToLogical(clickX);
            if (logical !== null) {
              targetIdx = Math.max(10, Math.min(Math.round(logical), this.allCandles.length - 1));
            }
          }

          if (targetIdx >= 0) {
            e.stopPropagation();
            this.setCutoffIndex(targetIdx);
            this.isSelectingCut = false;
            this.updateToolbarUI();
            this.scheduleRender();
          }
        });
      }

      window.addEventListener('keydown', (e) => {
        if (!this.inReplay) return;
        if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'SELECT' || document.activeElement.tagName === 'TEXTAREA')) {
          return;
        }

        if (e.key === ' ' || e.code === 'Space') {
          e.preventDefault();
          this.togglePlay();
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          this.stepForward();
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          this.stepBackward();
        } else if (e.key === 'Escape') {
          if (this.isSelectingCut) {
            this.isSelectingCut = false;
            this.scheduleRender();
          } else {
            this.exitReplay();
          }
        }
      });
    }

    startReplay(allCandles) {
      if (!allCandles || allCandles.length < 20) return;
      this.allCandles = allCandles;
      this.inReplay = true;
      this.pause();

      if (this.toolbarEl) {
        this.toolbarEl.style.display = 'block';
      }

      // Default: start in Cut Selection mode so user can click where to cut
      this.startCutSelection();
    }

    startCutSelection() {
      this.pause();
      this.isSelectingCut = true;
      if (this.canvas) {
        this.canvas.style.cursor = 'crosshair';
      }
      this.updateToolbarUI();
      this.scheduleRender();
    }

    setCutoffIndex(index) {
      if (!this.allCandles || this.allCandles.length === 0) return;
      this.cutoffIndex = Math.max(10, Math.min(index, this.allCandles.length - 1));

      const visibleSlice = this.allCandles.slice(0, this.cutoffIndex + 1);
      const isLastBar = (this.cutoffIndex >= this.allCandles.length - 1);

      if (this.onReplayUpdate) {
        this.onReplayUpdate(visibleSlice, this.cutoffIndex, isLastBar);
      }

      this.updateToolbarUI();
    }

    togglePlay() {
      if (this.isPlaying) {
        this.pause();
      } else {
        this.play();
      }
    }

    play() {
      if (this.cutoffIndex >= this.allCandles.length - 1) {
        // Rewind to 50 bars back if reached end
        this.cutoffIndex = Math.max(10, this.allCandles.length - 50);
      }

      this.isPlaying = true;
      this.isSelectingCut = false;
      this.updateToolbarUI();

      if (this.timer) clearInterval(this.timer);
      this.timer = setInterval(() => {
        if (this.cutoffIndex < this.allCandles.length - 1) {
          this.cutoffIndex++;
          const visibleSlice = this.allCandles.slice(0, this.cutoffIndex + 1);
          const isLastBar = (this.cutoffIndex >= this.allCandles.length - 1);
          if (this.onReplayUpdate) {
            this.onReplayUpdate(visibleSlice, this.cutoffIndex, isLastBar);
          }
          this.updateToolbarUI();
          if (isLastBar) {
            this.pause();
          }
        } else {
          this.pause();
        }
      }, this.speedMs);
    }

    pause() {
      this.isPlaying = false;
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
      this.updateToolbarUI();
    }

    stepForward() {
      this.pause();
      if (this.cutoffIndex < this.allCandles.length - 1) {
        this.setCutoffIndex(this.cutoffIndex + 1);
      }
    }

    stepBackward() {
      this.pause();
      if (this.cutoffIndex > 10) {
        this.setCutoffIndex(this.cutoffIndex - 1);
      }
    }

    setSpeed(speedMs) {
      this.speedMs = speedMs;
      if (this.isPlaying) {
        this.pause();
        this.play();
      }
    }

    exitReplay() {
      this.pause();
      this.inReplay = false;
      this.isSelectingCut = false;
      if (this.toolbarEl) {
        this.toolbarEl.style.display = 'none';
      }
      if (this.canvas) {
        this.canvas.style.cursor = 'default';
      }
      if (this.onExit) {
        this.onExit();
      }
      this.scheduleRender();
    }

    updateToolbarUI() {
      if (!this.toolbarEl) return;
      const playBtn = this.toolbarEl.querySelector('#btnReplayPlay');
      const cutBtn = this.toolbarEl.querySelector('#btnReplayCut');
      const progText = this.toolbarEl.querySelector('#replayProgressText');

      if (playBtn) {
        playBtn.textContent = this.isPlaying ? '⏸' : '▶';
        playBtn.title = this.isPlaying ? 'Pause (Space)' : 'Play (Space)';
        playBtn.classList.toggle('playing', this.isPlaying);
      }

      if (cutBtn) {
        cutBtn.classList.toggle('active', this.isSelectingCut);
      }

      if (progText && this.allCandles) {
        progText.textContent = `Bar ${this.cutoffIndex + 1}/${this.allCandles.length}`;
      }
    }

    // Render scissors cut guide when selecting historical cut point
    render(ctx, helpers) {
      if (!this.isSelectingCut || this.hoverX === null) return;
      const h = ctx.canvas.clientHeight;

      ctx.save();
      ctx.strokeStyle = '#f43f5e';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);

      // Vertical Cut Guide
      ctx.beginPath();
      ctx.moveTo(this.hoverX, 0);
      ctx.lineTo(this.hoverX, h);
      ctx.stroke();
      ctx.setLineDash([]);

      // Floating Scissors Badge
      const badgeY = Math.min(180, h - 80);
      const text = '✂️ Click to Cut Here';
      ctx.font = 'bold 11px "JetBrains Mono", monospace';
      const textW = ctx.measureText(text).width + 16;
      const badgeX = Math.max(10, Math.min(this.hoverX - textW / 2, ctx.canvas.clientWidth - textW - 10));

      ctx.fillStyle = 'rgba(244, 63, 94, 0.95)';
      ctx.shadowColor = '#f43f5e';
      ctx.shadowBlur = 10;
      if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(badgeX, badgeY, textW, 24, 6);
        ctx.fill();
      } else {
        ctx.fillRect(badgeX, badgeY, textW, 24);
      }

      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, badgeX + textW / 2, badgeY + 12);

      ctx.restore();
    }
  }

  window.ReplayEngine = new ReplayEngine();

})(typeof window !== 'undefined' ? window : this);
