/* ========================================
   POSITIONS — Pro Position Tracker
   TheRealShortShady v3.0
   ======================================== */

const Positions = {

    _confirmingClose: null,
    _timerInterval: null,
    _selectedId: null,

    init() {
        this.render();
        this.subscribeToState();
        this._timerInterval = setInterval(() => this._updateTimers(), 1000);
    },

    _bsAsTime(isoStr) {
        try {
            return new Date(isoStr).toLocaleString('es-AR', {
                timeZone: 'America/Argentina/Buenos_Aires',
                hour: '2-digit', minute: '2-digit', second: '2-digit'
            });
        } catch (e) {
            return new Date(isoStr).toLocaleTimeString('es-AR');
        }
    },

    _bsAsNow() {
        return new Date().toLocaleString('es-AR', {
            timeZone: 'America/Argentina/Buenos_Aires',
            hour: '2-digit', minute: '2-digit'
        });
    },

    _estimateCloseTime(pos) {
        const modeEstimates = {
            scalping: { min: 1, max: 5, unit: 'min' },
            intraday: { min: 30, max: 240, unit: 'min' },
            swing: { min: 4, max: 72, unit: 'hour' },
            position: { min: 24, max: 504, unit: 'hour' }
        };

        const est = modeEstimates[pos.mode] || modeEstimates.intraday;
        const price = State.prices[pos.symbol]?.price || pos.entry;
        const totalRange = Math.abs(pos.tp - pos.sl);

        let progressRatio = 0.5;
        if (totalRange > 0) {
            if (pos.direction === 'LONG') {
                progressRatio = (price - pos.sl) / totalRange;
            } else {
                progressRatio = (pos.sl - price) / totalRange;
            }
        }
        progressRatio = Math.max(0.05, Math.min(0.95, progressRatio));

        const remainRatio = 1 - progressRatio;
        const midMinutes = (est.min + est.max) / 2;
        const estMinutes = midMinutes * remainRatio;
        const elapsed = (Date.now() - new Date(pos.timestamp).getTime()) / 60000;
        const remaining = Math.max(1, estMinutes - elapsed * 0.3);

        const closeAt = new Date(Date.now() + remaining * 60000);

        try {
            const timeStr = closeAt.toLocaleString('es-AR', {
                timeZone: 'America/Argentina/Buenos_Aires',
                hour: '2-digit', minute: '2-digit'
            });
            let remStr;
            if (remaining < 60) remStr = `~${Math.round(remaining)}m`;
            else if (remaining < 1440) remStr = `~${Math.round(remaining / 60)}h ${Math.round(remaining % 60)}m`;
            else remStr = `~${Math.round(remaining / 1440)}d`;

            return { time: timeStr, remaining: remStr, minutes: remaining };
        } catch (e) {
            return { time: '--:--', remaining: '--', minutes: 0 };
        }
    },

    render() {
        const container = document.getElementById('positions');
        const title = document.getElementById('positionsTitle');
        if (!container) return;

        const maxPos = State.maxPositions || CONFIG.TRADING.MAX_POSITIONS;

        if (title) {
            title.innerHTML = `<span class="panel-title-icon">◈</span> Posiciones (${State.positions.length}/${maxPos})`;
        }

        if (State.positions.length === 0) {
            this._selectedId = null;
            container.innerHTML = `<div class="pos-empty">Sin posiciones abiertas</div>`;
            return;
        }

        if (this._selectedId && !State.positions.find(p => p.id === this._selectedId)) {
            this._selectedId = null;
        }

        if (this._selectedId) {
            this._renderDetail(container);
            return;
        }

        container.innerHTML = State.positions.map(pos => {
            const price = State.prices[pos.symbol]?.price || pos.entry;
            const pnl = this.calculatePnL(pos, price);
            const pnlPercent = pos.margin > 0 ? (pnl / pos.margin) * 100 : 0;
            const progress = this.calculateProgress(pos, price);
            const duration = this._calcDuration(pos.timestamp);
            const liqDist = this._liqDistance(pos, price);
            const est = this._estimateCloseTime(pos);
            const dirColor = pos.direction === 'LONG' ? 'var(--green)' : 'var(--red)';
            const dirIcon = pos.direction === 'LONG' ? '▲' : '▼';

            const tpDist = ((Math.abs(pos.tp - price) / price) * 100).toFixed(2);
            const slDist = ((Math.abs(pos.sl - price) / price) * 100).toFixed(2);

            return `
                <div class="pos-item" data-id="${pos.id}" onclick="Positions.select('${pos.id}')">
                    <div class="pos-header">
                        <span class="pos-symbol">
                            <span style="color:${dirColor}">${dirIcon}</span>
                            ${pos.symbol}
                            <span class="pos-type">${pos.leverage}x ${pos.direction}</span>
                        </span>
                        <button class="pos-close-btn" onclick="event.stopPropagation(); Positions.close('${pos.id}')" title="Cerrar posición">✕</button>
                    </div>

                    <div class="pos-pnl ${pnl >= 0 ? 'profit' : 'loss'}" id="pos-pnl-${pos.id}">
                        ${Utils.formatPnL(pnl)} <small>(${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(1)}%)</small>
                    </div>

                    <div class="pos-grid">
                        <div class="pos-grid-item">
                            <span class="pos-grid-label">Entry</span>
                            <span class="pos-grid-value">$${Utils.formatPrice(pos.entry)}</span>
                        </div>
                        <div class="pos-grid-item">
                            <span class="pos-grid-label">Actual</span>
                            <span class="pos-grid-value" id="pos-price-${pos.id}">$${Utils.formatPrice(price)}</span>
                        </div>
                        <div class="pos-grid-item">
                            <span class="pos-grid-label" style="color:var(--green)">TP</span>
                            <span class="pos-grid-value" style="color:var(--green)">$${Utils.formatPrice(pos.tp)} <small>${tpDist}%</small></span>
                        </div>
                        <div class="pos-grid-item">
                            <span class="pos-grid-label" style="color:var(--red)">SL</span>
                            <span class="pos-grid-value" style="color:var(--red)">$${Utils.formatPrice(pos.sl)} <small>${slDist}%</small></span>
                        </div>
                        <div class="pos-grid-item">
                            <span class="pos-grid-label">Margen</span>
                            <span class="pos-grid-value">${Utils.formatCurrency(pos.margin)}</span>
                        </div>
                        <div class="pos-grid-item">
                            <span class="pos-grid-label">Size</span>
                            <span class="pos-grid-value">${Utils.formatCurrency(pos.size)}</span>
                        </div>
                    </div>

                    <div class="pos-timer-row">
                        <span class="pos-timer-label">
                            ⏱ <span class="pos-duration" data-ts="${pos.timestamp}">${duration}</span>
                        </span>
                        <span class="pos-timer-est" id="pos-est-${pos.id}">
                            Cierre est: ${est.time} (${est.remaining})
                        </span>
                    </div>

                    <div class="pos-liq-row" style="color:${liqDist < 3 ? 'var(--red)' : liqDist < 8 ? 'var(--yellow)' : 'var(--muted)'}">
                        Liq: $${Utils.formatPrice(pos.liq)} (${liqDist.toFixed(1)}% away)
                    </div>

                    <div class="pos-progress">
                        <div class="pos-progress-bar" id="pos-bar-${pos.id}"
                             style="width:${progress}%; background:${pnl >= 0 ? 'var(--green)' : 'var(--red)'}">
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    },

    select(id) {
        this._selectedId = id;
        this.render();
    },

    backToList() {
        this._selectedId = null;
        this.render();
    },

    _renderDetail(container) {
        const pos = State.positions.find(p => p.id === this._selectedId);
        if (!pos) {
            this._selectedId = null;
            this.render();
            return;
        }

        const price = State.prices[pos.symbol]?.price || pos.entry;
        const pnl = this.calculatePnL(pos, price);
        const pnlPercent = pos.margin > 0 ? (pnl / pos.margin) * 100 : 0;
        const progress = this.calculateProgress(pos, price);
        const duration = this._calcDuration(pos.timestamp);
        const liqDist = this._liqDistance(pos, price);
        const est = this._estimateCloseTime(pos);
        const dirColor = pos.direction === 'LONG' ? 'var(--green)' : 'var(--red)';
        const dirIcon = pos.direction === 'LONG' ? '▲' : '▼';

        const tpDist = ((Math.abs(pos.tp - price) / price) * 100).toFixed(2);
        const slDist = ((Math.abs(pos.sl - price) / price) * 100).toFixed(2);
        const entryTime = this._bsAsTime(pos.timestamp);
        const entryDate = this._bsAsDate(pos.timestamp);

        const totalFees = pos.fee * 2; // entry (paid) + exit (estimated)
        const feeImpact = pos.margin > 0 ? ((totalFees / pos.margin) * 100).toFixed(2) : '0';

        const pnlAtTp = this.calculatePnL(pos, pos.tp);
        const pnlAtSl = this.calculatePnL(pos, pos.sl);

        const entryDist = ((price - pos.entry) / pos.entry * 100).toFixed(3);

        // Advanced calculations
        const riskMetrics = this._calculateRiskMetrics(pos, price);
        const marketContext = this._getMarketContext(pos);
        const performanceMetrics = this._getPerformanceMetrics(pos);

        container.innerHTML = `
            <div class="pos-detail">
                <div class="pos-detail-header">
                    <button class="pos-back-btn" onclick="Positions.backToList()">← Volver</button>
                    <button class="pos-close-btn" onclick="Positions.close('${pos.id}')" title="Cerrar posición">✕ Cerrar</button>
                </div>

                <div class="pos-detail-title">
                    <span style="color:${dirColor}; font-size:20px">${dirIcon}</span>
                    <span class="pos-detail-symbol">${pos.symbol}USDT</span>
                    <span class="pos-type">${pos.leverage}x ${pos.direction}</span>
                    <span class="pos-type" style="background:var(--gold-dim); color:var(--gold)">${pos.mode}</span>
                    ${pos.tpSlMode === 'manual' ? '<span class="pos-type" style="background:rgba(94,187,255,0.1); color:#5ebbff">Manual</span>' : ''}
                    ${pos.source === 'watcher' ? '<span class="pos-type" style="background:rgba(0,212,255,0.1); color:var(--cyan)">Auto</span>' : ''}
                </div>

                <div class="pos-detail-pnl ${pnl >= 0 ? 'profit' : 'loss'}" id="pos-pnl-${pos.id}">
                    ${Utils.formatPnL(pnl)}
                    <span class="pos-detail-pnl-pct">(${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%)</span>
                </div>

                <div class="pos-progress" style="margin:12px 0; height:6px;">
                    <div class="pos-progress-bar" id="pos-bar-${pos.id}"
                         style="width:${progress}%; background:${pnl >= 0 ? 'var(--green)' : 'var(--red)'}">
                    </div>
                    <div class="pos-progress-marker" style="left:${this._getEntryMarker(pos, price)}%; background:var(--cyan);" title="Entry"></div>
                </div>

                <!-- PRECIOS -->
                <div class="pos-detail-section">
                    <div class="pos-detail-section-title">💰 Precios</div>
                    <div class="pos-grid">
                        <div class="pos-grid-item">
                            <span class="pos-grid-label">Entry</span>
                            <span class="pos-grid-value">$${Utils.formatPrice(pos.entry)}</span>
                        </div>
                        <div class="pos-grid-item">
                            <span class="pos-grid-label">Actual</span>
                            <span class="pos-grid-value" id="pos-price-${pos.id}">$${Utils.formatPrice(price)} <small style="color:${entryDist >= 0 ? 'var(--green)' : 'var(--red)'}">${entryDist >= 0 ? '+' : ''}${entryDist}%</small></span>
                        </div>
                        <div class="pos-grid-item">
                            <span class="pos-grid-label" style="color:var(--green)">Take Profit</span>
                            <span class="pos-grid-value" style="color:var(--green)">$${Utils.formatPrice(pos.tp)} <small>+${tpDist}%</small></span>
                        </div>
                        <div class="pos-grid-item">
                            <span class="pos-grid-label" style="color:var(--red)">Stop Loss</span>
                            <span class="pos-grid-value" style="color:var(--red)">$${Utils.formatPrice(pos.sl)} <small>-${slDist}%</small></span>
                        </div>
                        <div class="pos-grid-item">
                            <span class="pos-grid-label">Dist. a TP</span>
                            <span class="pos-grid-value" style="color:var(--green)">${riskMetrics.distToTp}%</span>
                        </div>
                        <div class="pos-grid-item">
                            <span class="pos-grid-label">Dist. a SL</span>
                            <span class="pos-grid-value" style="color:var(--red)">${riskMetrics.distToSl}%</span>
                        </div>
                    </div>
                </div>

                <!-- CAPITAL Y RIESGO -->
                <div class="pos-detail-section">
                    <div class="pos-detail-section-title">📊 Capital & Riesgo</div>
                    <div class="pos-grid">
                        <div class="pos-grid-item">
                            <span class="pos-grid-label">Margen</span>
                            <span class="pos-grid-value">${Utils.formatCurrency(pos.margin)}</span>
                        </div>
                        <div class="pos-grid-item">
                            <span class="pos-grid-label">Size</span>
                            <span class="pos-grid-value">${Utils.formatCurrency(pos.size)}</span>
                        </div>
                        <div class="pos-grid-item">
                            <span class="pos-grid-label">Leverage</span>
                            <span class="pos-grid-value" style="color:${pos.leverage > 50 ? 'var(--red)' : pos.leverage > 20 ? 'var(--yellow)' : 'var(--text)'}">${pos.leverage}x</span>
                        </div>
                        <div class="pos-grid-item">
                            <span class="pos-grid-label">R:R</span>
                            <span class="pos-grid-value" style="color:${pos.rrRatio >= 2 ? 'var(--green)' : pos.rrRatio >= 1.5 ? 'var(--yellow)' : 'var(--red)'}">${pos.rrRatio || '—'}:1</span>
                        </div>
                        <div class="pos-grid-item">
                            <span class="pos-grid-label">Fees Est.</span>
                            <span class="pos-grid-value" style="color:var(--red)">${Utils.formatCurrency(totalFees)} <small>${feeImpact}%</small></span>
                        </div>
                        <div class="pos-grid-item">
                            <span class="pos-grid-label">% Balance</span>
                            <span class="pos-grid-value">${riskMetrics.balancePercent}%</span>
                        </div>
                        <div class="pos-grid-item">
                            <span class="pos-grid-label">Max Loss</span>
                            <span class="pos-grid-value" style="color:var(--red)">${Utils.formatCurrency(riskMetrics.maxLoss)}</span>
                        </div>
                        <div class="pos-grid-item">
                            <span class="pos-grid-label">Breakeven</span>
                            <span class="pos-grid-value">$${Utils.formatPrice(riskMetrics.breakeven)}</span>
                        </div>
                    </div>
                </div>

                <!-- ESCENARIOS -->
                <div class="pos-detail-section">
                    <div class="pos-detail-section-title">🎯 Escenarios</div>
                    <div class="pos-grid">
                        <div class="pos-grid-item" style="background:rgba(34,197,94,0.1)">
                            <span class="pos-grid-label" style="color:var(--green)">✓ Si toca TP</span>
                            <span class="pos-grid-value" style="color:var(--green); font-size:14px; font-weight:700">${Utils.formatPnL(pnlAtTp)}</span>
                        </div>
                        <div class="pos-grid-item" style="background:rgba(239,68,68,0.1)">
                            <span class="pos-grid-label" style="color:var(--red)">✗ Si toca SL</span>
                            <span class="pos-grid-value" style="color:var(--red); font-size:14px; font-weight:700">${Utils.formatPnL(pnlAtSl)}</span>
                        </div>
                        <div class="pos-grid-item">
                            <span class="pos-grid-label">ROI al TP</span>
                            <span class="pos-grid-value" style="color:var(--green)">+${((pnlAtTp / pos.margin) * 100).toFixed(1)}%</span>
                        </div>
                        <div class="pos-grid-item">
                            <span class="pos-grid-label">ROI al SL</span>
                            <span class="pos-grid-value" style="color:var(--red)">${((pnlAtSl / pos.margin) * 100).toFixed(1)}%</span>
                        </div>
                    </div>
                </div>

                <!-- TIEMPO -->
                <div class="pos-detail-section">
                    <div class="pos-detail-section-title">⏱ Tiempo</div>
                    <div class="pos-grid">
                        <div class="pos-grid-item">
                            <span class="pos-grid-label">Abierta</span>
                            <span class="pos-grid-value">${entryDate}<br>${entryTime}</span>
                        </div>
                        <div class="pos-grid-item">
                            <span class="pos-grid-label">Duración</span>
                            <span class="pos-grid-value" style="font-size:14px"><span class="pos-duration" data-ts="${pos.timestamp}">${duration}</span></span>
                        </div>
                        <div class="pos-grid-item">
                            <span class="pos-grid-label">Cierre Est.</span>
                            <span class="pos-grid-value" id="pos-est-${pos.id}">${est.time}<br><small>${est.remaining}</small></span>
                        </div>
                        <div class="pos-grid-item">
                            <span class="pos-grid-label">Timeframe</span>
                            <span class="pos-grid-value">${pos.timeframe || '—'}</span>
                        </div>
                    </div>
                </div>

                <!-- ANÁLISIS -->
                <div class="pos-detail-section">
                    <div class="pos-detail-section-title">🧠 Análisis al Entrar</div>
                    <div class="pos-grid">
                        <div class="pos-grid-item">
                            <span class="pos-grid-label">Confianza</span>
                            <span class="pos-grid-value">
                                <span class="pos-confidence-badge" style="background:${pos.confidence >= 70 ? 'var(--green-bg)' : pos.confidence >= 50 ? 'var(--yellow-bg)' : 'var(--red-bg)'}; color:${pos.confidence >= 70 ? 'var(--green)' : pos.confidence >= 50 ? 'var(--yellow)' : 'var(--red)'}">${pos.confidence}%</span>
                            </span>
                        </div>
                        <div class="pos-grid-item">
                            <span class="pos-grid-label">Modo</span>
                            <span class="pos-grid-value">${pos.mode}</span>
                        </div>
                        <div class="pos-grid-item">
                            <span class="pos-grid-label">Origen</span>
                            <span class="pos-grid-value">${pos.source === 'watcher' ? '🤖 Auto-Watcher' : '👤 Manual'}</span>
                        </div>
                        <div class="pos-grid-item">
                            <span class="pos-grid-label">TP/SL</span>
                            <span class="pos-grid-value">${pos.tpSlMode === 'manual' ? 'Manual' : 'Auto'}</span>
                        </div>
                    </div>
                    ${pos.botSummary ? `
                    <div class="pos-bots-summary">
                        <span class="pos-grid-label">Bots:</span>
                        <span class="pos-bots-list">${this._formatBotSummary(pos.botSummary)}</span>
                    </div>
                    ` : ''}
                </div>

                <!-- CONTEXTO DE MERCADO -->
                ${marketContext.available ? `
                <div class="pos-detail-section">
                    <div class="pos-detail-section-title">📈 Contexto de Mercado</div>
                    <div class="pos-grid">
                        <div class="pos-grid-item">
                            <span class="pos-grid-label">RSI</span>
                            <span class="pos-grid-value" style="color:${marketContext.rsi > 70 ? 'var(--red)' : marketContext.rsi < 30 ? 'var(--green)' : 'var(--text)'}">${marketContext.rsi?.toFixed(1) || '—'}</span>
                        </div>
                        <div class="pos-grid-item">
                            <span class="pos-grid-label">EMA Trend</span>
                            <span class="pos-grid-value" style="color:${marketContext.emaTrend === 'bullish' ? 'var(--green)' : marketContext.emaTrend === 'bearish' ? 'var(--red)' : 'var(--text)'}">${marketContext.emaTrend || '—'}</span>
                        </div>
                        <div class="pos-grid-item">
                            <span class="pos-grid-label">Volatilidad</span>
                            <span class="pos-grid-value">${marketContext.volatility || '—'}</span>
                        </div>
                        <div class="pos-grid-item">
                            <span class="pos-grid-label">Vol. Ratio</span>
                            <span class="pos-grid-value">${marketContext.volumeRatio?.toFixed(2) || '—'}x</span>
                        </div>
                    </div>
                </div>
                ` : ''}

                <!-- HIPÓTESIS -->
                ${pos.hypothesis ? `
                <div class="pos-detail-section pos-hypothesis-section">
                    <div class="pos-detail-section-title">📝 Hipótesis</div>
                    <div class="pos-hypothesis-text">"${pos.hypothesis}"</div>
                </div>
                ` : ''}

                <!-- LIQUIDACIÓN -->
                <div class="pos-detail-liq" style="color:${liqDist < 3 ? 'var(--red)' : liqDist < 8 ? 'var(--yellow)' : 'var(--muted)'}">
                    ⚠ Liquidación: $${Utils.formatPrice(pos.liq)} (${liqDist.toFixed(1)}% away)
                    ${liqDist < 5 ? '<span style="color:var(--red); font-weight:700;"> — ¡PELIGRO!</span>' : ''}
                </div>

                <!-- ESTADÍSTICAS DEL SÍMBOLO -->
                ${performanceMetrics.hasTrades ? `
                <div class="pos-detail-section pos-stats-section">
                    <div class="pos-detail-section-title">📊 Historial ${pos.symbol}</div>
                    <div class="pos-grid">
                        <div class="pos-grid-item">
                            <span class="pos-grid-label">Trades</span>
                            <span class="pos-grid-value">${performanceMetrics.trades}</span>
                        </div>
                        <div class="pos-grid-item">
                            <span class="pos-grid-label">Win Rate</span>
                            <span class="pos-grid-value" style="color:${performanceMetrics.winRate >= 60 ? 'var(--green)' : performanceMetrics.winRate >= 45 ? 'var(--yellow)' : 'var(--red)'}">${performanceMetrics.winRate}%</span>
                        </div>
                        <div class="pos-grid-item">
                            <span class="pos-grid-label">PnL Total</span>
                            <span class="pos-grid-value" style="color:${performanceMetrics.totalPnl >= 0 ? 'var(--green)' : 'var(--red)'}">${Utils.formatPnL(performanceMetrics.totalPnl)}</span>
                        </div>
                        <div class="pos-grid-item">
                            <span class="pos-grid-label">Avg PnL</span>
                            <span class="pos-grid-value" style="color:${performanceMetrics.avgPnl >= 0 ? 'var(--green)' : 'var(--red)'}">${Utils.formatPnL(performanceMetrics.avgPnl)}</span>
                        </div>
                    </div>
                </div>
                ` : ''}
            </div>
        `;
    },

    _bsAsDate(isoStr) {
        try {
            return new Date(isoStr).toLocaleDateString('es-AR', {
                timeZone: 'America/Argentina/Buenos_Aires',
                day: '2-digit', month: 'short'
            });
        } catch (e) {
            return new Date(isoStr).toLocaleDateString('es-AR');
        }
    },

    _calculateRiskMetrics(pos, price) {
        const balance = State.balance || 10000;
        const balancePercent = ((pos.margin / balance) * 100).toFixed(1);

        // Distance to TP/SL from current price
        const distToTp = pos.direction === 'LONG' ?
            ((pos.tp - price) / price * 100).toFixed(2) :
            ((price - pos.tp) / price * 100).toFixed(2);
        const distToSl = pos.direction === 'LONG' ?
            ((price - pos.sl) / price * 100).toFixed(2) :
            ((pos.sl - price) / price * 100).toFixed(2);

        // Max theoretical loss
        const maxLoss = Math.abs(this.calculatePnL(pos, pos.sl));

        // Breakeven price (including fees)
        const feePct = (pos.fee * 2) / pos.size;
        const breakeven = pos.direction === 'LONG' ?
            pos.entry * (1 + feePct) :
            pos.entry * (1 - feePct);

        return {
            balancePercent,
            distToTp,
            distToSl,
            maxLoss,
            breakeven
        };
    },

    _getMarketContext(pos) {
        const candles = State.candles;
        if (!candles || candles.length < 21) return { available: false };

        const closes = candles.map(c => c.c);
        const result = { available: true };

        try {
            if (typeof Indicators !== 'undefined') {
                // RSI
                const rsiS = Indicators.rsiSeries(closes, 14);
                result.rsi = rsiS.length > 0 ? rsiS[rsiS.length - 1] : null;

                // EMA trend
                const ema9s = Indicators.emaSeries(closes, 9);
                const ema21s = Indicators.emaSeries(closes, 21);
                if (ema9s.length > 0 && ema21s.length > 0) {
                    const ema9 = ema9s[ema9s.length - 1];
                    const ema21 = ema21s[ema21s.length - 1];
                    result.emaTrend = ema9 > ema21 ? 'bullish' : ema9 < ema21 ? 'bearish' : 'neutral';
                }

                // Volatility (ATR-based)
                let atrSum = 0;
                const atrPeriod = Math.min(14, candles.length - 1);
                for (let i = candles.length - atrPeriod; i < candles.length; i++) {
                    if (i > 0) {
                        const tr = Math.max(
                            candles[i].h - candles[i].l,
                            Math.abs(candles[i].h - candles[i - 1].c),
                            Math.abs(candles[i].l - candles[i - 1].c)
                        );
                        atrSum += tr;
                    }
                }
                const atr = atrSum / atrPeriod;
                const atrPct = (atr / closes[closes.length - 1]) * 100;
                result.volatility = atrPct < 1 ? 'Baja' : atrPct < 3 ? 'Normal' : 'Alta';

                // Volume ratio
                const volumes = candles.slice(-20).map(c => c.v);
                const avgVol = volumes.reduce((a, b) => a + b, 0) / volumes.length;
                result.volumeRatio = candles[candles.length - 1].v / avgVol;
            }
        } catch (e) {
            console.warn('Error getting market context:', e);
        }

        return result;
    },

    _getPerformanceMetrics(pos) {
        try {
            const history = JSON.parse(localStorage.getItem(CONFIG.STORAGE.HISTORY || 'tp_history') || '[]');
            const symbolTrades = history.filter(t => t.symbol === pos.symbol);

            if (symbolTrades.length === 0) return { hasTrades: false };

            const wins = symbolTrades.filter(t => t.pnl > 0);
            const totalPnl = symbolTrades.reduce((sum, t) => sum + t.pnl, 0);

            return {
                hasTrades: true,
                trades: symbolTrades.length,
                winRate: ((wins.length / symbolTrades.length) * 100).toFixed(0),
                totalPnl,
                avgPnl: totalPnl / symbolTrades.length
            };
        } catch (e) {
            return { hasTrades: false };
        }
    },

    _formatBotSummary(summary) {
        if (!summary) return '';
        return summary.split(', ').map(bot => {
            const [name, signal] = bot.split(':');
            const color = signal?.toLowerCase() === 'long' || signal?.toLowerCase() === 'green' || signal?.toLowerCase() === 'buy' ?
                'var(--green)' : signal?.toLowerCase() === 'short' || signal?.toLowerCase() === 'red' || signal?.toLowerCase() === 'sell' ?
                'var(--red)' : 'var(--dim)';
            return `<span style="color:${color}">${name}</span>`;
        }).join(' · ');
    },

    _getEntryMarker(pos, price) {
        const range = Math.abs(pos.tp - pos.sl);
        if (range === 0) return 50;
        if (pos.direction === 'LONG') {
            return Utils.clamp(((pos.entry - pos.sl) / range) * 100, 0, 100);
        } else {
            return Utils.clamp(((pos.sl - pos.entry) / range) * 100, 0, 100);
        }
    },

    subscribeToState() {
        State.subscribe('positions', () => this.render());
        State.subscribe('prices', () => this.updatePnL());
    },

    calculatePnL(pos, currentPrice) {
        // FIX: Solo restamos la fee de SALIDA estimada.
        // La fee de entrada ya se descontó del balance al abrir (State.updateBalance(-(margin + fee)))
        // Antes: pos.fee * 2 (doble cobro) → Ahora: solo exitFee
        const exitFee = pos.fee; // fee = size * FEE_RATE, misma para entrada y salida
        if (pos.direction === 'LONG') {
            return ((currentPrice - pos.entry) / pos.entry) * pos.size - exitFee;
        } else {
            return ((pos.entry - currentPrice) / pos.entry) * pos.size - exitFee;
        }
    },

    calculateProgress(pos, currentPrice) {
        const range = Math.abs(pos.tp - pos.sl);
        if (range === 0) return 50;
        if (pos.direction === 'LONG') {
            return Utils.clamp(((currentPrice - pos.sl) / range) * 100, 0, 100);
        } else {
            return Utils.clamp(((pos.sl - currentPrice) / range) * 100, 0, 100);
        }
    },

    _liqDistance(pos, currentPrice) {
        if (!pos.liq || !currentPrice) return 100;
        return Math.abs((currentPrice - pos.liq) / currentPrice) * 100;
    },

    _calcDuration(timestamp) {
        const ms = Date.now() - new Date(timestamp).getTime();
        const s = Math.floor(ms / 1000);
        const m = Math.floor(s / 60);
        const h = Math.floor(m / 60);
        const d = Math.floor(h / 24);
        if (d > 0) return `${d}d ${h % 24}h ${m % 60}m`;
        if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
        if (m > 0) return `${m}m ${s % 60}s`;
        return `${s}s`;
    },

    _updateTimers() {
        document.querySelectorAll('.pos-duration').forEach(el => {
            const ts = el.dataset.ts;
            if (ts) el.textContent = this._calcDuration(ts);
        });
        State.positions.forEach(pos => {
            const estEl = document.getElementById(`pos-est-${pos.id}`);
            if (estEl) {
                const est = this._estimateCloseTime(pos);
                if (this._selectedId === pos.id) {
                    estEl.textContent = `${est.time} (${est.remaining})`;
                } else {
                    estEl.textContent = `Cierre est: ${est.time} (${est.remaining})`;
                }
            }
        });
    },

    updatePnL() {
        State.positions.forEach(pos => {
            const price = State.prices[pos.symbol]?.price || pos.entry;
            const pnl = this.calculatePnL(pos, price);
            const pnlPercent = pos.margin > 0 ? (pnl / pos.margin) * 100 : 0;
            const progress = this.calculateProgress(pos, price);

            const pnlEl = document.getElementById(`pos-pnl-${pos.id}`);
            const barEl = document.getElementById(`pos-bar-${pos.id}`);
            const priceEl = document.getElementById(`pos-price-${pos.id}`);

            if (pnlEl) {
                if (this._selectedId === pos.id) {
                    pnlEl.className = `pos-detail-pnl ${pnl >= 0 ? 'profit' : 'loss'}`;
                    pnlEl.innerHTML = `${Utils.formatPnL(pnl)} <span class="pos-detail-pnl-pct">(${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%)</span>`;
                } else {
                    pnlEl.className = `pos-pnl ${pnl >= 0 ? 'profit' : 'loss'}`;
                    pnlEl.innerHTML = `${Utils.formatPnL(pnl)} <small>(${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(1)}%)</small>`;
                }
            }
            if (barEl) {
                barEl.style.width = `${progress}%`;
                barEl.style.background = pnl >= 0 ? 'var(--green)' : 'var(--red)';
            }
            if (priceEl) {
                const entryDist = ((price - pos.entry) / pos.entry * 100).toFixed(3);
                if (this._selectedId === pos.id) {
                    priceEl.innerHTML = `$${Utils.formatPrice(price)} <small>${entryDist >= 0 ? '+' : ''}${entryDist}%</small>`;
                } else {
                    priceEl.textContent = `$${Utils.formatPrice(price)}`;
                }
            }
        });
    },

    close(id) {
        if (this._confirmingClose === id) {
            this._confirmingClose = null;
            this._selectedId = null;
            Trading.closePosition(id, 'Manual');
        } else {
            this._confirmingClose = id;
            Utils.showNotification('Clickeá ✕ otra vez para confirmar', 'warning', 3000);
            setTimeout(() => {
                if (this._confirmingClose === id) this._confirmingClose = null;
            }, 3000);
        }
    }
};
