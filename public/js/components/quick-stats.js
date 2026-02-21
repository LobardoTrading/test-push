/* ========================================
   QUICK STATS — Session Performance Strip
   Below action buttons, always visible context
   TheRealShortShady v4.2
   ======================================== */

const QuickStats = {

    _container: null,
    _refreshInterval: null,

    init() {
        this._createBar();
        this._update();
        this._refreshInterval = setInterval(() => this._update(), 15000);

        State.subscribe('positions', () => this._update());
        State.subscribe('balance', () => this._update());
    },

    _createBar() {
        const actionsBar = document.querySelector('.actions-bar');
        if (!actionsBar) return;

        if (document.getElementById('quickStats')) return;

        const bar = document.createElement('div');
        bar.id = 'quickStats';
        bar.className = 'quick-stats';
        actionsBar.parentNode.insertBefore(bar, actionsBar.nextSibling);
        this._container = bar;
    },

    _update() {
        if (!this._container) return;

        const history = Trading.getHistory();
        const stats = Trading.getStats();

        // Today's trades
        const today = new Date().toISOString().split('T')[0];
        const todayTrades = history.filter(t => t.closedAt && t.closedAt.startsWith(today));
        const todayPnl = todayTrades.reduce((s, t) => s + (t.pnl || 0), 0);
        const todayWins = todayTrades.filter(t => t.pnl > 0).length;
        const todayLosses = todayTrades.filter(t => t.pnl <= 0).length;

        // Current streak
        const streak = this._getStreak(history);

        // Session time
        const sessionStart = State._sessionStart || Date.now();
        const sessionMin = Math.floor((Date.now() - sessionStart) / 60000);

        // Balance change from initial
        const initialBalance = parseFloat(localStorage.getItem('tp_initial_balance') || State.balance);
        const balanceChange = ((State.balance - initialBalance) / initialBalance * 100);

        // Risk status
        const openRisk = this._calcOpenRisk();

        this._container.innerHTML = `
            <div class="qs-item" title="PnL del día">
                <span class="qs-label">Hoy</span>
                <span class="qs-value ${todayPnl >= 0 ? 'qs-green' : 'qs-red'}">
                    ${todayPnl >= 0 ? '+' : ''}${todayPnl.toFixed(2)}
                </span>
                <span class="qs-sub">${todayWins}W ${todayLosses}L</span>
            </div>
            <div class="qs-divider"></div>
            <div class="qs-item" title="Win Rate total">
                <span class="qs-label">WR</span>
                <span class="qs-value ${parseFloat(stats.winRate) >= 50 ? 'qs-green' : parseFloat(stats.winRate) >= 40 ? 'qs-yellow' : 'qs-red'}">
                    ${stats.winRate}%
                </span>
                <span class="qs-sub">${stats.trades} trades</span>
            </div>
            <div class="qs-divider"></div>
            <div class="qs-item" title="Racha actual">
                <span class="qs-label">Racha</span>
                <span class="qs-value ${streak.type === 'win' ? 'qs-green' : streak.type === 'loss' ? 'qs-red' : 'qs-dim'}">
                    ${streak.icon} ${streak.count}
                </span>
            </div>
            <div class="qs-divider"></div>
            <div class="qs-item" title="Profit Factor">
                <span class="qs-label">PF</span>
                <span class="qs-value ${parseFloat(stats.profitFactor) >= 1.5 ? 'qs-green' : parseFloat(stats.profitFactor) >= 1 ? 'qs-yellow' : 'qs-red'}">
                    ${stats.profitFactor}
                </span>
            </div>
            <div class="qs-divider"></div>
            <div class="qs-item" title="Riesgo abierto">
                <span class="qs-label">Riesgo</span>
                <span class="qs-value ${openRisk.class}">
                    ${openRisk.label}
                </span>
            </div>
        `;
    },

    _getStreak(history) {
        if (history.length === 0) return { type: 'none', count: 0, icon: '—' };

        let count = 0;
        const lastType = history[history.length - 1].pnl > 0 ? 'win' : 'loss';

        for (let i = history.length - 1; i >= 0; i--) {
            const isWin = history[i].pnl > 0;
            if ((isWin && lastType === 'win') || (!isWin && lastType === 'loss')) {
                count++;
            } else {
                break;
            }
        }

        return {
            type: lastType,
            count: count,
            icon: lastType === 'win' ? '🔥' : '❄️'
        };
    },

    _calcOpenRisk() {
        const positions = State.positions || [];
        if (positions.length === 0) return { label: '0%', class: 'qs-dim' };

        const totalMargin = positions.reduce((s, p) => s + (p.margin || 0), 0);
        const riskPct = (totalMargin / State.balance * 100);

        if (riskPct >= 30) return { label: `${riskPct.toFixed(0)}%`, class: 'qs-red' };
        if (riskPct >= 15) return { label: `${riskPct.toFixed(0)}%`, class: 'qs-yellow' };
        return { label: `${riskPct.toFixed(0)}%`, class: 'qs-green' };
    }
};
