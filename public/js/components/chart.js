/* ========================================
   CHART - Professional Trading Chart
   Trading Platform PRO v2.0
   ======================================== */

const Chart = {

    canvas: null,
    ctx: null,

    // ==========================================
    //  VIEWPORT & ZOOM
    // ==========================================
    _visibleCount: 80,
    _offset: 0,
    _minVisible: 15,
    _maxVisible: 250,
    _isDragging: false,
    _dragStartX: 0,
    _dragStartOffset: 0,
    _pinchStartDist: 0,
    _pinchStartCount: 0,

    // ==========================================
    //  CROSSHAIR
    // ==========================================
    _mouseX: -1,
    _mouseY: -1,
    _showCrosshair: false,

    // ==========================================
    //  INDICATORS TOGGLE
    // ==========================================
    _indicators: {
        ema9: true,
        ema21: true,
        ema50: false,
        bb: true,
        volume: true,
        rsiPanel: true,
        macdPanel: false,
        positions: true,
        tpsl: true,
        vwap: false,
    },

    // ==========================================
    //  STATE
    // ==========================================
    _layout: null,
    _animFrame: null,
    _isFullscreen: false,
    _logScale: false,

    // ==========================================
    //  INIT
    // ==========================================

    init() {
        this.canvas = document.getElementById('chart');
        if (!this.canvas) return;

        this.ctx = this.canvas.getContext('2d');
        this._resize();
        this._buildToolbar();

        // Desktop events
        window.addEventListener('resize', () => this._resize());
        this.canvas.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
        this.canvas.addEventListener('mousemove', (e) => this._onMouseMove(e));
        this.canvas.addEventListener('mouseleave', () => this._onMouseLeave());
        this.canvas.addEventListener('mousedown', (e) => this._onDragStart(e));
        window.addEventListener('mouseup', () => this._onDragEnd());
        window.addEventListener('mousemove', (e) => { if (this._isDragging) this._onDrag(e); });

        // Mobile touch events
        this.canvas.addEventListener('touchstart', (e) => this._onTouchStart(e), { passive: false });
        this.canvas.addEventListener('touchmove', (e) => this._onTouchMove(e), { passive: false });
        this.canvas.addEventListener('touchend', () => this._onTouchEnd());

        // Fullscreen change
        document.addEventListener('fullscreenchange', () => {
            this._isFullscreen = !!document.fullscreenElement;
            setTimeout(() => this._resize(), 100);
        });

        this.subscribeToState();
    },

    subscribeToState() {
        State.subscribe('candles', () => this.draw());
        State.subscribe('prices', () => this.draw());
        State.subscribe('analysis', () => this.draw());
        State.subscribe('positions', () => this.draw());
    },

    // ==========================================
    //  TOOLBAR
    // ==========================================

    _buildToolbar() {
        const container = this.canvas?.parentElement;
        if (!container) return;

        if (container.querySelector('.chart-toolbar')) return;

        const toolbar = document.createElement('div');
        toolbar.className = 'chart-toolbar';
        toolbar.style.cssText = `
            position: absolute; top: 4px; left: 8px; right: 8px; z-index: 10;
            display: flex; gap: 4px; flex-wrap: wrap; align-items: center;
            pointer-events: none;
        `;

        const indicators = [
            { key: 'ema9', label: 'EMA9', color: CONFIG.CHART.COLORS.ema9 },
            { key: 'ema21', label: 'EMA21', color: CONFIG.CHART.COLORS.ema21 },
            { key: 'ema50', label: 'EMA50', color: CONFIG.CHART.COLORS.ema50 },
            { key: 'bb', label: 'BB', color: 'rgba(0,212,255,0.6)' },
            { key: 'vwap', label: 'VWAP', color: '#ff6b9d' },
            { key: 'volume', label: 'VOL', color: 'rgba(255,255,255,0.5)' },
            { key: 'rsiPanel', label: 'RSI', color: '#eab308' },
            { key: 'macdPanel', label: 'MACD', color: '#22c55e' },
        ];

        indicators.forEach(ind => {
            const btn = document.createElement('button');
            btn.style.cssText = `
                pointer-events: auto; cursor: pointer;
                padding: 2px 7px; border-radius: 4px; font-size: 10px; font-weight: 600;
                border: 1px solid ${this._indicators[ind.key] ? ind.color : '#333'};
                background: ${this._indicators[ind.key] ? ind.color + '22' : 'transparent'};
                color: ${this._indicators[ind.key] ? ind.color : '#555'};
                transition: all 0.2s;
            `;
            btn.textContent = ind.label;
            btn.title = `Toggle ${ind.label}`;
            btn.addEventListener('click', () => {
                this._indicators[ind.key] = !this._indicators[ind.key];
                btn.style.border = `1px solid ${this._indicators[ind.key] ? ind.color : '#333'}`;
                btn.style.background = this._indicators[ind.key] ? ind.color + '22' : 'transparent';
                btn.style.color = this._indicators[ind.key] ? ind.color : '#555';
                this.draw();
            });
            toolbar.appendChild(btn);
        });

        // Spacer
        const sep = document.createElement('div');
        sep.style.cssText = 'flex:1;';
        toolbar.appendChild(sep);

        // Utility buttons
        const utilBtns = [
            { label: 'LOG', title: 'Escala logarítmica', action: (btn) => {
                this._logScale = !this._logScale;
                btn.style.border = `1px solid ${this._logScale ? CONFIG.COLORS.blue : '#555'}`;
                btn.style.color = this._logScale ? CONFIG.COLORS.blue : '#888';
                this.draw();
            }},
            { label: '📷', title: 'Capturar chart', action: () => this._screenshot() },
            { label: '⛶', title: 'Pantalla completa', action: () => this._toggleFullscreen() },
            { label: '↺', title: 'Reset zoom', action: () => { this._visibleCount = 80; this._offset = 0; this.draw(); }},
        ];

        utilBtns.forEach(({ label, title, action }) => {
            const btn = document.createElement('button');
            btn.style.cssText = `
                pointer-events: auto; cursor: pointer;
                padding: 2px 7px; border-radius: 4px; font-size: 10px;
                border: 1px solid #555; background: transparent; color: #888; transition: all 0.2s;
            `;
            btn.textContent = label;
            btn.title = title;
            btn.addEventListener('click', () => action(btn));
            toolbar.appendChild(btn);
        });

        container.style.position = 'relative';
        container.appendChild(toolbar);
    },

    // ==========================================
    //  INPUT HANDLERS
    // ==========================================

    _onWheel(e) {
        e.preventDefault();
        const delta = Math.sign(e.deltaY);
        if (e.shiftKey) {
            this._offset = Math.max(0, this._offset + delta * 5);
        } else {
            const speed = e.ctrlKey || e.metaKey ? 8 : 3;
            this._visibleCount = Utils.clamp(this._visibleCount + delta * speed, this._minVisible, this._maxVisible);
        }
        this.draw();
    },

    _onMouseMove(e) {
        const rect = this.canvas.getBoundingClientRect();
        this._mouseX = e.clientX - rect.left;
        this._mouseY = e.clientY - rect.top;
        this._showCrosshair = true;
        this.draw();
    },

    _onMouseLeave() {
        this._showCrosshair = false;
        this.draw();
    },

    _onDragStart(e) {
        if (e.button !== 0) return;
        this._isDragging = true;
        this._dragStartX = e.clientX;
        this._dragStartOffset = this._offset;
        this.canvas.style.cursor = 'grabbing';
    },

    _onDrag(e) {
        if (!this._isDragging || !this._layout) return;
        const dx = e.clientX - this._dragStartX;
        const candlesPerPx = this._visibleCount / this._layout.chartWidth;
        this._offset = Math.max(0, Math.round(this._dragStartOffset + dx * candlesPerPx));
        this.draw();
    },

    _onDragEnd() {
        this._isDragging = false;
        if (this.canvas) this.canvas.style.cursor = 'crosshair';
    },

    _onTouchStart(e) {
        if (e.touches.length === 1) {
            this._isDragging = true;
            this._dragStartX = e.touches[0].clientX;
            this._dragStartOffset = this._offset;
        } else if (e.touches.length === 2) {
            e.preventDefault();
            this._isDragging = false;
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            this._pinchStartDist = Math.sqrt(dx * dx + dy * dy);
            this._pinchStartCount = this._visibleCount;
        }
    },

    _onTouchMove(e) {
        if (e.touches.length === 1 && this._isDragging && this._layout) {
            e.preventDefault();
            const dx = e.touches[0].clientX - this._dragStartX;
            const cpp = this._visibleCount / this._layout.chartWidth;
            this._offset = Math.max(0, Math.round(this._dragStartOffset + dx * cpp));
            this.draw();
        } else if (e.touches.length === 2 && this._pinchStartDist > 0) {
            e.preventDefault();
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const scale = this._pinchStartDist / dist;
            this._visibleCount = Utils.clamp(Math.round(this._pinchStartCount * scale), this._minVisible, this._maxVisible);
            this.draw();
        }
    },

    _onTouchEnd() { this._isDragging = false; this._pinchStartDist = 0; },

    // ==========================================
    //  RESIZE
    // ==========================================

    _resize() {
        if (!this.canvas) return;
        const container = this.canvas.parentElement;
        const dpr = window.devicePixelRatio || 1;
        const w = container.clientWidth;
        const h = container.clientHeight;
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.width = `${w}px`;
        this.canvas.style.height = `${h}px`;
        this.canvas.style.cursor = 'crosshair';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.draw();
    },

    _toggleFullscreen() {
        const c = this.canvas?.parentElement;
        if (!c) return;
        if (!document.fullscreenElement) c.requestFullscreen?.();
        else document.exitFullscreen?.();
    },

    _screenshot() {
        if (!this.canvas) return;
        try {
            const link = document.createElement('a');
            link.download = `chart-${State.symbol}-${State.timeframe}-${Date.now()}.png`;
            link.href = this.canvas.toDataURL('image/png');
            link.click();
            Utils.showNotification('📷 Chart guardado', 'success', 2000);
        } catch (e) { Utils.showNotification('Error al capturar', 'error'); }
    },

    // ==========================================
    //  MAIN DRAW
    // ==========================================

    draw() {
        if (!this.ctx || !this.canvas) return;
        if (this._animFrame) cancelAnimationFrame(this._animFrame);
        this._animFrame = requestAnimationFrame(() => this._render());
    },

    _render() {
        const ctx = this.ctx;
        const dpr = window.devicePixelRatio || 1;
        const w = this.canvas.width / dpr;
        const h = this.canvas.height / dpr;

        ctx.fillStyle = CONFIG.COLORS.bg;
        ctx.fillRect(0, 0, w, h);

        const candles = State.candles;
        if (!candles || candles.length === 0) { this._drawLoading(ctx, w, h); return; }

        const maxOff = Math.max(0, candles.length - this._visibleCount);
        this._offset = Utils.clamp(this._offset, 0, maxOff);

        const endIdx = candles.length - this._offset;
        const startIdx = Math.max(0, endIdx - this._visibleCount);
        const visible = candles.slice(startIdx, endIdx);
        if (visible.length === 0) return;

        // Layout
        const rightPad = 78, topPad = 28, leftPad = 10, bottomPad = 24;
        const showVol = this._indicators.volume;
        const showRsi = this._indicators.rsiPanel;
        const showMacd = this._indicators.macdPanel;
        const subCount = (showVol ? 1 : 0) + (showRsi ? 1 : 0) + (showMacd ? 1 : 0);
        const subH = subCount > 0 ? Math.min(60, (h * 0.3) / subCount) : 0;
        const totalSubH = subH * subCount;
        const chartHeight = h - topPad - bottomPad - totalSubH - (subCount > 0 ? subCount * 4 : 0);
        const chartWidth = w - leftPad - rightPad;
        const barWidth = chartWidth / visible.length;

        // Price range
        const allP = visible.flatMap(c => [c.h, c.l]);
        let minP = Math.min(...allP), maxP = Math.max(...allP);
        if (this._indicators.tpsl && State.analysis) {
            if (State.analysis.tp) { minP = Math.min(minP, State.analysis.tp); maxP = Math.max(maxP, State.analysis.tp); }
            if (State.analysis.sl) { minP = Math.min(minP, State.analysis.sl); maxP = Math.max(maxP, State.analysis.sl); }
        }
        const rPad = (maxP - minP) * 0.04;
        minP -= rPad; maxP += rPad;
        const priceRange = maxP - minP;
        if (priceRange === 0) return;

        const maxVol = Math.max(...visible.map(c => c.v || 0), 1);

        this._layout = {
            leftPad, topPad, rightPad, bottomPad, chartWidth, chartHeight,
            barWidth, minPrice: minP, maxPrice: maxP, priceRange, visible, w, h,
            subPanelH: subH, totalSubH, showVol, showRsi, showMacd, startIdx, endIdx,
            allCandles: candles, maxVol
        };

        // Draw layers
        this._drawGrid(ctx);
        if (this._indicators.bb) this._drawBollingerBands(ctx);
        this._drawCandles(ctx);
        if (this._indicators.ema9) this._drawEMA(ctx, 9, CONFIG.CHART.COLORS.ema9, 1.3);
        if (this._indicators.ema21) this._drawEMA(ctx, 21, CONFIG.CHART.COLORS.ema21, 1.3);
        if (this._indicators.ema50) this._drawEMA(ctx, 50, CONFIG.CHART.COLORS.ema50, 1.0);
        if (this._indicators.vwap) this._drawVWAP(ctx);
        this._drawCurrentPrice(ctx);
        if (this._indicators.tpsl) this._drawLevels(ctx);
        if (this._indicators.positions) this._drawPositionLevels(ctx);

        let subY = topPad + chartHeight + 4;
        if (showVol) { this._drawVolumePanel(ctx, subY, subH); subY += subH + 4; }
        if (showRsi) { this._drawRSIPanel(ctx, subY, subH); subY += subH + 4; }
        if (showMacd) { this._drawMACDPanel(ctx, subY, subH); subY += subH + 4; }

        this._drawTimestamps(ctx);
        if (this._showCrosshair) this._drawCrosshair(ctx);
        this._drawWatermark(ctx);
    },

    // ==========================================
    //  GRID
    // ==========================================

    _drawGrid(ctx) {
        const L = this._layout;
        ctx.strokeStyle = CONFIG.CHART.COLORS.grid;
        ctx.setLineDash([2, 4]);
        ctx.font = '10px monospace';
        ctx.fillStyle = CONFIG.COLORS.muted;
        ctx.textAlign = 'right';

        for (let i = 0; i <= 6; i++) {
            const y = L.topPad + L.chartHeight * (i / 6);
            const price = L.maxPrice - (L.priceRange * (i / 6));
            ctx.beginPath(); ctx.moveTo(L.leftPad, y); ctx.lineTo(L.w - L.rightPad, y); ctx.stroke();
            ctx.fillText(`$${Utils.formatPrice(price)}`, L.w - L.rightPad + 72, y + 3);
        }
        ctx.setLineDash([]);
    },

    _drawTimestamps(ctx) {
        const L = this._layout;
        if (!L.visible[0]?.t) return;
        ctx.font = '9px monospace';
        ctx.fillStyle = CONFIG.COLORS.muted;
        ctx.textAlign = 'center';
        const step = Math.max(1, Math.floor(L.visible.length / 6));
        for (let i = 0; i < L.visible.length; i += step) {
            const c = L.visible[i];
            if (!c.t) continue;
            const x = L.leftPad + i * L.barWidth + L.barWidth / 2;
            const d = new Date(c.t);
            ctx.fillText(`${d.getDate()}/${d.getMonth() + 1} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, x, L.h - 6);
        }
    },

    // ==========================================
    //  CANDLES
    // ==========================================

    _drawCandles(ctx) {
        const L = this._layout;
        const pY = (p) => L.topPad + L.chartHeight - ((p - L.minPrice) / L.priceRange * L.chartHeight);

        L.visible.forEach((c, i) => {
            const x = L.leftPad + i * L.barWidth + L.barWidth / 2;
            const isG = c.c >= c.o;
            const color = isG ? CONFIG.CHART.COLORS.bullish : CONFIG.CHART.COLORS.bearish;

            ctx.strokeStyle = color; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(x, pY(c.h)); ctx.lineTo(x, pY(c.l)); ctx.stroke();

            const bw = Math.max(1, L.barWidth * 0.65);
            ctx.fillStyle = color;
            const oY = pY(c.o), cY = pY(c.c);
            ctx.fillRect(x - bw / 2, Math.min(oY, cY), bw, Math.max(1, Math.abs(cY - oY)));
        });
        ctx.lineWidth = 1;
    },

    // ==========================================
    //  EMAs
    // ==========================================

    _drawEMA(ctx, period, color, width) {
        const L = this._layout;
        const closes = L.allCandles.map(c => c.c);
        if (closes.length < period) return;
        const series = Indicators.emaSeries(closes, period);
        if (!series.length) return;
        this._drawSeriesLine(ctx, series, L.allCandles.length - series.length, color, width);
    },

    // ==========================================
    //  VWAP
    // ==========================================

    _drawVWAP(ctx) {
        const L = this._layout;
        const pY = (p) => L.topPad + L.chartHeight - ((p - L.minPrice) / L.priceRange * L.chartHeight);
        let cumVol = 0, cumTP = 0;
        ctx.strokeStyle = '#ff6b9d'; ctx.lineWidth = 1.2; ctx.setLineDash([4, 2]); ctx.beginPath();
        let s = false;
        L.visible.forEach((c, i) => {
            const tp = (c.h + c.l + c.c) / 3;
            cumVol += (c.v || 0); cumTP += tp * (c.v || 0);
            const vwap = cumVol > 0 ? cumTP / cumVol : tp;
            const x = L.leftPad + i * L.barWidth + L.barWidth / 2;
            if (!s) { ctx.moveTo(x, pY(vwap)); s = true; } else ctx.lineTo(x, pY(vwap));
        });
        ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1;
    },

    // ==========================================
    //  BOLLINGER BANDS
    // ==========================================

    _drawBollingerBands(ctx) {
        const L = this._layout;
        const closes = L.allCandles.map(c => c.c);
        if (closes.length < 20) return;
        const pY = (p) => L.topPad + L.chartHeight - ((p - L.minPrice) / L.priceRange * L.chartHeight);
        const up = [], lo = [];
        for (let i = L.startIdx; i < L.endIdx; i++) {
            if (i < 19) continue;
            const sl = closes.slice(i - 19, i + 1);
            const m = sl.reduce((a, b) => a + b, 0) / 20;
            const std = Math.sqrt(sl.reduce((s, v) => s + (v - m) ** 2, 0) / 20);
            const ci = i - L.startIdx;
            const x = L.leftPad + ci * L.barWidth + L.barWidth / 2;
            up.push({ x, y: pY(m + std * 2) }); lo.push({ x, y: pY(m - std * 2) });
        }
        if (up.length < 2) return;
        ctx.fillStyle = 'rgba(0, 212, 255, 0.035)';
        ctx.beginPath();
        up.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
        for (let i = lo.length - 1; i >= 0; i--) ctx.lineTo(lo[i].x, lo[i].y);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(0, 212, 255, 0.22)'; ctx.setLineDash([3, 3]);
        [up, lo].forEach(pts => { ctx.beginPath(); pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)); ctx.stroke(); });
        ctx.setLineDash([]);
    },

    // ==========================================
    //  SUB PANELS
    // ==========================================

    _drawVolumePanel(ctx, y, height) {
        const L = this._layout;
        this._drawSubPanelBg(ctx, y, height, 'VOL');
        L.visible.forEach((c, i) => {
            const x = L.leftPad + i * L.barWidth;
            const barH = ((c.v || 0) / L.maxVol) * height * 0.8;
            ctx.fillStyle = c.c >= c.o ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)';
            ctx.fillRect(x + 1, y + height - barH, Math.max(1, L.barWidth - 2), barH);
        });
    },

    _drawRSIPanel(ctx, y, height) {
        const L = this._layout;
        this._drawSubPanelBg(ctx, y, height, 'RSI');
        const closes = L.allCandles.map(c => c.c);
        const rsi = Indicators.rsiSeries(closes, 14);
        if (!rsi.length) return;
        const off = L.allCandles.length - rsi.length;
        const vY = (v) => y + height - (v / 100) * height;

        // Zones
        ctx.fillStyle = 'rgba(239,68,68,0.06)';
        ctx.fillRect(L.leftPad, vY(100), L.chartWidth, vY(70) - vY(100));
        ctx.fillStyle = 'rgba(34,197,94,0.06)';
        ctx.fillRect(L.leftPad, vY(30), L.chartWidth, vY(0) - vY(30));

        [30, 50, 70].forEach(lv => {
            ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.setLineDash([2, 4]);
            ctx.beginPath(); ctx.moveTo(L.leftPad, vY(lv)); ctx.lineTo(L.w - L.rightPad, vY(lv)); ctx.stroke();
            ctx.setLineDash([]);
        });

        ctx.strokeStyle = '#eab308'; ctx.lineWidth = 1.3; ctx.beginPath();
        let started = false;
        for (let i = L.startIdx; i < L.endIdx; i++) {
            const si = i - off;
            if (si < 0 || si >= rsi.length) continue;
            const x = L.leftPad + (i - L.startIdx) * L.barWidth + L.barWidth / 2;
            if (!started) { ctx.moveTo(x, vY(rsi[si])); started = true; } else ctx.lineTo(x, vY(rsi[si]));
        }
        ctx.stroke(); ctx.lineWidth = 1;

        const last = rsi[rsi.length - 1 - this._offset];
        if (last !== undefined) {
            ctx.fillStyle = last > 70 ? CONFIG.COLORS.red : last < 30 ? CONFIG.COLORS.green : '#eab308';
            ctx.font = 'bold 10px monospace'; ctx.textAlign = 'right';
            ctx.fillText(last.toFixed(1), L.w - L.rightPad + 72, vY(last) + 3);
        }
    },

    _drawMACDPanel(ctx, y, height) {
        const L = this._layout;
        this._drawSubPanelBg(ctx, y, height, 'MACD');
        const closes = L.allCandles.map(c => c.c);
        const macd = Indicators.macd(closes);
        if (!macd.series || !macd.series.length) return;
        const series = macd.series;
        const maxAbs = Math.max(...series.map(s => Math.max(Math.abs(s.histogram), Math.abs(s.macd), Math.abs(s.signal))), 0.001);
        const vY = (v) => y + height / 2 - (v / maxAbs) * (height / 2) * 0.85;

        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.beginPath(); ctx.moveTo(L.leftPad, y + height / 2); ctx.lineTo(L.w - L.rightPad, y + height / 2); ctx.stroke();

        const sLen = series.length, vLen = L.visible.length;
        const sOff = Math.max(0, sLen - vLen - this._offset);

        for (let i = 0; i < vLen && (sOff + i) < sLen; i++) {
            const s = series[sOff + i]; if (!s) continue;
            const x = L.leftPad + i * L.barWidth;
            const bH = Math.abs(s.histogram / maxAbs) * (height / 2) * 0.85;
            const bY = s.histogram >= 0 ? y + height / 2 - bH : y + height / 2;
            ctx.fillStyle = s.histogram >= 0 ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)';
            ctx.fillRect(x + 1, bY, Math.max(1, L.barWidth - 2), bH);
        }

        const drawLine = (key, col) => {
            ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.beginPath(); let st = false;
            for (let i = 0; i < vLen && (sOff + i) < sLen; i++) {
                const s = series[sOff + i]; if (!s) continue;
                const x = L.leftPad + i * L.barWidth + L.barWidth / 2;
                if (!st) { ctx.moveTo(x, vY(s[key])); st = true; } else ctx.lineTo(x, vY(s[key]));
            }
            ctx.stroke();
        };
        drawLine('macd', CONFIG.COLORS.blue);
        drawLine('signal', '#f97316');
        ctx.lineWidth = 1;
    },

    // ==========================================
    //  CURRENT PRICE & LEVELS
    // ==========================================

    _drawCurrentPrice(ctx) {
        const L = this._layout;
        const price = L.visible[L.visible.length - 1].c;
        const prev = L.visible.length > 1 ? L.visible[L.visible.length - 2].c : price;
        const y = L.topPad + L.chartHeight - ((price - L.minPrice) / L.priceRange * L.chartHeight);
        const color = price >= prev ? CONFIG.COLORS.green : CONFIG.COLORS.red;

        ctx.strokeStyle = color; ctx.setLineDash([4, 3]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(L.leftPad, y); ctx.lineTo(L.w - L.rightPad, y); ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = color;
        ctx.fillRect(L.w - L.rightPad + 2, y - 10, 74, 20);
        ctx.fillStyle = '#000'; ctx.font = 'bold 10px monospace'; ctx.textAlign = 'left';
        ctx.fillText(`$${Utils.formatPrice(price)}`, L.w - L.rightPad + 5, y + 4);
    },

    _drawLevels(ctx) {
        if (!State.analysis) return;
        if (State.analysis.tp) this._drawPriceLine(ctx, State.analysis.tp, CONFIG.CHART.COLORS.tp, 'TP');
        if (State.analysis.sl) this._drawPriceLine(ctx, State.analysis.sl, CONFIG.CHART.COLORS.sl, 'SL');
    },

    _drawPositionLevels(ctx) {
        for (const pos of State.positions) {
            if (pos.symbol !== State.symbol) continue;
            this._drawPriceLine(ctx, pos.entry, CONFIG.COLORS.blue, `E ${pos.direction}`, [2, 4]);
            if (pos.liq) this._drawPriceLine(ctx, pos.liq, CONFIG.CHART.COLORS.liq, 'LIQ', [1, 3]);
        }
    },

    _drawPriceLine(ctx, price, color, label, dash = [3, 3]) {
        const L = this._layout;
        if (!price) return;
        const y = L.topPad + L.chartHeight - ((price - L.minPrice) / L.priceRange * L.chartHeight);
        if (y < L.topPad - 15 || y > L.topPad + L.chartHeight + 15) return;

        ctx.strokeStyle = color; ctx.setLineDash(dash); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(L.leftPad, y); ctx.lineTo(L.w - L.rightPad, y); ctx.stroke();
        ctx.setLineDash([]);

        const text = `${label} $${Utils.formatPrice(price)}`;
        ctx.font = 'bold 9px monospace';
        const tw = ctx.measureText(text).width + 8;
        ctx.fillStyle = color; ctx.fillRect(L.leftPad + 2, y - 8, tw, 16);
        ctx.fillStyle = '#000'; ctx.textAlign = 'left';
        ctx.fillText(text, L.leftPad + 6, y + 4);
    },

    // ==========================================
    //  CROSSHAIR & TOOLTIP
    // ==========================================

    _drawCrosshair(ctx) {
        const L = this._layout;
        const mx = this._mouseX, my = this._mouseY;
        if (mx < L.leftPad || mx > L.w - L.rightPad || my < L.topPad || my > L.h - L.bottomPad) return;

        ctx.strokeStyle = CONFIG.CHART.COLORS.crosshair;
        ctx.setLineDash([2, 2]); ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(L.leftPad, my); ctx.lineTo(L.w - L.rightPad, my); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(mx, L.topPad); ctx.lineTo(mx, L.topPad + L.chartHeight); ctx.stroke();
        ctx.setLineDash([]);

        if (my >= L.topPad && my <= L.topPad + L.chartHeight) {
            const price = L.maxPrice - ((my - L.topPad) / L.chartHeight * L.priceRange);
            ctx.fillStyle = 'rgba(255,255,255,0.85)';
            ctx.fillRect(L.w - L.rightPad + 2, my - 9, 74, 18);
            ctx.fillStyle = '#000'; ctx.font = '10px monospace'; ctx.textAlign = 'left';
            ctx.fillText(`$${Utils.formatPrice(price)}`, L.w - L.rightPad + 5, my + 4);
        }

        const ci = Math.floor((mx - L.leftPad) / L.barWidth);
        if (ci >= 0 && ci < L.visible.length) this._drawTooltip(ctx, mx, L.visible[ci]);
    },

    _drawTooltip(ctx, x, c) {
        const L = this._layout;
        const pct = c.o !== 0 ? ((c.c - c.o) / c.o * 100).toFixed(2) : '0';
        const isG = c.c >= c.o;
        const time = c.t ? new Date(c.t).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';

        const lines = [time, `O: $${Utils.formatPrice(c.o)}`, `H: $${Utils.formatPrice(c.h)}`, `L: $${Utils.formatPrice(c.l)}`, `C: $${Utils.formatPrice(c.c)}`, `V: ${Utils.formatVolume(c.v)}`, `${isG ? '▲' : '▼'} ${pct}%`];

        const bW = 130, lH = 16, bH = lines.length * lH + 12;
        let bX = x + 18, bY = L.topPad + 10;
        if (bX + bW > L.w - L.rightPad) bX = x - bW - 18;

        ctx.fillStyle = 'rgba(12,12,20,0.94)'; ctx.strokeStyle = CONFIG.COLORS.border || '#2a2a3e'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.roundRect(bX, bY, bW, bH, 6); ctx.fill(); ctx.stroke();

        ctx.font = '11px monospace'; ctx.textAlign = 'left';
        lines.forEach((line, i) => {
            ctx.fillStyle = i === 0 ? CONFIG.COLORS.muted : i === lines.length - 1 ? (isG ? CONFIG.COLORS.green : CONFIG.COLORS.red) : CONFIG.COLORS.text;
            ctx.fillText(line, bX + 8, bY + 18 + i * lH);
        });
    },

    // ==========================================
    //  HELPERS
    // ==========================================

    _drawSeriesLine(ctx, series, seriesOffset, color, width = 1) {
        const L = this._layout;
        const pY = (p) => L.topPad + L.chartHeight - ((p - L.minPrice) / L.priceRange * L.chartHeight);
        ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
        let s = false;
        for (let i = L.startIdx; i < L.endIdx; i++) {
            const si = i - seriesOffset;
            if (si < 0 || si >= series.length) continue;
            const x = L.leftPad + (i - L.startIdx) * L.barWidth + L.barWidth / 2;
            if (!s) { ctx.moveTo(x, pY(series[si])); s = true; } else ctx.lineTo(x, pY(series[si]));
        }
        ctx.stroke(); ctx.lineWidth = 1;
    },

    _drawSubPanelBg(ctx, y, height, label) {
        const L = this._layout;
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.beginPath(); ctx.moveTo(L.leftPad, y); ctx.lineTo(L.w - L.rightPad, y); ctx.stroke();
        ctx.font = 'bold 9px monospace'; ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.textAlign = 'left';
        ctx.fillText(label, L.leftPad + 4, y + 11);
    },

    _drawWatermark(ctx) {
        const L = this._layout;
        ctx.font = 'bold 11px sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.textAlign = 'center';
        ctx.fillText(`${State.symbol}USDT · ${State.timeframe}`, L.w / 2, L.topPad + L.chartHeight / 2);
    },

    _drawLoading(ctx, w, h) {
        ctx.fillStyle = CONFIG.COLORS.muted; ctx.font = '14px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('Cargando datos de mercado...', w / 2, h / 2);
    }
};
