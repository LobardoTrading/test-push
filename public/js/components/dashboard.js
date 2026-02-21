/* ========================================
   DASHBOARD — Performance Cockpit
   TheRealShortShady v6.0

   Clean, professional performance analytics
   ======================================== */

const Dashboard = {

    _refreshInterval: null,
    _isOpen: false,

    init() {
        console.log('📊 Dashboard initialized');
    },

    toggle() {
        if (this._isOpen) this.close();
        else this.open();
    },

    open() {
        const overlay = document.getElementById('dashboardOverlay');
        if (!overlay) return;
        overlay.classList.add('active');
        this._isOpen = true;
        this.render();
        this._refreshInterval = setInterval(() => this.render(), 10000);
    },

    close() {
        const overlay = document.getElementById('dashboardOverlay');
        if (!overlay) return;
        overlay.classList.remove('active');
        this._isOpen = false;
        if (this._refreshInterval) {
            clearInterval(this._refreshInterval);
            this._refreshInterval = null;
        }
    },

    render() {
        const container = document.getElementById('dashboardContent');
        if (!container) return;

        const bots = typeof Lab !== 'undefined' ? Lab._getBots() : [];
        const stats = this._calcStats(bots);

        // Show helpful state when no data
        if (bots.length === 0 || stats.totalTrades === 0) {
            container.innerHTML = `
                <div class="cockpit-empty">
                    <div class="cockpit-empty-icon">📊</div>
                    <div class="cockpit-empty-title">Performance Analytics</div>
                    <div class="cockpit-empty-desc">
                        ${bots.length === 0
                            ? 'Creá bots en el LAB para ver estadísticas de performance aquí.'
                            : 'Tus bots aún no tienen trades completados. Las estadísticas aparecerán cuando haya datos.'}
                    </div>
                    <div class="cockpit-empty-tips">
                        <div class="cockpit-tip">💡 Usá <strong>Analizar</strong> para evaluar oportunidades de trading</div>
                        <div class="cockpit-tip">🤖 Creá bots en el <strong>LAB</strong> para trading autónomo</div>
                        <div class="cockpit-tip">📈 Este dashboard mostrará métricas como Sharpe Ratio, Sortino, Win Rate, etc.</div>
                    </div>
                </div>
            `;
            return;
        }

        container.innerHTML = `
            <!-- Key Metrics Row -->
            <div class="cockpit-metrics">
                <div class="cockpit-metric">
                    <div class="cockpit-metric-value ${stats.totalPnl >= 0 ? 'positive' : 'negative'}">
                        ${stats.totalPnl >= 0 ? '+' : ''}$${stats.totalPnl.toFixed(2)}
                    </div>
                    <div class="cockpit-metric-label">Total P&L</div>
                </div>
                <div class="cockpit-metric">
                    <div class="cockpit-metric-value">${stats.winRate}%</div>
                    <div class="cockpit-metric-label">Win Rate</div>
                </div>
                <div class="cockpit-metric">
                    <div class="cockpit-metric-value">${stats.totalTrades}</div>
                    <div class="cockpit-metric-label">Trades</div>
                </div>
                <div class="cockpit-metric">
                    <div class="cockpit-metric-value">${stats.sharpe}</div>
                    <div class="cockpit-metric-label">Sharpe</div>
                </div>
                <div class="cockpit-metric">
                    <div class="cockpit-metric-value negative">${stats.maxDrawdown}%</div>
                    <div class="cockpit-metric-label">Max DD</div>
                </div>
            </div>

            <!-- Two Column Layout -->
            <div class="cockpit-grid">
                <!-- Left: Performance Details -->
                <div class="cockpit-card">
                    <div class="cockpit-card-header">Performance Breakdown</div>
                    <div class="cockpit-card-body">
                        <div class="cockpit-row">
                            <span>Profit Factor</span>
                            <span class="cockpit-value">${stats.profitFactor}</span>
                        </div>
                        <div class="cockpit-row">
                            <span>Sortino Ratio</span>
                            <span class="cockpit-value">${stats.sortino}</span>
                        </div>
                        <div class="cockpit-row">
                            <span>Avg Win</span>
                            <span class="cockpit-value positive">+$${stats.avgWin.toFixed(2)}</span>
                        </div>
                        <div class="cockpit-row">
                            <span>Avg Loss</span>
                            <span class="cockpit-value negative">-$${stats.avgLoss.toFixed(2)}</span>
                        </div>
                        <div class="cockpit-row">
                            <span>Best Trade</span>
                            <span class="cockpit-value positive">+$${stats.bestTrade.toFixed(2)}</span>
                        </div>
                        <div class="cockpit-row">
                            <span>Worst Trade</span>
                            <span class="cockpit-value negative">-$${Math.abs(stats.worstTrade).toFixed(2)}</span>
                        </div>
                        <div class="cockpit-row">
                            <span>Winning Streak</span>
                            <span class="cockpit-value">${stats.maxWinStreak}</span>
                        </div>
                        <div class="cockpit-row">
                            <span>Losing Streak</span>
                            <span class="cockpit-value">${stats.maxLoseStreak}</span>
                        </div>
                    </div>
                </div>

                <!-- Right: System Status -->
                <div class="cockpit-card">
                    <div class="cockpit-card-header">System Status</div>
                    <div class="cockpit-card-body">
                        <div class="cockpit-row">
                            <span>Active Bots</span>
                            <span class="cockpit-value">${stats.activeBots} / ${bots.length}</span>
                        </div>
                        <div class="cockpit-row">
                            <span>Open Positions</span>
                            <span class="cockpit-value">${stats.openPositions}</span>
                        </div>
                        <div class="cockpit-row">
                            <span>Daily P&L</span>
                            <span class="cockpit-value ${stats.dailyPnl >= 0 ? 'positive' : 'negative'}">
                                ${stats.dailyPnl >= 0 ? '+' : ''}$${stats.dailyPnl.toFixed(2)}
                            </span>
                        </div>
                        <div class="cockpit-row">
                            <span>Risk Status</span>
                            <span class="cockpit-status ${stats.riskStatus}">${stats.riskStatusText}</span>
                        </div>
                        ${this._renderLearningStatus()}
                    </div>
                </div>
            </div>

            <!-- Bot Performance Table -->
            ${bots.length > 0 ? this._renderBotTable(bots) : ''}

            <!-- Recent Trades -->
            ${this._renderRecentTrades(bots)}
        `;
    },

    _renderLearningStatus() {
        if (typeof LearningEngine === 'undefined') return '';

        const eff = LearningEngine.getEffectiveness();
        if (!eff) {
            return `
                <div class="cockpit-row">
                    <span>Learning</span>
                    <span class="cockpit-status neutral">Collecting data...</span>
                </div>
            `;
        }

        return `
            <div class="cockpit-row">
                <span>Learning Filter</span>
                <span class="cockpit-status ${eff.isEffective ? 'good' : 'neutral'}">
                    ${eff.isEffective ? 'Effective' : 'Neutral'}
                </span>
            </div>
            <div class="cockpit-row">
                <span>Blocked Accuracy</span>
                <span class="cockpit-value">${eff.blockedAccuracy}</span>
            </div>
        `;
    },

    _renderBotTable(bots) {
        const activeBots = bots.filter(b => b.status !== 'archived').slice(0, 8);
        if (activeBots.length === 0) return '';

        const rows = activeBots.map(bot => {
            const pnl = bot.stats?.totalPnl || 0;
            const trades = bot.stats?.trades || 0;
            const wr = trades > 0 ? ((bot.stats.wins / trades) * 100).toFixed(0) : '--';
            const isRunning = bot.status === 'running';

            return `
                <tr class="${isRunning ? '' : 'inactive'}">
                    <td>
                        <span class="bot-status-dot ${isRunning ? 'active' : ''}"></span>
                        ${bot.name}
                    </td>
                    <td>${bot.symbol}</td>
                    <td>${trades}</td>
                    <td class="${parseInt(wr) >= 50 ? 'positive' : 'negative'}">${wr}%</td>
                    <td class="${pnl >= 0 ? 'positive' : 'negative'}">
                        ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}
                    </td>
                </tr>
            `;
        }).join('');

        return `
            <div class="cockpit-card cockpit-card-full">
                <div class="cockpit-card-header">Bot Performance</div>
                <table class="cockpit-table">
                    <thead>
                        <tr>
                            <th>Bot</th>
                            <th>Symbol</th>
                            <th>Trades</th>
                            <th>Win Rate</th>
                            <th>P&L</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        `;
    },

    _renderRecentTrades(bots) {
        const allTrades = [];
        bots.forEach(bot => {
            (bot.trades || []).forEach(t => {
                allTrades.push({ ...t, botName: bot.name });
            });
        });

        const recent = allTrades
            .filter(t => t.closedAt)
            .sort((a, b) => new Date(b.closedAt) - new Date(a.closedAt))
            .slice(0, 6);

        if (recent.length === 0) return '';

        const rows = recent.map(t => {
            const time = new Date(t.closedAt).toLocaleString('es-AR', {
                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
            });
            return `
                <tr>
                    <td>${time}</td>
                    <td>${t.symbol}</td>
                    <td class="${t.direction === 'LONG' ? 'positive' : 'negative'}">${t.direction}</td>
                    <td class="${t.pnl >= 0 ? 'positive' : 'negative'}">
                        ${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(2)}
                    </td>
                </tr>
            `;
        }).join('');

        return `
            <div class="cockpit-card cockpit-card-full">
                <div class="cockpit-card-header">Recent Trades</div>
                <table class="cockpit-table">
                    <thead>
                        <tr>
                            <th>Time</th>
                            <th>Symbol</th>
                            <th>Direction</th>
                            <th>P&L</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        `;
    },

    _calcStats(bots) {
        let totalPnl = 0, totalTrades = 0, wins = 0, losses = 0;
        let grossProfit = 0, grossLoss = 0;
        let bestTrade = 0, worstTrade = 0;
        let allReturns = [];
        let openPositions = 0;
        let activeBots = 0;
        let maxWinStreak = 0, maxLoseStreak = 0;
        let currentWinStreak = 0, currentLoseStreak = 0;
        let dailyPnl = 0;
        const today = new Date().toISOString().slice(0, 10);

        for (const bot of bots) {
            if (bot.status === 'running') activeBots++;
            openPositions += (bot.positions || []).length;

            const trades = bot.trades || [];
            for (const t of trades) {
                if (t.pnl === undefined) continue;

                totalTrades++;
                totalPnl += t.pnl;
                allReturns.push(t.pnl);

                if (t.pnl > 0) {
                    wins++;
                    grossProfit += t.pnl;
                    if (t.pnl > bestTrade) bestTrade = t.pnl;
                    currentWinStreak++;
                    if (currentWinStreak > maxWinStreak) maxWinStreak = currentWinStreak;
                    currentLoseStreak = 0;
                } else {
                    losses++;
                    grossLoss += Math.abs(t.pnl);
                    if (t.pnl < worstTrade) worstTrade = t.pnl;
                    currentLoseStreak++;
                    if (currentLoseStreak > maxLoseStreak) maxLoseStreak = currentLoseStreak;
                    currentWinStreak = 0;
                }

                if (t.closedAt && t.closedAt.startsWith(today)) {
                    dailyPnl += t.pnl;
                }
            }
        }

        const winRate = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(1) : '0.0';
        const avgWin = wins > 0 ? grossProfit / wins : 0;
        const avgLoss = losses > 0 ? grossLoss / losses : 0;
        const profitFactor = grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : '--';

        // Sharpe & Sortino
        let sharpe = '--', sortino = '--';
        if (allReturns.length > 1) {
            const mean = allReturns.reduce((a, b) => a + b, 0) / allReturns.length;
            const variance = allReturns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / allReturns.length;
            const std = Math.sqrt(variance);
            if (std > 0) sharpe = (mean / std * Math.sqrt(252)).toFixed(2);

            const downside = allReturns.filter(r => r < 0);
            if (downside.length > 0) {
                const dsVar = downside.reduce((sum, r) => sum + Math.pow(r, 2), 0) / downside.length;
                const dsStd = Math.sqrt(dsVar);
                if (dsStd > 0) sortino = (mean / dsStd * Math.sqrt(252)).toFixed(2);
            }
        }

        // Max Drawdown
        let maxDD = 0;
        for (const bot of bots) {
            const initial = bot.initialBalance || bot.initialWallet || 100;
            const current = bot.currentBalance || initial;
            const dd = ((initial - current) / initial) * 100;
            if (dd > maxDD) maxDD = dd;
        }

        // Risk Status
        const rm = typeof RiskManager !== 'undefined' ? RiskManager : null;
        let riskStatus = 'good', riskStatusText = 'Normal';
        if (rm && rm._paused) {
            riskStatus = 'bad';
            riskStatusText = 'Paused';
        } else if (maxDD > 10) {
            riskStatus = 'warning';
            riskStatusText = 'High DD';
        }

        return {
            totalPnl, totalTrades, winRate,
            sharpe, sortino, profitFactor,
            avgWin, avgLoss, bestTrade, worstTrade,
            maxWinStreak, maxLoseStreak,
            maxDrawdown: maxDD.toFixed(1),
            activeBots, openPositions, dailyPnl,
            riskStatus, riskStatusText
        };
    }
};
