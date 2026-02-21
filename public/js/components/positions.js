/* ========================================
   POSITIONS — Ultra-Complete Position Tracker
   TheRealShortShady v7.0

   Steve Jobs Quality: Every pixel has purpose.
   Shows EVERYTHING about each position.
   ======================================== */

const Positions = {

    _confirmingClose: null,
    _timerInterval: null,
    _selectedId: null,
    _expandedSections: {},
    _liveUnsubscribe: null,

    init() {
        this.render();
        this.subscribeToState();
        this._timerInterval = setInterval(() => this._updateLive(), 1000);

        // Subscribe to LiveUpdater for real-time updates
        if (typeof LiveUpdater !== 'undefined') {
            this._liveUnsubscribe = LiveUpdater.subscribe('positions', (updates) => {
                this._applyLiveUpdates(updates);
            });
        }
    },

    // ═══════════════════════════════════════
    // MAIN RENDER
    // ═══════════════════════════════════════

    render() {
        const container = document.getElementById('positions');
        const title = document.getElementById('positionsTitle');
        if (!container) return;

        const maxPos = State.maxPositions || CONFIG.TRADING.MAX_POSITIONS;
        const positions = State.positions || [];

        if (title) {
            const totalPnl = this._getTotalPnL();
            const pnlClass = totalPnl >= 0 ? 'profit' : 'loss';
            title.innerHTML = `
                <div class="positions-header-content">
                    <span class="positions-title-main">
                        <span class="positions-icon">◈</span>
                        Posiciones
                        <span class="positions-count">${positions.length}/${maxPos}</span>
                    </span>
                    ${positions.length > 0 ? `
                        <span class="positions-total-pnl ${pnlClass}">
                            ${Utils.formatPnL(totalPnl)}
                        </span>
                    ` : ''}
                </div>
            `;
        }

        if (positions.length === 0) {
            this._selectedId = null;
            container.innerHTML = this._renderEmptyState();
            return;
        }

        if (this._selectedId && !positions.find(p => p.id === this._selectedId)) {
            this._selectedId = null;
        }

        if (this._selectedId) {
            container.innerHTML = this._renderDetailView();
        } else {
            container.innerHTML = this._renderListView(positions);
        }
    },

    _renderEmptyState() {
        return `
            <div class="positions-empty">
                <div class="positions-empty-icon">◇</div>
                <div class="positions-empty-title">Sin posiciones abiertas</div>
                <div class="positions-empty-hint">
                    Analizá un par y abrí una posición<br>
                    para verla acá en tiempo real
                </div>
            </div>
        `;
    },

    // ═══════════════════════════════════════
    // LIST VIEW
    // ═══════════════════════════════════════

    _renderListView(positions) {
        return positions.map(pos => this._renderPositionCard(pos)).join('');
    },

    _renderPositionCard(pos) {
        const price = State.prices[pos.symbol]?.price || pos.entry;
        const pnl = this._calcPnL(pos, price);
        const pnlPercent = pos.margin > 0 ? (pnl / pos.margin) * 100 : 0;
        const progress = this._calcProgress(pos, price);
        const duration = this._formatDuration(pos.timestamp);
        const dirClass = pos.direction === 'LONG' ? 'long' : 'short';
        const pnlClass = pnl >= 0 ? 'profit' : 'loss';

        // Calculate distances
        const distToTp = this._calcDist(price, pos.tp, pos.direction, 'tp');
        const distToSl = this._calcDist(price, pos.sl, pos.direction, 'sl');
        const liqDist = this._calcLiqDist(pos, price);

        // Urgency indicators
        const isNearTp = Math.abs(distToTp) < 1;
        const isNearSl = Math.abs(distToSl) < 1;
        const isNearLiq = liqDist < 5;

        return `
            <div class="pos-card ${pnlClass}" data-id="${pos.id}" onclick="Positions.select('${pos.id}')">
                <!-- Header -->
                <div class="pos-card-header">
                    <div class="pos-card-symbol">
                        <span class="pos-card-dir ${dirClass}">${pos.direction === 'LONG' ? '▲' : '▼'}</span>
                        <span class="pos-card-pair">${pos.symbol}</span>
                        <span class="pos-card-lev">${pos.leverage}x</span>
                    </div>
                    <button class="pos-card-close" onclick="event.stopPropagation(); Positions.close('${pos.id}')" title="Cerrar">✕</button>
                </div>

                <!-- P&L Hero -->
                <div class="pos-card-pnl ${pnlClass}" id="pnl-${pos.id}">
                    <span class="pos-card-pnl-value">${Utils.formatPnL(pnl)}</span>
                    <span class="pos-card-pnl-pct">${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(1)}%</span>
                </div>

                <!-- Progress Bar -->
                <div class="pos-card-progress">
                    <div class="pos-card-progress-track">
                        <div class="pos-card-progress-sl" style="left: 0"></div>
                        <div class="pos-card-progress-entry" style="left: ${this._calcEntryPos(pos)}%"></div>
                        <div class="pos-card-progress-tp" style="left: 100%"></div>
                        <div class="pos-card-progress-bar ${pnlClass}" id="bar-${pos.id}" style="width: ${progress}%"></div>
                        <div class="pos-card-progress-current" style="left: ${progress}%"></div>
                    </div>
                    <div class="pos-card-progress-labels">
                        <span class="pos-card-sl-label">SL ${distToSl}%</span>
                        <span class="pos-card-tp-label">TP ${distToTp}%</span>
                    </div>
                </div>

                <!-- Quick Stats Grid -->
                <div class="pos-card-stats">
                    <div class="pos-card-stat">
                        <span class="pos-card-stat-label">Entry</span>
                        <span class="pos-card-stat-value">$${Utils.formatPrice(pos.entry)}</span>
                    </div>
                    <div class="pos-card-stat">
                        <span class="pos-card-stat-label">Actual</span>
                        <span class="pos-card-stat-value" id="price-${pos.id}">$${Utils.formatPrice(price)}</span>
                    </div>
                    <div class="pos-card-stat">
                        <span class="pos-card-stat-label">Margen</span>
                        <span class="pos-card-stat-value">${Utils.formatCurrency(pos.margin)}</span>
                    </div>
                    <div class="pos-card-stat">
                        <span class="pos-card-stat-label">Duración</span>
                        <span class="pos-card-stat-value" id="dur-${pos.id}">${duration}</span>
                    </div>
                </div>

                <!-- Alerts -->
                ${isNearTp ? '<div class="pos-card-alert success">Cerca del TP</div>' : ''}
                ${isNearSl ? '<div class="pos-card-alert danger">Cerca del SL</div>' : ''}
                ${isNearLiq ? '<div class="pos-card-alert danger">Liquidación próxima</div>' : ''}

                <!-- Expand hint -->
                <div class="pos-card-expand-hint">Click para ver detalles completos</div>
            </div>
        `;
    },

    // ═══════════════════════════════════════
    // DETAIL VIEW - ULTRA COMPLETE
    // ═══════════════════════════════════════

    _renderDetailView() {
        const pos = State.positions.find(p => p.id === this._selectedId);
        if (!pos) return this._renderEmptyState();

        const price = State.prices[pos.symbol]?.price || pos.entry;
        const pnl = this._calcPnL(pos, price);
        const pnlPercent = pos.margin > 0 ? (pnl / pos.margin) * 100 : 0;
        const progress = this._calcProgress(pos, price);
        const dirClass = pos.direction === 'LONG' ? 'long' : 'short';
        const pnlClass = pnl >= 0 ? 'profit' : 'loss';

        // All calculations
        const data = this._calculateAllMetrics(pos, price);

        return `
            <div class="pos-detail">
                <!-- Navigation -->
                <div class="pos-detail-nav">
                    <button class="pos-detail-back" onclick="Positions.backToList()">
                        <span class="pos-detail-back-icon">←</span>
                        <span>Volver</span>
                    </button>
                    <button class="pos-detail-close-btn" onclick="Positions.close('${pos.id}')">
                        Cerrar Posición
                    </button>
                </div>

                <!-- Hero Section -->
                <div class="pos-detail-hero">
                    <div class="pos-detail-identity">
                        <span class="pos-detail-dir ${dirClass}">${pos.direction === 'LONG' ? '▲' : '▼'}</span>
                        <span class="pos-detail-symbol">${pos.symbol}USDT</span>
                        <div class="pos-detail-badges">
                            <span class="pos-badge lev">${pos.leverage}x</span>
                            <span class="pos-badge mode">${pos.mode}</span>
                            ${pos.source === 'watcher' ? '<span class="pos-badge auto">Auto</span>' : ''}
                            ${pos.tpSlMode === 'manual' ? '<span class="pos-badge manual">Manual</span>' : ''}
                        </div>
                    </div>

                    <div class="pos-detail-pnl-hero ${pnlClass}" id="pnl-detail-${pos.id}">
                        <div class="pos-detail-pnl-value">${Utils.formatPnL(pnl)}</div>
                        <div class="pos-detail-pnl-pct">${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}% ROI</div>
                    </div>
                </div>

                <!-- Master Progress Bar -->
                <div class="pos-detail-progress-container">
                    <div class="pos-detail-progress">
                        <div class="pos-detail-progress-zone sl"></div>
                        <div class="pos-detail-progress-zone tp"></div>
                        <div class="pos-detail-progress-bar ${pnlClass}" id="bar-detail-${pos.id}" style="width: ${progress}%"></div>
                        <div class="pos-detail-progress-marker entry" style="left: ${this._calcEntryPos(pos)}%">
                            <span class="marker-label">Entry</span>
                        </div>
                        <div class="pos-detail-progress-marker current" style="left: ${progress}%">
                            <span class="marker-label">Now</span>
                        </div>
                    </div>
                    <div class="pos-detail-progress-endpoints">
                        <div class="endpoint sl">
                            <span class="endpoint-label">Stop Loss</span>
                            <span class="endpoint-value">$${Utils.formatPrice(pos.sl)}</span>
                            <span class="endpoint-dist">${data.distToSl}% away</span>
                        </div>
                        <div class="endpoint tp">
                            <span class="endpoint-label">Take Profit</span>
                            <span class="endpoint-value">$${Utils.formatPrice(pos.tp)}</span>
                            <span class="endpoint-dist">${data.distToTp}% away</span>
                        </div>
                    </div>
                </div>

                <!-- Sections -->
                ${this._renderSection('prices', 'Precios', this._renderPricesSection(pos, data))}
                ${this._renderSection('capital', 'Capital & Riesgo', this._renderCapitalSection(pos, data))}
                ${this._renderSection('scenarios', 'Escenarios', this._renderScenariosSection(pos, data))}
                ${this._renderSection('time', 'Tiempo', this._renderTimeSection(pos, data))}
                ${this._renderSection('analysis', 'Análisis al Entrar', this._renderAnalysisSection(pos, data))}
                ${this._renderSection('bots', 'Estado de Bots', this._renderBotsSection(pos, data))}
                ${this._renderSection('context', 'Contexto de Mercado', this._renderContextSection(pos, data))}
                ${pos.hypothesis ? this._renderSection('hypothesis', 'Hipótesis', this._renderHypothesisSection(pos)) : ''}
                ${this._renderSection('history', 'Historial ' + pos.symbol, this._renderHistorySection(pos, data))}

                <!-- Liquidation Warning -->
                <div class="pos-detail-liq ${data.liqDist < 5 ? 'danger' : data.liqDist < 10 ? 'warning' : ''}">
                    <span class="pos-detail-liq-icon">⚠</span>
                    <span class="pos-detail-liq-label">Liquidación:</span>
                    <span class="pos-detail-liq-value">$${Utils.formatPrice(pos.liq)}</span>
                    <span class="pos-detail-liq-dist">(${data.liqDist.toFixed(1)}% away)</span>
                    ${data.liqDist < 5 ? '<span class="pos-detail-liq-alert">PELIGRO</span>' : ''}
                </div>
            </div>
        `;
    },

    _renderSection(id, title, content) {
        const isExpanded = this._expandedSections[id] !== false; // Default expanded
        return `
            <div class="pos-section ${isExpanded ? 'expanded' : ''}" data-section="${id}">
                <div class="pos-section-header" onclick="Positions.toggleSection('${id}')">
                    <span class="pos-section-title">${title}</span>
                    <span class="pos-section-toggle">${isExpanded ? '−' : '+'}</span>
                </div>
                <div class="pos-section-content">
                    ${content}
                </div>
            </div>
        `;
    },

    toggleSection(id) {
        this._expandedSections[id] = !this._expandedSections[id];
        const section = document.querySelector(`.pos-section[data-section="${id}"]`);
        if (section) {
            section.classList.toggle('expanded');
            section.querySelector('.pos-section-toggle').textContent =
                section.classList.contains('expanded') ? '−' : '+';
        }
    },

    // ═══════════════════════════════════════
    // SECTION RENDERERS
    // ═══════════════════════════════════════

    _renderPricesSection(pos, data) {
        return `
            <div class="pos-grid-4">
                <div class="pos-metric">
                    <span class="pos-metric-label">Entry</span>
                    <span class="pos-metric-value">$${Utils.formatPrice(pos.entry)}</span>
                </div>
                <div class="pos-metric">
                    <span class="pos-metric-label">Actual</span>
                    <span class="pos-metric-value highlight" id="price-detail-${pos.id}">
                        $${Utils.formatPrice(data.price)}
                        <small class="${data.entryDist >= 0 ? 'profit' : 'loss'}">${data.entryDist >= 0 ? '+' : ''}${data.entryDist}%</small>
                    </span>
                </div>
                <div class="pos-metric success">
                    <span class="pos-metric-label">Take Profit</span>
                    <span class="pos-metric-value">$${Utils.formatPrice(pos.tp)}</span>
                    <span class="pos-metric-sub">+${data.tpPct}% desde entry</span>
                </div>
                <div class="pos-metric danger">
                    <span class="pos-metric-label">Stop Loss</span>
                    <span class="pos-metric-value">$${Utils.formatPrice(pos.sl)}</span>
                    <span class="pos-metric-sub">-${data.slPct}% desde entry</span>
                </div>
            </div>
            <div class="pos-grid-2 mt">
                <div class="pos-metric">
                    <span class="pos-metric-label">Distancia a TP</span>
                    <span class="pos-metric-value success">${data.distToTp}%</span>
                </div>
                <div class="pos-metric">
                    <span class="pos-metric-label">Distancia a SL</span>
                    <span class="pos-metric-value danger">${data.distToSl}%</span>
                </div>
            </div>
        `;
    },

    _renderCapitalSection(pos, data) {
        return `
            <div class="pos-grid-4">
                <div class="pos-metric">
                    <span class="pos-metric-label">Margen</span>
                    <span class="pos-metric-value">${Utils.formatCurrency(pos.margin)}</span>
                    <span class="pos-metric-sub">${data.balancePct}% del balance</span>
                </div>
                <div class="pos-metric">
                    <span class="pos-metric-label">Size (Notional)</span>
                    <span class="pos-metric-value">${Utils.formatCurrency(pos.size)}</span>
                </div>
                <div class="pos-metric">
                    <span class="pos-metric-label">Leverage</span>
                    <span class="pos-metric-value ${pos.leverage > 50 ? 'danger' : pos.leverage > 20 ? 'warning' : ''}">${pos.leverage}x</span>
                </div>
                <div class="pos-metric">
                    <span class="pos-metric-label">R:R Ratio</span>
                    <span class="pos-metric-value ${data.rrRatio >= 2 ? 'success' : data.rrRatio >= 1.5 ? 'warning' : 'danger'}">${data.rrRatio}:1</span>
                </div>
            </div>
            <div class="pos-grid-4 mt">
                <div class="pos-metric">
                    <span class="pos-metric-label">Fee Entry</span>
                    <span class="pos-metric-value subtle">${Utils.formatCurrency(pos.fee)}</span>
                </div>
                <div class="pos-metric">
                    <span class="pos-metric-label">Fee Exit (est)</span>
                    <span class="pos-metric-value subtle">${Utils.formatCurrency(pos.fee)}</span>
                </div>
                <div class="pos-metric">
                    <span class="pos-metric-label">Total Fees</span>
                    <span class="pos-metric-value danger">${Utils.formatCurrency(data.totalFees)}</span>
                    <span class="pos-metric-sub">${data.feeImpact}% del margen</span>
                </div>
                <div class="pos-metric">
                    <span class="pos-metric-label">Breakeven</span>
                    <span class="pos-metric-value">$${Utils.formatPrice(data.breakeven)}</span>
                </div>
            </div>
            <div class="pos-grid-2 mt">
                <div class="pos-metric danger-bg">
                    <span class="pos-metric-label">Max Pérdida Posible</span>
                    <span class="pos-metric-value">${Utils.formatCurrency(data.maxLoss)}</span>
                </div>
                <div class="pos-metric">
                    <span class="pos-metric-label">% Balance en Riesgo</span>
                    <span class="pos-metric-value ${data.riskPct > 5 ? 'danger' : ''}">${data.riskPct}%</span>
                </div>
            </div>
        `;
    },

    _renderScenariosSection(pos, data) {
        return `
            <div class="pos-scenarios">
                <div class="pos-scenario success">
                    <div class="pos-scenario-header">
                        <span class="pos-scenario-icon">✓</span>
                        <span class="pos-scenario-title">Si toca Take Profit</span>
                    </div>
                    <div class="pos-scenario-pnl">${Utils.formatPnL(data.pnlAtTp)}</div>
                    <div class="pos-scenario-roi">+${data.roiAtTp}% ROI</div>
                    <div class="pos-scenario-new-balance">
                        Balance: ${Utils.formatCurrency(State.balance + pos.margin + data.pnlAtTp)}
                    </div>
                </div>
                <div class="pos-scenario danger">
                    <div class="pos-scenario-header">
                        <span class="pos-scenario-icon">✗</span>
                        <span class="pos-scenario-title">Si toca Stop Loss</span>
                    </div>
                    <div class="pos-scenario-pnl">${Utils.formatPnL(data.pnlAtSl)}</div>
                    <div class="pos-scenario-roi">${data.roiAtSl}% ROI</div>
                    <div class="pos-scenario-new-balance">
                        Balance: ${Utils.formatCurrency(State.balance + pos.margin + data.pnlAtSl)}
                    </div>
                </div>
            </div>
            <div class="pos-scenario-current">
                <span class="pos-scenario-current-label">Ganancia actual si cierro ahora:</span>
                <span class="pos-scenario-current-value ${data.pnl >= 0 ? 'success' : 'danger'}">${Utils.formatPnL(data.pnl)}</span>
            </div>
        `;
    },

    _renderTimeSection(pos, data) {
        return `
            <div class="pos-grid-4">
                <div class="pos-metric">
                    <span class="pos-metric-label">Abierta</span>
                    <span class="pos-metric-value">${data.openTime}</span>
                    <span class="pos-metric-sub">${data.openDate}</span>
                </div>
                <div class="pos-metric">
                    <span class="pos-metric-label">Duración</span>
                    <span class="pos-metric-value highlight" id="dur-detail-${pos.id}">${data.duration}</span>
                </div>
                <div class="pos-metric">
                    <span class="pos-metric-label">Cierre Estimado</span>
                    <span class="pos-metric-value">${data.estCloseTime}</span>
                    <span class="pos-metric-sub">${data.estRemaining}</span>
                </div>
                <div class="pos-metric">
                    <span class="pos-metric-label">Timeframe</span>
                    <span class="pos-metric-value">${pos.timeframe || State.timeframe}</span>
                </div>
            </div>
            <div class="pos-time-visual">
                <div class="pos-time-bar">
                    <div class="pos-time-elapsed" style="width: ${data.timeProgress}%"></div>
                </div>
                <div class="pos-time-labels">
                    <span>Inicio</span>
                    <span>${data.timeProgress.toFixed(0)}% del tiempo estimado</span>
                    <span>Cierre est.</span>
                </div>
            </div>
        `;
    },

    _renderAnalysisSection(pos, data) {
        return `
            <div class="pos-grid-4">
                <div class="pos-metric">
                    <span class="pos-metric-label">Confianza</span>
                    <span class="pos-metric-value">
                        <span class="confidence-badge ${data.confClass}">${pos.confidence || 0}%</span>
                    </span>
                </div>
                <div class="pos-metric">
                    <span class="pos-metric-label">Decisión</span>
                    <span class="pos-metric-value success">ENTER</span>
                </div>
                <div class="pos-metric">
                    <span class="pos-metric-label">Origen</span>
                    <span class="pos-metric-value">${pos.source === 'watcher' ? '🤖 Auto-Watcher' : '👤 Manual'}</span>
                </div>
                <div class="pos-metric">
                    <span class="pos-metric-label">TP/SL Mode</span>
                    <span class="pos-metric-value">${pos.tpSlMode === 'manual' ? 'Manual' : 'Auto'}</span>
                </div>
            </div>
            ${pos.botSummary ? `
                <div class="pos-bots-at-entry">
                    <span class="pos-bots-label">Bots al entrar:</span>
                    <span class="pos-bots-list">${this._formatBotSummary(pos.botSummary)}</span>
                </div>
            ` : ''}
        `;
    },

    _renderBotsSection(pos, data) {
        const masterBotsStatus = typeof LiveUpdater !== 'undefined' ?
            LiveUpdater.getMasterBotsStatus() : null;

        if (!masterBotsStatus || !masterBotsStatus.bots || masterBotsStatus.bots.length === 0) {
            return `
                <div class="pos-bots-empty">
                    <span>Analizando estado actual de bots...</span>
                </div>
            `;
        }

        const botsHtml = masterBotsStatus.bots.map(bot => {
            const signalClass = bot.signal === 'bullish' ? 'success' :
                               bot.signal === 'bearish' ? 'danger' : 'neutral';
            const icon = bot.signal === 'bullish' ? '✓' :
                        bot.signal === 'bearish' ? '✗' : '○';

            // Check if bot still supports the position
            const stillValid = (pos.direction === 'LONG' && bot.signal === 'bullish') ||
                              (pos.direction === 'SHORT' && bot.signal === 'bearish');
            const validClass = stillValid ? 'valid' : (bot.signal === 'neutral' ? 'neutral' : 'invalid');

            return `
                <div class="pos-bot-live ${validClass}">
                    <span class="pos-bot-icon ${signalClass}">${icon}</span>
                    <span class="pos-bot-name">${bot.name}</span>
                    <span class="pos-bot-score">${bot.score}%</span>
                    <span class="pos-bot-status">${stillValid ? 'Válido' : (bot.signal === 'neutral' ? 'Neutral' : 'Cambió')}</span>
                </div>
            `;
        }).join('');

        const consensus = masterBotsStatus.consensus;
        const consensusClass = consensus === 'bullish' ? 'success' :
                              consensus === 'bearish' ? 'danger' : 'neutral';

        return `
            <div class="pos-bots-consensus ${consensusClass}">
                <span class="pos-bots-consensus-label">Consenso actual:</span>
                <span class="pos-bots-consensus-value">${masterBotsStatus.consensusPercent}% ${consensus === 'bullish' ? 'LONG' : consensus === 'bearish' ? 'SHORT' : 'NEUTRAL'}</span>
            </div>
            <div class="pos-bots-grid">
                ${botsHtml}
            </div>
            <div class="pos-bots-update">
                Última actualización: ${this._formatTimeAgo(masterBotsStatus.lastUpdate)}
            </div>
        `;
    },

    _renderContextSection(pos, data) {
        return `
            <div class="pos-grid-4">
                <div class="pos-metric">
                    <span class="pos-metric-label">RSI</span>
                    <span class="pos-metric-value ${data.rsi > 70 ? 'danger' : data.rsi < 30 ? 'success' : ''}">${data.rsi?.toFixed(1) || '—'}</span>
                </div>
                <div class="pos-metric">
                    <span class="pos-metric-label">EMA Trend</span>
                    <span class="pos-metric-value ${data.emaTrend === 'bullish' ? 'success' : data.emaTrend === 'bearish' ? 'danger' : ''}">${data.emaTrend || '—'}</span>
                </div>
                <div class="pos-metric">
                    <span class="pos-metric-label">Volatilidad</span>
                    <span class="pos-metric-value">${data.volatility || '—'}</span>
                </div>
                <div class="pos-metric">
                    <span class="pos-metric-label">Vol. Ratio</span>
                    <span class="pos-metric-value">${data.volumeRatio?.toFixed(2) || '—'}x</span>
                </div>
            </div>
        `;
    },

    _renderHypothesisSection(pos) {
        return `
            <div class="pos-hypothesis">
                <div class="pos-hypothesis-quote">"${pos.hypothesis}"</div>
            </div>
        `;
    },

    _renderHistorySection(pos, data) {
        if (!data.history.hasTrades) {
            return `
                <div class="pos-history-empty">
                    Primera vez tradeando ${pos.symbol}
                </div>
            `;
        }

        return `
            <div class="pos-grid-4">
                <div class="pos-metric">
                    <span class="pos-metric-label">Trades</span>
                    <span class="pos-metric-value">${data.history.trades}</span>
                </div>
                <div class="pos-metric">
                    <span class="pos-metric-label">Win Rate</span>
                    <span class="pos-metric-value ${data.history.winRate >= 50 ? 'success' : 'danger'}">${data.history.winRate}%</span>
                </div>
                <div class="pos-metric">
                    <span class="pos-metric-label">Total P&L</span>
                    <span class="pos-metric-value ${data.history.totalPnl >= 0 ? 'success' : 'danger'}">${Utils.formatPnL(data.history.totalPnl)}</span>
                </div>
                <div class="pos-metric">
                    <span class="pos-metric-label">Promedio</span>
                    <span class="pos-metric-value ${data.history.avgPnl >= 0 ? 'success' : 'danger'}">${Utils.formatPnL(data.history.avgPnl)}</span>
                </div>
            </div>
        `;
    },

    // ═══════════════════════════════════════
    // CALCULATIONS
    // ═══════════════════════════════════════

    _calculateAllMetrics(pos, price) {
        const pnl = this._calcPnL(pos, price);
        const pnlAtTp = this._calcPnL(pos, pos.tp);
        const pnlAtSl = this._calcPnL(pos, pos.sl);
        const balance = State.balance || 10000;
        const totalFees = pos.fee * 2;

        // Distances
        const tpPct = ((Math.abs(pos.tp - pos.entry) / pos.entry) * 100).toFixed(2);
        const slPct = ((Math.abs(pos.sl - pos.entry) / pos.entry) * 100).toFixed(2);
        const distToTp = this._calcDist(price, pos.tp, pos.direction, 'tp');
        const distToSl = this._calcDist(price, pos.sl, pos.direction, 'sl');
        const entryDist = ((price - pos.entry) / pos.entry * 100).toFixed(2);

        // Liquidation
        const liqDist = this._calcLiqDist(pos, price);

        // Capital
        const balancePct = ((pos.margin / balance) * 100).toFixed(1);
        const feeImpact = ((totalFees / pos.margin) * 100).toFixed(2);
        const breakeven = pos.direction === 'LONG' ?
            pos.entry * (1 + (pos.fee * 2) / pos.size) :
            pos.entry * (1 - (pos.fee * 2) / pos.size);
        const maxLoss = Math.abs(pnlAtSl);
        const riskPct = ((maxLoss / balance) * 100).toFixed(2);
        const rrRatio = pos.rrRatio || (Math.abs(pos.tp - pos.entry) / Math.abs(pos.sl - pos.entry)).toFixed(2);

        // Scenarios
        const roiAtTp = ((pnlAtTp / pos.margin) * 100).toFixed(1);
        const roiAtSl = ((pnlAtSl / pos.margin) * 100).toFixed(1);

        // Time
        const openDate = this._formatDate(pos.timestamp);
        const openTime = this._formatTime(pos.timestamp);
        const duration = this._formatDuration(pos.timestamp);
        const estClose = this._estimateCloseTime(pos);
        const timeProgress = this._calcTimeProgress(pos);

        // Market context
        const context = this._getMarketContext();

        // History
        const history = this._getSymbolHistory(pos.symbol);

        // Confidence class
        const confClass = pos.confidence >= 70 ? 'high' : pos.confidence >= 50 ? 'medium' : 'low';

        return {
            price,
            pnl,
            pnlAtTp,
            pnlAtSl,
            tpPct,
            slPct,
            distToTp,
            distToSl,
            entryDist,
            liqDist,
            balancePct,
            feeImpact,
            totalFees,
            breakeven,
            maxLoss,
            riskPct,
            rrRatio,
            roiAtTp,
            roiAtSl,
            openDate,
            openTime,
            duration,
            estCloseTime: estClose.time,
            estRemaining: estClose.remaining,
            timeProgress,
            ...context,
            history,
            confClass,
        };
    },

    _calcPnL(pos, currentPrice) {
        const exitFee = pos.fee;
        if (pos.direction === 'LONG') {
            return ((currentPrice - pos.entry) / pos.entry) * pos.size - exitFee;
        } else {
            return ((pos.entry - currentPrice) / pos.entry) * pos.size - exitFee;
        }
    },

    _calcProgress(pos, currentPrice) {
        const range = Math.abs(pos.tp - pos.sl);
        if (range === 0) return 50;
        if (pos.direction === 'LONG') {
            return Math.max(0, Math.min(100, ((currentPrice - pos.sl) / range) * 100));
        } else {
            return Math.max(0, Math.min(100, ((pos.sl - currentPrice) / range) * 100));
        }
    },

    _calcEntryPos(pos) {
        const range = Math.abs(pos.tp - pos.sl);
        if (range === 0) return 50;
        if (pos.direction === 'LONG') {
            return Math.max(0, Math.min(100, ((pos.entry - pos.sl) / range) * 100));
        } else {
            return Math.max(0, Math.min(100, ((pos.sl - pos.entry) / range) * 100));
        }
    },

    _calcDist(price, target, direction, type) {
        const dist = ((target - price) / price * 100);
        return Math.abs(dist).toFixed(2);
    },

    _calcLiqDist(pos, price) {
        if (!pos.liq) return 100;
        return Math.abs((price - pos.liq) / price * 100);
    },

    _getTotalPnL() {
        let total = 0;
        (State.positions || []).forEach(pos => {
            const price = State.prices[pos.symbol]?.price || pos.entry;
            total += this._calcPnL(pos, price);
        });
        return total;
    },

    _formatDuration(timestamp) {
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

    _formatDate(timestamp) {
        return new Date(timestamp).toLocaleDateString('es-AR', {
            day: '2-digit', month: 'short'
        });
    },

    _formatTime(timestamp) {
        return new Date(timestamp).toLocaleTimeString('es-AR', {
            hour: '2-digit', minute: '2-digit'
        });
    },

    _formatTimeAgo(timestamp) {
        if (!timestamp) return 'Nunca';
        const seconds = Math.floor((Date.now() - timestamp) / 1000);
        if (seconds < 60) return `hace ${seconds}s`;
        if (seconds < 3600) return `hace ${Math.floor(seconds / 60)}m`;
        return `hace ${Math.floor(seconds / 3600)}h`;
    },

    _estimateCloseTime(pos) {
        const modeEstimates = {
            scalping: { min: 1, max: 5 },
            scalp: { min: 1, max: 5 },
            intraday: { min: 30, max: 240 },
            intra: { min: 30, max: 240 },
            swing: { min: 240, max: 4320 },
            position: { min: 1440, max: 30240 }
        };

        const est = modeEstimates[pos.mode] || modeEstimates.intraday;
        const price = State.prices[pos.symbol]?.price || pos.entry;
        const totalRange = Math.abs(pos.tp - pos.sl);

        let progressRatio = 0.5;
        if (totalRange > 0) {
            progressRatio = pos.direction === 'LONG' ?
                (price - pos.sl) / totalRange :
                (pos.sl - price) / totalRange;
        }
        progressRatio = Math.max(0.05, Math.min(0.95, progressRatio));

        const remainRatio = 1 - progressRatio;
        const midMinutes = (est.min + est.max) / 2;
        const estMinutes = midMinutes * remainRatio;
        const elapsed = (Date.now() - new Date(pos.timestamp).getTime()) / 60000;
        const remaining = Math.max(1, estMinutes - elapsed * 0.3);

        const closeAt = new Date(Date.now() + remaining * 60000);
        const time = closeAt.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

        let remStr;
        if (remaining < 60) remStr = `~${Math.round(remaining)}m`;
        else if (remaining < 1440) remStr = `~${Math.round(remaining / 60)}h`;
        else remStr = `~${Math.round(remaining / 1440)}d`;

        return { time, remaining: remStr, minutes: remaining };
    },

    _calcTimeProgress(pos) {
        const modeEstimates = {
            scalping: 3, scalp: 3, intraday: 135, intra: 135, swing: 2280, position: 15840
        };
        const expected = (modeEstimates[pos.mode] || 135) * 60000;
        const elapsed = Date.now() - new Date(pos.timestamp).getTime();
        return Math.min(100, (elapsed / expected) * 100);
    },

    _getMarketContext() {
        const candles = State.candles;
        if (!candles || candles.length < 21) return { rsi: null, emaTrend: null, volatility: null, volumeRatio: null };

        const closes = candles.map(c => c.c);
        const result = {};

        try {
            if (typeof Indicators !== 'undefined') {
                const rsiS = Indicators.rsiSeries(closes, 14);
                result.rsi = rsiS.length > 0 ? rsiS[rsiS.length - 1] : null;

                const ema9s = Indicators.emaSeries(closes, 9);
                const ema21s = Indicators.emaSeries(closes, 21);
                if (ema9s.length > 0 && ema21s.length > 0) {
                    const ema9 = ema9s[ema9s.length - 1];
                    const ema21 = ema21s[ema21s.length - 1];
                    result.emaTrend = ema9 > ema21 ? 'Alcista' : ema9 < ema21 ? 'Bajista' : 'Neutral';
                }

                // Volatility
                let atrSum = 0;
                for (let i = candles.length - 14; i < candles.length; i++) {
                    if (i > 0) {
                        const tr = Math.max(
                            candles[i].h - candles[i].l,
                            Math.abs(candles[i].h - candles[i - 1].c),
                            Math.abs(candles[i].l - candles[i - 1].c)
                        );
                        atrSum += tr;
                    }
                }
                const atr = atrSum / 14;
                const atrPct = (atr / closes[closes.length - 1]) * 100;
                result.volatility = atrPct < 1 ? 'Baja' : atrPct < 3 ? 'Normal' : 'Alta';

                // Volume
                const volumes = candles.slice(-20).map(c => c.v);
                const avgVol = volumes.reduce((a, b) => a + b, 0) / volumes.length;
                result.volumeRatio = candles[candles.length - 1].v / avgVol;
            }
        } catch (e) { }

        return result;
    },

    _getSymbolHistory(symbol) {
        try {
            const history = JSON.parse(localStorage.getItem(CONFIG.STORAGE.HISTORY || 'tp_history') || '[]');
            const symbolTrades = history.filter(t => t.symbol === symbol);
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
            const s = (signal || '').toLowerCase();
            const color = ['long', 'green', 'buy'].includes(s) ? 'success' :
                         ['short', 'red', 'sell'].includes(s) ? 'danger' : 'neutral';
            return `<span class="${color}">${name}</span>`;
        }).join(' · ');
    },

    // ═══════════════════════════════════════
    // LIVE UPDATES
    // ═══════════════════════════════════════

    _updateLive() {
        (State.positions || []).forEach(pos => {
            const durEl = document.getElementById(`dur-${pos.id}`);
            const durDetailEl = document.getElementById(`dur-detail-${pos.id}`);
            const duration = this._formatDuration(pos.timestamp);
            if (durEl) durEl.textContent = duration;
            if (durDetailEl) durDetailEl.textContent = duration;
        });
    },

    _applyLiveUpdates(updates) {
        updates.forEach(update => {
            // Card view updates
            const pnlEl = document.getElementById(`pnl-${update.id}`);
            const priceEl = document.getElementById(`price-${update.id}`);
            const barEl = document.getElementById(`bar-${update.id}`);

            if (pnlEl) {
                const pnlClass = update.pnl >= 0 ? 'profit' : 'loss';
                pnlEl.className = `pos-card-pnl ${pnlClass}`;
                pnlEl.innerHTML = `
                    <span class="pos-card-pnl-value">${Utils.formatPnL(update.pnl)}</span>
                    <span class="pos-card-pnl-pct">${update.pnlPercent >= 0 ? '+' : ''}${update.pnlPercent.toFixed(1)}%</span>
                `;
            }
            if (priceEl) priceEl.textContent = `$${Utils.formatPrice(update.price)}`;
            if (barEl) {
                barEl.style.width = `${update.progress}%`;
                barEl.className = `pos-card-progress-bar ${update.pnl >= 0 ? 'profit' : 'loss'}`;
            }

            // Detail view updates
            const pnlDetailEl = document.getElementById(`pnl-detail-${update.id}`);
            const priceDetailEl = document.getElementById(`price-detail-${update.id}`);
            const barDetailEl = document.getElementById(`bar-detail-${update.id}`);

            if (pnlDetailEl) {
                const pnlClass = update.pnl >= 0 ? 'profit' : 'loss';
                pnlDetailEl.className = `pos-detail-pnl-hero ${pnlClass}`;
                pnlDetailEl.innerHTML = `
                    <div class="pos-detail-pnl-value">${Utils.formatPnL(update.pnl)}</div>
                    <div class="pos-detail-pnl-pct">${update.pnlPercent >= 0 ? '+' : ''}${update.pnlPercent.toFixed(2)}% ROI</div>
                `;
            }
            if (priceDetailEl) {
                const pos = State.positions.find(p => p.id === update.id);
                if (pos) {
                    const entryDist = ((update.price - pos.entry) / pos.entry * 100).toFixed(2);
                    priceDetailEl.innerHTML = `$${Utils.formatPrice(update.price)} <small class="${entryDist >= 0 ? 'profit' : 'loss'}">${entryDist >= 0 ? '+' : ''}${entryDist}%</small>`;
                }
            }
            if (barDetailEl) {
                barDetailEl.style.width = `${update.progress}%`;
                barDetailEl.className = `pos-detail-progress-bar ${update.pnl >= 0 ? 'profit' : 'loss'}`;
            }
        });
    },

    // ═══════════════════════════════════════
    // ACTIONS
    // ═══════════════════════════════════════

    select(id) {
        this._selectedId = id;
        this._expandedSections = {}; // Reset expansions
        this.render();
    },

    backToList() {
        this._selectedId = null;
        this.render();
    },

    close(id) {
        if (this._confirmingClose === id) {
            this._confirmingClose = null;
            this._selectedId = null;
            Trading.closePosition(id, 'Manual');
        } else {
            this._confirmingClose = id;
            Utils.showNotification('Click otra vez para confirmar cierre', 'warning', 3000);
            setTimeout(() => {
                if (this._confirmingClose === id) this._confirmingClose = null;
            }, 3000);
        }
    },

    subscribeToState() {
        State.subscribe('positions', () => this.render());
        State.subscribe('prices', () => {
            // Light update for prices only
            if (!this._selectedId) {
                (State.positions || []).forEach(pos => {
                    const price = State.prices[pos.symbol]?.price || pos.entry;
                    const pnl = this._calcPnL(pos, price);
                    const pnlPercent = pos.margin > 0 ? (pnl / pos.margin) * 100 : 0;
                    const progress = this._calcProgress(pos, price);

                    const pnlEl = document.getElementById(`pnl-${pos.id}`);
                    const priceEl = document.getElementById(`price-${pos.id}`);
                    const barEl = document.getElementById(`bar-${pos.id}`);

                    if (pnlEl) {
                        const pnlClass = pnl >= 0 ? 'profit' : 'loss';
                        pnlEl.className = `pos-card-pnl ${pnlClass}`;
                        pnlEl.innerHTML = `
                            <span class="pos-card-pnl-value">${Utils.formatPnL(pnl)}</span>
                            <span class="pos-card-pnl-pct">${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(1)}%</span>
                        `;
                    }
                    if (priceEl) priceEl.textContent = `$${Utils.formatPrice(price)}`;
                    if (barEl) {
                        barEl.style.width = `${progress}%`;
                        barEl.className = `pos-card-progress-bar ${pnl >= 0 ? 'profit' : 'loss'}`;
                    }
                });
            }
        });
    }
};
