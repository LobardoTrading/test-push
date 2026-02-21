/* ========================================
   MASTERBOTS LIVE PANEL
   Premium real-time MasterBots consensus display
   TheRealShortShady v7.0
   ======================================== */

const MasterBotsLive = {
    _container: null,
    _unsubscribe: null,
    _lastData: null,
    _animating: false,

    init() {
        this._container = document.getElementById('masterbotsLivePanel');
        if (!this._container) {
            this._createContainer();
        }

        // Subscribe to LiveUpdater
        if (typeof LiveUpdater !== 'undefined') {
            this._unsubscribe = LiveUpdater.subscribe('masterBots', (data) => {
                this._lastData = data;
                this.render(data);
            });
        }

        // Subscribe to symbol changes
        State.subscribe('symbol', () => {
            this._triggerAnalysis();
        });

        // Initial render with cached data
        const cached = LiveUpdater?.getMasterBotsStatus?.();
        if (cached && cached.lastUpdate) {
            this._lastData = cached;
            this.render(cached);
        } else {
            this._renderEmpty();
        }

        console.log('MasterBotsLive initialized');
    },

    _createContainer() {
        // Find right panel analysis section
        const rightPanel = document.querySelector('.sidebar-right .sidebar-content.active')
                        || document.querySelector('.sidebar-right .sidebar-content')
                        || document.querySelector('#analysisPanel');

        if (rightPanel) {
            const panel = document.createElement('div');
            panel.id = 'masterbotsLivePanel';
            panel.className = 'masterbots-panel animate-in';
            rightPanel.insertBefore(panel, rightPanel.firstChild);
            this._container = panel;
        }
    },

    _triggerAnalysis() {
        // Trigger fresh MasterBots analysis when symbol changes
        if (typeof MasterBots !== 'undefined' && State.symbol && State.candles?.length >= 21) {
            setTimeout(() => {
                const candles = State.candles.map(c => ({
                    open: c.o, high: c.h, low: c.l, close: c.c, volume: c.v
                }));
                const indicators = this._computeIndicators(State.candles);
                MasterBots.analyzeAll(State.symbol, candles, indicators);
            }, 500);
        }
    },

    _computeIndicators(candles) {
        if (!candles || candles.length < 14) return {};
        const closes = candles.map(c => c.c);
        const ind = {};

        if (typeof Indicators !== 'undefined') {
            const ema9s = Indicators.emaSeries(closes, 9);
            const ema21s = Indicators.emaSeries(closes, 21);
            const rsiS = Indicators.rsiSeries(closes, 14);

            if (ema9s.length > 0) ind.ema9 = ema9s[ema9s.length - 1];
            if (ema21s.length > 0) ind.ema21 = ema21s[ema21s.length - 1];
            if (rsiS.length > 0) ind.rsi = rsiS[rsiS.length - 1];
        }

        return ind;
    },

    render(data) {
        if (!this._container) return;
        if (!data || !data.bots || data.bots.length === 0) {
            this._renderEmpty();
            return;
        }

        const consensus = data.consensus || 'neutral';
        const consensusPct = data.consensusPercent || 50;
        const avgScore = data.avgScore || 50;
        const symbol = data.symbol || State.symbol || '--';
        const bots = data.bots || [];

        // Count signals
        const bullCount = bots.filter(b => b.signal === 'bullish').length;
        const bearCount = bots.filter(b => b.signal === 'bearish').length;
        const neutralCount = bots.filter(b => b.signal === 'neutral').length;

        const consensusIcon = consensus === 'bullish' ? '🟢' : consensus === 'bearish' ? '🔴' : '🟡';
        const consensusText = consensus === 'bullish' ? 'ALCISTA' : consensus === 'bearish' ? 'BAJISTA' : 'NEUTRAL';

        this._container.innerHTML = `
            <div class="masterbots-panel-header">
                <div class="masterbots-panel-title">
                    <span>🏆</span>
                    <span>MasterBots</span>
                    <span class="masterbots-panel-symbol">${symbol}</span>
                </div>
                <div class="masterbots-consensus-badge ${consensus}">
                    ${consensusIcon} ${consensusText}
                </div>
            </div>

            <div class="masterbots-score-section">
                <div class="masterbots-score-header">
                    <span class="masterbots-score-label">Consenso</span>
                    <span class="masterbots-score-value ${consensus}">${consensusPct}%</span>
                </div>
                <div class="masterbots-score-bar">
                    <div class="masterbots-score-fill ${consensus}" style="width: ${consensusPct}%"></div>
                </div>
                <div class="masterbots-signal-counts">
                    <span class="count-bullish">${bullCount} 🟢</span>
                    <span class="count-neutral">${neutralCount} 🟡</span>
                    <span class="count-bearish">${bearCount} 🔴</span>
                </div>
            </div>

            <div class="masterbots-grid">
                ${bots.map(bot => this._renderBot(bot)).join('')}
            </div>

            <div class="masterbots-footer">
                <span>Score Promedio: <strong>${avgScore}</strong></span>
                <span>${this._formatTime(data.lastUpdate)}</span>
            </div>
        `;

        // Add entrance animation
        if (!this._animating) {
            this._animating = true;
            this._container.querySelectorAll('.masterbot-item').forEach((el, i) => {
                el.style.opacity = '0';
                el.style.transform = 'translateX(-10px)';
                setTimeout(() => {
                    el.style.transition = 'all 0.3s ease';
                    el.style.opacity = '1';
                    el.style.transform = 'translateX(0)';
                }, i * 50);
            });
            setTimeout(() => { this._animating = false; }, 500);
        }
    },

    _renderBot(bot) {
        const signal = bot.signal || 'neutral';
        const score = bot.score || 50;
        const name = bot.name || 'Bot';
        const reason = bot.reason || '';

        const scoreClass = score >= 65 ? 'high' : score >= 45 ? 'medium' : 'low';

        return `
            <div class="masterbot-item" title="${reason}">
                <div class="masterbot-signal-indicator ${signal}"></div>
                <span class="masterbot-item-name">${name}</span>
                <span class="masterbot-item-score ${scoreClass}">${score}</span>
                ${reason ? `<span class="masterbot-item-reason">${reason.substring(0, 30)}${reason.length > 30 ? '...' : ''}</span>` : ''}
            </div>
        `;
    },

    _renderEmpty() {
        if (!this._container) return;

        const symbol = State.symbol || '--';

        this._container.innerHTML = `
            <div class="masterbots-panel-header">
                <div class="masterbots-panel-title">
                    <span>🏆</span>
                    <span>MasterBots</span>
                    <span class="masterbots-panel-symbol">${symbol}</span>
                </div>
            </div>

            <div class="masterbots-empty">
                <div class="masterbots-empty-icon">📊</div>
                <div class="masterbots-empty-text">
                    Analizando mercado...
                </div>
                <div class="masterbots-loading-bar">
                    <div class="masterbots-loading-fill"></div>
                </div>
            </div>
        `;
    },

    _formatTime(timestamp) {
        if (!timestamp) return '--';
        const date = new Date(timestamp);
        return date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    },

    destroy() {
        if (this._unsubscribe) {
            this._unsubscribe();
        }
    },

    // Public API for forcing refresh
    refresh() {
        this._triggerAnalysis();
    },

    // Get current consensus for other components
    getConsensus() {
        return this._lastData?.consensus || 'neutral';
    },

    getScore() {
        return parseFloat(this._lastData?.avgScore || 50);
    }
};

// Auto-init when DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => MasterBotsLive.init());
} else {
    MasterBotsLive.init();
}
