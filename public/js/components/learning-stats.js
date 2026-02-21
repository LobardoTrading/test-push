/**
 * LearningStats — Render learning metrics in right panel
 * Shows win rate, confidence intervals, sample sizes, etc.
 */
const LearningStats = {
    _container: null,
    _updateInterval: null,

    init() {
        this._container = document.getElementById('learningStats');
        if (!this._container) return;

        this.render();
        this._updateInterval = setInterval(() => this.render(), 10000);

        console.log('LearningStats: Initialized');
    },

    async render() {
        if (!this._container) return;

        const stats = await this._getStats();

        this._container.innerHTML = `
            <div class="ls-content">
                <!-- Win Rate with Confidence -->
                <div class="ls-row">
                    <span class="ls-label">Win Rate</span>
                    <span class="ls-value ${this._wrClass(stats.winRate)}">
                        ${(stats.winRate * 100).toFixed(1)}%
                        ${stats.ciLow !== null ? `<span class="ls-ci">[${(stats.ciLow * 100).toFixed(0)}-${(stats.ciHigh * 100).toFixed(0)}%]</span>` : ''}
                    </span>
                </div>

                <!-- Sample Size -->
                <div class="ls-row">
                    <span class="ls-label">Trades</span>
                    <span class="ls-value">
                        ${stats.totalTrades}
                        <span class="ls-sub">(${stats.effectiveSamples.toFixed(0)} eff)</span>
                    </span>
                </div>

                <!-- Statistical Significance -->
                <div class="ls-row">
                    <span class="ls-label">Significancia</span>
                    <span class="ls-value ${stats.isSignificant ? 'significant' : 'not-significant'}">
                        ${stats.isSignificant ? 'Significativo' : 'Insuficiente'}
                        ${stats.pValue !== null ? `<span class="ls-sub">p=${stats.pValue.toFixed(3)}</span>` : ''}
                    </span>
                </div>

                <!-- Profit Factor -->
                <div class="ls-row">
                    <span class="ls-label">Profit Factor</span>
                    <span class="ls-value ${stats.profitFactor >= 1.5 ? 'good' : stats.profitFactor >= 1 ? 'neutral' : 'bad'}">
                        ${stats.profitFactor.toFixed(2)}
                    </span>
                </div>

                <!-- Expectancy -->
                <div class="ls-row">
                    <span class="ls-label">Expectancy</span>
                    <span class="ls-value ${stats.expectancy >= 0 ? 'positive' : 'negative'}">
                        ${stats.expectancy >= 0 ? '+' : ''}${stats.expectancy.toFixed(2)}%
                    </span>
                </div>

                <!-- Auto-retrain Status -->
                <div class="ls-row">
                    <span class="ls-label">Retrain</span>
                    <span class="ls-value ls-retrain">
                        ${stats.tradesUntilRetrain > 0 ? `En ${stats.tradesUntilRetrain} trades` : 'Listo'}
                    </span>
                </div>
            </div>
        `;
    },

    async _getStats() {
        const defaults = {
            winRate: 0.5,
            totalTrades: 0,
            effectiveSamples: 0,
            ciLow: null,
            ciHigh: null,
            isSignificant: false,
            pValue: null,
            profitFactor: 1,
            expectancy: 0,
            tradesUntilRetrain: 50
        };

        try {
            // Get trades from TradeDB
            if (typeof TradeDB !== 'undefined') {
                const trades = await TradeDB.getTrades(500);
                if (trades.length === 0) return defaults;

                const wins = trades.filter(t => (t.pnl || 0) > 0);
                const losses = trades.filter(t => (t.pnl || 0) <= 0);

                const winRate = trades.length > 0 ? wins.length / trades.length : 0.5;
                const totalWin = wins.reduce((s, t) => s + (t.pnl || 0), 0);
                const totalLoss = Math.abs(losses.reduce((s, t) => s + (t.pnl || 0), 0));

                // Confidence interval (Wilson score)
                let ciLow = null, ciHigh = null;
                if (trades.length >= 10) {
                    const z = 1.96;
                    const n = trades.length;
                    const p = winRate;
                    const denom = 1 + z * z / n;
                    const center = (p + z * z / (2 * n)) / denom;
                    const spread = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n) / denom;
                    ciLow = Math.max(0, center - spread);
                    ciHigh = Math.min(1, center + spread);
                }

                // P-value (binomial test against 50%)
                let pValue = null;
                let isSignificant = false;
                if (trades.length >= 10) {
                    const x = wins.length;
                    const n = trades.length;
                    // Simple approximation
                    const mean = n * 0.5;
                    const std = Math.sqrt(n * 0.5 * 0.5);
                    const zScore = (x - mean) / std;
                    pValue = 2 * (1 - this._normalCDF(Math.abs(zScore)));
                    isSignificant = pValue < 0.05 && winRate > 0.5;
                }

                // Time-weighted effective samples
                let effectiveSamples = 0;
                const now = Date.now();
                const halfLife = 30 * 24 * 60 * 60 * 1000;
                trades.forEach(t => {
                    const age = now - (t.exitTime || t.entryTime || now);
                    const weight = Math.exp(-0.693 * age / halfLife);
                    effectiveSamples += weight;
                });

                // Profit factor
                const profitFactor = totalLoss > 0 ? totalWin / totalLoss : (totalWin > 0 ? 999 : 1);

                // Expectancy (average % per trade)
                const avgWin = wins.length > 0 ? totalWin / wins.length : 0;
                const avgLoss = losses.length > 0 ? totalLoss / losses.length : 0;
                const expectancy = (winRate * avgWin - (1 - winRate) * avgLoss);

                // Retrain check
                const retrainEvery = 50;
                const tradesUntilRetrain = retrainEvery - (trades.length % retrainEvery);

                return {
                    winRate,
                    totalTrades: trades.length,
                    effectiveSamples,
                    ciLow,
                    ciHigh,
                    isSignificant,
                    pValue,
                    profitFactor,
                    expectancy,
                    tradesUntilRetrain
                };
            }

            // Fallback to LearningEngine if TradeDB not available
            if (typeof LearningEngine !== 'undefined') {
                const leStats = LearningEngine.getStats ? LearningEngine.getStats() : {};
                return {
                    ...defaults,
                    winRate: leStats.winRate || 0.5,
                    totalTrades: leStats.totalTrades || 0
                };
            }

            return defaults;
        } catch (e) {
            console.warn('LearningStats: Error getting stats', e);
            return defaults;
        }
    },

    _wrClass(wr) {
        if (wr >= 0.55) return 'good';
        if (wr >= 0.45) return 'neutral';
        return 'bad';
    },

    _normalCDF(x) {
        const a1 = 0.254829592;
        const a2 = -0.284496736;
        const a3 = 1.421413741;
        const a4 = -1.453152027;
        const a5 = 1.061405429;
        const p = 0.3275911;

        const sign = x < 0 ? -1 : 1;
        x = Math.abs(x) / Math.sqrt(2);

        const t = 1.0 / (1.0 + p * x);
        const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

        return 0.5 * (1.0 + sign * y);
    },

    destroy() {
        if (this._updateInterval) {
            clearInterval(this._updateInterval);
        }
    }
};

// Auto-init
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => LearningStats.init());
} else {
    setTimeout(() => LearningStats.init(), 300);
}
