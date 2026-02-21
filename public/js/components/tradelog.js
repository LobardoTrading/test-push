/* ========================================
   TRADE LOG — History & Auto-Learning
   TheRealShortShady v3.0
   ======================================== */

const TradeLog = {

    _filter: 'all',
    _sourceFilter: 'all',
    _expanded: null,

    init() {
        this.render();
        State.subscribe('tradeHistory', () => this.render());
    },

    _getHistory() {
        try {
            return JSON.parse(localStorage.getItem(CONFIG.STORAGE.HISTORY || 'tp_history') || '[]');
        } catch (e) { return []; }
    },

    _formatBsAs(isoStr) {
        try {
            return new Date(isoStr).toLocaleString('es-AR', {
                timeZone: 'America/Argentina/Buenos_Aires',
                day: '2-digit', month: '2-digit',
                hour: '2-digit', minute: '2-digit'
            });
        } catch (e) {
            return new Date(isoStr).toLocaleString('es-AR');
        }
    },

    render() {
        const container = document.getElementById('tradeLog');
        if (!container) return;

        const history = this._getHistory();

        if (history.length === 0) {
            container.innerHTML = `
                <div class="log-empty">
                    Sin trades registrados.<br>
                    <small>Los trades cerrados aparecerán acá para auto-learning.</small>
                </div>
            `;
            return;
        }

        const stats = Trading.getStats();
        const winRateColor = stats.winRate >= 55 ? 'var(--green)' : stats.winRate >= 45 ? 'var(--yellow)' : 'var(--red)';
        const pfColor = parseFloat(stats.profitFactor) >= 1.5 ? 'var(--green)' : parseFloat(stats.profitFactor) >= 1 ? 'var(--yellow)' : 'var(--red)';
        const insights = this._generateInsights(history);

        // Count by source
        const manualCount = history.filter(t => t.source !== 'watcher').length;
        const watcherCount = history.filter(t => t.source === 'watcher').length;

        // Apply filters
        let filtered = [...history];
        if (this._filter === 'wins') filtered = filtered.filter(t => t.pnl > 0);
        else if (this._filter === 'losses') filtered = filtered.filter(t => t.pnl <= 0);

        if (this._sourceFilter === 'manual') filtered = filtered.filter(t => t.source !== 'watcher');
        else if (this._sourceFilter === 'watcher') filtered = filtered.filter(t => t.source === 'watcher');

        const reversed = filtered.reverse();

        // Source-specific stats
        const sourceStats = this._getSourceStats(history);

        container.innerHTML = `
            <div class="log-stats">
                <div class="log-stat">
                    <span class="log-stat-label">Trades</span>
                    <span class="log-stat-value">${stats.trades}</span>
                </div>
                <div class="log-stat">
                    <span class="log-stat-label">Win Rate</span>
                    <span class="log-stat-value" style="color:${winRateColor}">${stats.winRate}%</span>
                </div>
                <div class="log-stat">
                    <span class="log-stat-label">PnL Total</span>
                    <span class="log-stat-value" style="color:${stats.totalPnl >= 0 ? 'var(--green)' : 'var(--red)'}">${Utils.formatPnL(stats.totalPnl)}</span>
                </div>
                <div class="log-stat">
                    <span class="log-stat-label">Profit Factor</span>
                    <span class="log-stat-value" style="color:${pfColor}">${stats.profitFactor}</span>
                </div>
            </div>

            ${sourceStats}

            ${insights ? `<div class="log-insights">${insights}</div>` : ''}

            <div class="log-toolbar">
                <div class="log-filters">
                    <button class="log-filter-btn ${this._filter === 'all' ? 'active' : ''}"
                            onclick="TradeLog.setFilter('all')">Todos (${history.length})</button>
                    <button class="log-filter-btn ${this._filter === 'wins' ? 'active' : ''}"
                            onclick="TradeLog.setFilter('wins')">Wins</button>
                    <button class="log-filter-btn ${this._filter === 'losses' ? 'active' : ''}"
                            onclick="TradeLog.setFilter('losses')">Losses</button>
                </div>
                <div class="log-export-btns">
                    <button class="log-export-btn" onclick="TradeLog.exportJSON()" title="Exportar JSON">JSON</button>
                    <button class="log-export-btn" onclick="TradeLog.exportCSV()" title="Exportar CSV">CSV</button>
                </div>
            </div>

            ${(manualCount > 0 && watcherCount > 0) ? `
                <div class="log-source-filters">
                    <button class="log-source-btn ${this._sourceFilter === 'all' ? 'active' : ''}"
                            onclick="TradeLog.setSourceFilter('all')">Todos</button>
                    <button class="log-source-btn ${this._sourceFilter === 'manual' ? 'active' : ''}"
                            onclick="TradeLog.setSourceFilter('manual')">🖱 Manual (${manualCount})</button>
                    <button class="log-source-btn ${this._sourceFilter === 'watcher' ? 'active' : ''}"
                            onclick="TradeLog.setSourceFilter('watcher')">👁 Watcher (${watcherCount})</button>
                </div>
            ` : ''}

            <div class="log-list">
                ${reversed.slice(0, 50).map(t => this._renderTrade(t)).join('')}
            </div>
        `;
    },

    setFilter(filter) {
        this._filter = filter;
        this.render();
    },

    setSourceFilter(filter) {
        this._sourceFilter = filter;
        this.render();
    },

    toggleExpand(id) {
        this._expanded = this._expanded === id ? null : id;
        this.render();
    },

    /** Source-specific stats comparison */
    _getSourceStats(history) {
        const manual = history.filter(t => t.source !== 'watcher');
        const watcher = history.filter(t => t.source === 'watcher');

        if (manual.length === 0 || watcher.length === 0) return '';

        const mWins = manual.filter(t => t.pnl > 0).length;
        const mWR = ((mWins / manual.length) * 100).toFixed(0);
        const mPnl = manual.reduce((s, t) => s + t.pnl, 0);

        const wWins = watcher.filter(t => t.pnl > 0).length;
        const wWR = ((wWins / watcher.length) * 100).toFixed(0);
        const wPnl = watcher.reduce((s, t) => s + t.pnl, 0);

        return `
            <div class="log-source-compare">
                <div class="log-source-col">
                    <div class="log-source-title">🖱 Manual</div>
                    <div class="log-source-stats">
                        <span>${manual.length} trades</span>
                        <span style="color:${mWR >= 50 ? 'var(--green)' : 'var(--red)'}">${mWR}% WR</span>
                        <span style="color:${mPnl >= 0 ? 'var(--green)' : 'var(--red)'}">${Utils.formatPnL(mPnl)}</span>
                    </div>
                </div>
                <div class="log-source-vs">vs</div>
                <div class="log-source-col">
                    <div class="log-source-title">👁 Watcher</div>
                    <div class="log-source-stats">
                        <span>${watcher.length} trades</span>
                        <span style="color:${wWR >= 50 ? 'var(--green)' : 'var(--red)'}">${wWR}% WR</span>
                        <span style="color:${wPnl >= 0 ? 'var(--green)' : 'var(--red)'}">${Utils.formatPnL(wPnl)}</span>
                    </div>
                </div>
            </div>
        `;
    },

    _renderTrade(t) {
        const isWin = t.pnl > 0;
        const pnlColor = isWin ? 'var(--green)' : 'var(--red)';
        const dirIcon = t.direction === 'LONG' ? '▲' : '▼';
        const dirColor = t.direction === 'LONG' ? 'var(--green)' : 'var(--red)';
        const tradeId = t.id || t.timestamp;
        const isExpanded = this._expanded === tradeId;
        const hasNotes = t.hypothesis || t.conclusion;
        const isWatcher = t.source === 'watcher';

        return `
            <div class="log-item ${isWin ? 'win' : 'loss'} ${isExpanded ? 'expanded' : ''} ${isWatcher ? 'watcher-trade' : ''}"
                 onclick="TradeLog.toggleExpand('${tradeId}')">
                <div class="log-item-header">
                    <span style="color:${dirColor}; font-weight:700; font-size:12px;">
                        ${dirIcon} ${t.symbol} ${t.direction}
                        ${isWatcher ? '<span class="log-source-badge watcher">👁</span>' : ''}
                        ${hasNotes ? '<span class="log-has-notes" title="Tiene hipótesis/conclusión">📝</span>' : ''}
                    </span>
                    <span class="log-item-pnl" style="color:${pnlColor}">
                        ${Utils.formatPnL(t.pnl)} (${t.pnlPercent >= 0 ? '+' : ''}${t.pnlPercent}%)
                    </span>
                </div>
                <div class="log-item-details">
                    <span>E: $${Utils.formatPrice(t.entry)}</span>
                    <span>X: $${Utils.formatPrice(t.exitPrice)}</span>
                    <span>${t.leverage}x</span>
                    <span>${t.duration || '--'}</span>
                </div>
                <div class="log-item-meta">
                    <span>${t.reason || 'Manual'}${t.tpSlMode === 'manual' ? ' · TP/SL Manual' : ''}</span>
                    <span>${this._formatBsAs(t.closedAt || t.timestamp)}</span>
                </div>
                ${isExpanded ? this._renderTradeDetail(t) : ''}
            </div>
        `;
    },

    _renderTradeDetail(t) {
        const isWatcher = t.source === 'watcher';

        return `
            <div class="log-item-expanded" onclick="event.stopPropagation()">
                ${isWatcher ? `
                    <div class="log-note-block" style="border-left-color: var(--gold)">
                        <div class="log-note-label">👁 Entrada automática (Watcher)</div>
                    </div>
                ` : ''}
                ${t.hypothesis ? `
                    <div class="log-note-block">
                        <div class="log-note-label">📝 Hipótesis</div>
                        <div class="log-note-text">${this._escapeHtml(t.hypothesis)}</div>
                    </div>
                ` : ''}
                ${t.conclusion ? `
                    <div class="log-note-block">
                        <div class="log-note-label">${t.pnl >= 0 ? '✅' : '❌'} Conclusión</div>
                        <div class="log-note-text">${this._escapeHtml(t.conclusion)}</div>
                    </div>
                ` : ''}
                ${!t.hypothesis && !t.conclusion && !isWatcher ? `
                    <div class="log-note-block">
                        <div class="log-note-text" style="color:var(--dim); font-style:italic">Sin notas para este trade</div>
                    </div>
                ` : ''}
                <div class="log-detail-grid">
                    <div class="log-detail-item">
                        <span class="log-detail-label">Modo</span>
                        <span class="log-detail-value">${t.mode || '--'}</span>
                    </div>
                    <div class="log-detail-item">
                        <span class="log-detail-label">TF</span>
                        <span class="log-detail-value">${t.timeframe || '--'}</span>
                    </div>
                    <div class="log-detail-item">
                        <span class="log-detail-label">Confianza</span>
                        <span class="log-detail-value">${t.confidence || '--'}%</span>
                    </div>
                    <div class="log-detail-item">
                        <span class="log-detail-label">R:R</span>
                        <span class="log-detail-value">${t.rrRatio || '--'}</span>
                    </div>
                    <div class="log-detail-item">
                        <span class="log-detail-label">TP</span>
                        <span class="log-detail-value" style="color:var(--green)">$${Utils.formatPrice(t.tp)}</span>
                    </div>
                    <div class="log-detail-item">
                        <span class="log-detail-label">SL</span>
                        <span class="log-detail-value" style="color:var(--red)">$${Utils.formatPrice(t.sl)}</span>
                    </div>
                    <div class="log-detail-item">
                        <span class="log-detail-label">Margen</span>
                        <span class="log-detail-value">${Utils.formatCurrency(t.margin)}</span>
                    </div>
                    <div class="log-detail-item">
                        <span class="log-detail-label">Fuente</span>
                        <span class="log-detail-value">${isWatcher ? '👁 Auto' : '🖱 Manual'}</span>
                    </div>
                </div>
                ${t.botSummary ? `
                    <div class="log-bots-summary">
                        <span class="log-detail-label">Bots:</span> ${t.botSummary}
                    </div>
                ` : ''}
            </div>
        `;
    },

    _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    // === EXPORT ===

    exportJSON() {
        const history = this._getHistory();
        if (history.length === 0) {
            Utils.showNotification('No hay trades para exportar', 'warning');
            return;
        }

        const manual = history.filter(t => t.source !== 'watcher');
        const watcher = history.filter(t => t.source === 'watcher');

        const data = {
            exported: new Date().toISOString(),
            platform: 'TheRealShortShady v3.0',
            totalTrades: history.length,
            stats: Trading.getStats(),
            breakdown: {
                manual: { count: manual.length, pnl: manual.reduce((s, t) => s + t.pnl, 0) },
                watcher: { count: watcher.length, pnl: watcher.reduce((s, t) => s + t.pnl, 0) }
            },
            trades: history
        };

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `trades_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);

        Utils.showNotification(`Exportado: ${history.length} trades (JSON)`, 'success');
    },

    exportCSV() {
        const history = this._getHistory();
        if (history.length === 0) {
            Utils.showNotification('No hay trades para exportar', 'warning');
            return;
        }

        const headers = [
            'symbol', 'direction', 'mode', 'timeframe', 'leverage',
            'entry', 'exitPrice', 'tp', 'sl', 'tpSlMode',
            'margin', 'size', 'fee', 'pnl', 'pnlPercent', 'rrRatio',
            'confidence', 'reason', 'duration', 'source',
            'hypothesis', 'conclusion', 'botSummary',
            'timestamp', 'closedAt'
        ];

        const csvRows = [headers.join(',')];

        history.forEach(t => {
            const row = headers.map(h => {
                let val = t[h] !== undefined ? t[h] : '';
                if (typeof val === 'string' && (val.includes(',') || val.includes('"') || val.includes('\n'))) {
                    val = `"${val.replace(/"/g, '""')}"`;
                }
                return val;
            });
            csvRows.push(row.join(','));
        });

        const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `trades_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);

        Utils.showNotification(`Exportado: ${history.length} trades (CSV)`, 'success');
    },

    // === INSIGHTS ===

    _generateInsights(history) {
        if (history.length < 3) return '';

        const parts = [];

        const bySymbol = {};
        history.forEach(t => {
            if (!bySymbol[t.symbol]) bySymbol[t.symbol] = { wins: 0, total: 0, pnl: 0 };
            bySymbol[t.symbol].total++;
            bySymbol[t.symbol].pnl += t.pnl;
            if (t.pnl > 0) bySymbol[t.symbol].wins++;
        });

        const bestSymbol = Object.entries(bySymbol)
            .filter(([, v]) => v.total >= 2)
            .sort((a, b) => b[1].pnl - a[1].pnl)[0];

        if (bestSymbol) {
            const wr = ((bestSymbol[1].wins / bestSymbol[1].total) * 100).toFixed(0);
            parts.push(`Mejor par: <b>${bestSymbol[0]}</b> (${wr}% WR, ${bestSymbol[1].total} trades)`);
        }

        const longs = history.filter(t => t.direction === 'LONG');
        const shorts = history.filter(t => t.direction === 'SHORT');
        const longWR = longs.length > 0 ? (longs.filter(t => t.pnl > 0).length / longs.length * 100).toFixed(0) : 0;
        const shortWR = shorts.length > 0 ? (shorts.filter(t => t.pnl > 0).length / shorts.length * 100).toFixed(0) : 0;

        if (longs.length >= 2 && shorts.length >= 2) {
            const better = parseFloat(longWR) > parseFloat(shortWR) ? 'LONG' : 'SHORT';
            parts.push(`Mejor dirección: <b>${better}</b> (L:${longWR}% / S:${shortWR}%)`);
        }

        const byReason = {};
        history.filter(t => t.pnl < 0).forEach(t => {
            const r = t.reason || 'Manual';
            if (!byReason[r]) byReason[r] = 0;
            byReason[r]++;
        });
        const worstReason = Object.entries(byReason).sort((a, b) => b[1] - a[1])[0];
        if (worstReason && worstReason[1] >= 2) {
            parts.push(`Pérdida frecuente: <b>${worstReason[0]}</b> (${worstReason[1]}x)`);
        }

        const durations = history.filter(t => t.timestamp && t.closedAt).map(t =>
            new Date(t.closedAt).getTime() - new Date(t.timestamp).getTime()
        ).filter(d => d > 0);

        if (durations.length > 0) {
            const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
            parts.push(`Duración promedio: <b>${Utils.formatDuration(avg)}</b>`);
        }

        // Hypothesis hit rate
        const withHypothesis = history.filter(t => t.hypothesis);
        if (withHypothesis.length >= 3) {
            const hypoWins = withHypothesis.filter(t => t.pnl > 0).length;
            const hypoWR = ((hypoWins / withHypothesis.length) * 100).toFixed(0);
            const noHypo = history.filter(t => !t.hypothesis);
            const noHypoWR = noHypo.length > 0 ? ((noHypo.filter(t => t.pnl > 0).length / noHypo.length) * 100).toFixed(0) : '--';
            parts.push(`Con hipótesis: <b>${hypoWR}% WR</b> vs sin: ${noHypoWR}%`);
        }

        // Manual vs Watcher comparison
        const manual = history.filter(t => t.source !== 'watcher');
        const watcher = history.filter(t => t.source === 'watcher');
        if (manual.length >= 2 && watcher.length >= 2) {
            const mWR = ((manual.filter(t => t.pnl > 0).length / manual.length) * 100).toFixed(0);
            const wWR = ((watcher.filter(t => t.pnl > 0).length / watcher.length) * 100).toFixed(0);
            const better = parseFloat(wWR) > parseFloat(mWR) ? '👁 Watcher' : '🖱 Manual';
            parts.push(`Mejor fuente: <b>${better}</b> (M:${mWR}% / W:${wWR}%)`);
        }

        return parts.join('<br>');
    }
};
