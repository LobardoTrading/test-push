/**
 * QuickPerformance — Real-time performance metrics in right panel
 * Shows Sharpe, Sortino, Max DD, etc.
 */
const QuickPerformance = {
    _container: null,
    _updateInterval: null,

    init() {
        this._container = document.getElementById('quickPerformance');
        if (!this._container) return;

        this.render();
        this._updateInterval = setInterval(() => this.render(), 15000);

        State.subscribe('wallet', () => this.render());
        State.subscribe('positions', () => this.render());

        console.log('QuickPerformance: Initialized');
    },

    async render() {
        if (!this._container) return;

        const metrics = await this._calculateMetrics();

        this._container.innerHTML = `
            <div class="qp-content">
                <!-- Sharpe Ratio -->
                <div class="qp-metric">
                    <span class="qp-label">Sharpe</span>
                    <span class="qp-value ${this._sharpeClass(metrics.sharpe)}">${metrics.sharpe.toFixed(2)}</span>
                </div>

                <!-- Sortino Ratio -->
                <div class="qp-metric">
                    <span class="qp-label">Sortino</span>
                    <span class="qp-value ${metrics.sortino >= 1 ? 'good' : 'neutral'}">${metrics.sortino.toFixed(2)}</span>
                </div>

                <!-- Max Drawdown -->
                <div class="qp-metric">
                    <span class="qp-label">Max DD</span>
                    <span class="qp-value ${metrics.maxDD > 20 ? 'bad' : metrics.maxDD > 10 ? 'warn' : 'good'}">
                        -${metrics.maxDD.toFixed(1)}%
                    </span>
                </div>

                <!-- Current Drawdown -->
                <div class="qp-metric">
                    <span class="qp-label">Curr DD</span>
                    <span class="qp-value ${metrics.currentDD > 10 ? 'bad' : metrics.currentDD > 5 ? 'warn' : 'good'}">
                        -${metrics.currentDD.toFixed(1)}%
                    </span>
                </div>

                <!-- P&L Today -->
                <div class="qp-metric">
                    <span class="qp-label">Hoy</span>
                    <span class="qp-value ${metrics.todayPnl >= 0 ? 'positive' : 'negative'}">
                        ${metrics.todayPnl >= 0 ? '+' : ''}$${metrics.todayPnl.toFixed(2)}
                    </span>
                </div>

                <!-- Win Streak / Loss Streak -->
                <div class="qp-metric">
                    <span class="qp-label">Racha</span>
                    <span class="qp-value ${metrics.streak > 0 ? 'good' : metrics.streak < 0 ? 'bad' : 'neutral'}">
                        ${metrics.streak > 0 ? '+' + metrics.streak + 'W' : metrics.streak < 0 ? Math.abs(metrics.streak) + 'L' : '0'}
                    </span>
                </div>
            </div>
        `;
    },

    async _calculateMetrics() {
        const defaults = {
            sharpe: 0,
            sortino: 0,
            maxDD: 0,
            currentDD: 0,
            todayPnl: 0,
            streak: 0
        };

        try {
            let trades = [];

            // Get trades from TradeDB
            if (typeof TradeDB !== 'undefined') {
                trades = await TradeDB.getTrades(200);
            }

            if (trades.length < 2) return defaults;

            // Calculate returns
            const returns = trades.map(t => {
                const entryValue = t.size || 100;
                return (t.pnl || 0) / entryValue;
            });

            // Sharpe Ratio
            const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
            const stdDev = Math.sqrt(returns.reduce((s, r) => s + Math.pow(r - avgReturn, 2), 0) / returns.length);
            const sharpe = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(Math.min(trades.length, 252)) : 0;

            // Sortino Ratio (only downside deviation)
            const negReturns = returns.filter(r => r < 0);
            const downsideDev = negReturns.length > 0
                ? Math.sqrt(negReturns.reduce((s, r) => s + r * r, 0) / negReturns.length)
                : 0.001;
            const sortino = downsideDev > 0 ? (avgReturn / downsideDev) * Math.sqrt(Math.min(trades.length, 252)) : 0;

            // Max Drawdown (peak to trough)
            let peak = 0;
            let runningBalance = 0;
            let maxDD = 0;

            const wallet = { balance: State.balance, initialBalance: CONFIG?.TRADING?.DEFAULT_BALANCE || 10000 };
            const initialBalance = wallet.initialBalance || 10000;
            runningBalance = initialBalance;
            peak = initialBalance;

            // Sort trades by exit time
            const sortedTrades = [...trades].sort((a, b) =>
                (a.exitTime || a.entryTime || 0) - (b.exitTime || b.entryTime || 0)
            );

            for (const trade of sortedTrades) {
                runningBalance += (trade.pnl || 0);
                if (runningBalance > peak) peak = runningBalance;
                const dd = peak > 0 ? ((peak - runningBalance) / peak) * 100 : 0;
                if (dd > maxDD) maxDD = dd;
            }

            // Current Drawdown
            const currentBalance = wallet.balance || runningBalance;
            const currentDD = peak > 0 ? ((peak - currentBalance) / peak) * 100 : 0;

            // Today's P&L
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const todayStart = today.getTime();
            const todayTrades = trades.filter(t => (t.exitTime || t.entryTime || 0) >= todayStart);
            const todayPnl = todayTrades.reduce((s, t) => s + (t.pnl || 0), 0);

            // Current streak
            let streak = 0;
            for (let i = 0; i < trades.length; i++) {
                const pnl = trades[i].pnl || 0;
                if (i === 0) {
                    streak = pnl > 0 ? 1 : (pnl < 0 ? -1 : 0);
                } else {
                    if (pnl > 0 && streak > 0) streak++;
                    else if (pnl < 0 && streak < 0) streak--;
                    else break;
                }
            }

            return { sharpe, sortino, maxDD, currentDD, todayPnl, streak };
        } catch (e) {
            console.warn('QuickPerformance: Error calculating metrics', e);
            return defaults;
        }
    },

    _sharpeClass(sharpe) {
        if (sharpe >= 2) return 'excellent';
        if (sharpe >= 1) return 'good';
        if (sharpe >= 0) return 'neutral';
        return 'bad';
    },

    destroy() {
        if (this._updateInterval) {
            clearInterval(this._updateInterval);
        }
    }
};

// Auto-init
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => QuickPerformance.init());
} else {
    setTimeout(() => QuickPerformance.init(), 400);
}
