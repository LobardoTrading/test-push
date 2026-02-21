/* ========================================
   LIVE UPDATER - Real-time Status Service
   TheRealShortShady v7.0

   Provides real-time updates for:
   - Bot status and activity
   - MasterBots analysis
   - Radar scanning progress
   - Position P&L
   ======================================== */

const LiveUpdater = {

    // Intervals in ms
    _intervals: {
        positions: 1000,      // 1s - position P&L updates
        botStatus: 3000,      // 3s - bot status updates
        masterBots: 30000,    // 30s - MasterBots re-analysis
        radar: 90000,         // 90s - radar scan
        autonomy: 5000,       // 5s - autonomy status
    },

    // Active intervals
    _timers: {},

    // Subscribers for each update type
    _subscribers: {
        positions: [],
        botStatus: [],
        masterBots: [],
        radar: [],
        autonomy: [],
    },

    // Current status data
    _status: {
        autonomy: {
            running: false,
            level: 0,
            levelName: 'Manual',
            activeBots: 0,
            maxBots: 10,
            sessionPnl: 0,
            sessionTrades: 0,
            winRate: 0,
            nextCheck: null,
            lastCheck: null,
        },
        bots: [],
        radar: {
            scanning: false,
            currentSymbol: null,
            progress: 0,
            total: 0,
            results: [],
            lastScan: null,
        },
        masterBots: {
            lastUpdate: null,
            consensus: null,
            bots: [],
        },
    },

    // ═══════════════════════════════════════
    // INITIALIZATION
    // ═══════════════════════════════════════

    init() {
        console.log('🔄 LiveUpdater initialized');
        this.start();
    },

    start() {
        // Position updates (most critical)
        this._timers.positions = setInterval(
            () => this._updatePositions(),
            this._intervals.positions
        );

        // Bot status updates
        this._timers.botStatus = setInterval(
            () => this._updateBotStatus(),
            this._intervals.botStatus
        );

        // Autonomy status
        this._timers.autonomy = setInterval(
            () => this._updateAutonomyStatus(),
            this._intervals.autonomy
        );

        // MasterBots (less frequent)
        this._timers.masterBots = setInterval(
            () => this._updateMasterBots(),
            this._intervals.masterBots
        );

        // Run initial updates
        this._updateAutonomyStatus();
        this._updateBotStatus();
    },

    stop() {
        Object.values(this._timers).forEach(timer => clearInterval(timer));
        this._timers = {};
    },

    // ═══════════════════════════════════════
    // SUBSCRIPTION API
    // ═══════════════════════════════════════

    subscribe(type, callback) {
        if (this._subscribers[type]) {
            this._subscribers[type].push(callback);
            return () => {
                const idx = this._subscribers[type].indexOf(callback);
                if (idx > -1) this._subscribers[type].splice(idx, 1);
            };
        }
        return () => {};
    },

    _notify(type, data) {
        if (this._subscribers[type]) {
            this._subscribers[type].forEach(cb => {
                try {
                    cb(data);
                } catch (e) {
                    console.warn(`LiveUpdater ${type} subscriber error:`, e);
                }
            });
        }
    },

    // ═══════════════════════════════════════
    // POSITION UPDATES
    // ═══════════════════════════════════════

    _updatePositions() {
        const positions = State.positions || [];
        if (positions.length === 0) return;

        const updates = positions.map(pos => {
            const price = State.prices[pos.symbol]?.price || pos.entry;
            const pnl = this._calculatePnL(pos, price);
            const pnlPercent = pos.margin > 0 ? (pnl / pos.margin) * 100 : 0;
            const progress = this._calculateProgress(pos, price);
            const duration = this._calcDuration(pos.timestamp);

            return {
                id: pos.id,
                symbol: pos.symbol,
                direction: pos.direction,
                price,
                pnl,
                pnlPercent,
                progress,
                duration,
                distToTp: this._calcDistToTarget(pos, price, 'tp'),
                distToSl: this._calcDistToTarget(pos, price, 'sl'),
                distToLiq: this._calcDistToTarget(pos, price, 'liq'),
            };
        });

        this._notify('positions', updates);
    },

    _calculatePnL(pos, currentPrice) {
        const exitFee = pos.fee;
        if (pos.direction === 'LONG') {
            return ((currentPrice - pos.entry) / pos.entry) * pos.size - exitFee;
        } else {
            return ((pos.entry - currentPrice) / pos.entry) * pos.size - exitFee;
        }
    },

    _calculateProgress(pos, currentPrice) {
        const range = Math.abs(pos.tp - pos.sl);
        if (range === 0) return 50;
        if (pos.direction === 'LONG') {
            return Math.max(0, Math.min(100, ((currentPrice - pos.sl) / range) * 100));
        } else {
            return Math.max(0, Math.min(100, ((pos.sl - currentPrice) / range) * 100));
        }
    },

    _calcDistToTarget(pos, price, target) {
        let targetPrice;
        if (target === 'tp') targetPrice = pos.tp;
        else if (target === 'sl') targetPrice = pos.sl;
        else if (target === 'liq') targetPrice = pos.liq;
        else return 0;

        return ((Math.abs(targetPrice - price) / price) * 100).toFixed(2);
    },

    _calcDuration(timestamp) {
        const ms = Date.now() - new Date(timestamp).getTime();
        const s = Math.floor(ms / 1000);
        const m = Math.floor(s / 60);
        const h = Math.floor(m / 60);
        const d = Math.floor(h / 24);
        if (d > 0) return `${d}d ${h % 24}h`;
        if (h > 0) return `${h}h ${m % 60}m`;
        if (m > 0) return `${m}m ${s % 60}s`;
        return `${s}s`;
    },

    // ═══════════════════════════════════════
    // AUTONOMY STATUS
    // ═══════════════════════════════════════

    _updateAutonomyStatus() {
        if (typeof Autonomy === 'undefined') return;

        const status = Autonomy.getStatus ? Autonomy.getStatus() : {};
        const bots = typeof Lab !== 'undefined' ? Lab.getBots?.() || [] : [];
        const activeBots = bots.filter(b => b.running);

        // Calculate session stats from active bots
        let sessionPnl = 0;
        let sessionTrades = 0;
        let sessionWins = 0;

        activeBots.forEach(bot => {
            sessionPnl += bot.pnl || 0;
            sessionTrades += bot.trades?.length || 0;
            sessionWins += (bot.trades || []).filter(t => t.pnl > 0).length;
        });

        const winRate = sessionTrades > 0 ? (sessionWins / sessionTrades) * 100 : 0;

        this._status.autonomy = {
            running: status.running || false,
            level: status.level || 0,
            levelName: this._getLevelName(status.level || 0),
            activeBots: activeBots.length,
            maxBots: status.maxBots || 10,
            sessionPnl,
            sessionTrades,
            winRate: winRate.toFixed(1),
            nextCheck: status.nextCheck || null,
            lastCheck: status.lastCheck || null,
            mode: status.mode || 'intra',
        };

        this._notify('autonomy', this._status.autonomy);
    },

    _getLevelName(level) {
        const names = ['Manual', 'Suggestions', 'Semi-Auto', 'Full-Auto'];
        return names[level] || 'Manual';
    },

    // ═══════════════════════════════════════
    // BOT STATUS
    // ═══════════════════════════════════════

    _updateBotStatus() {
        if (typeof Lab === 'undefined') return;

        const bots = Lab.getBots?.() || [];

        this._status.bots = bots.map(bot => {
            const price = State.prices[bot.symbol]?.price || 0;
            let currentPnl = 0;
            let currentPosition = null;

            // Check if bot has open position
            if (bot.positions && bot.positions.length > 0) {
                const pos = bot.positions[0];
                currentPnl = this._calculatePnL(pos, price);
                currentPosition = {
                    symbol: pos.symbol,
                    direction: pos.direction,
                    pnl: currentPnl,
                    pnlPercent: pos.margin > 0 ? ((currentPnl / pos.margin) * 100).toFixed(1) : 0,
                    progress: this._calculateProgress(pos, price),
                };
            }

            // Determine status
            let status = 'idle';
            let statusText = 'En espera';
            if (bot._analyzing) {
                status = 'analyzing';
                statusText = `Analizando ${bot._currentAnalysis || bot.symbol}...`;
            } else if (currentPosition) {
                status = 'trading';
                statusText = `${currentPosition.direction} ${currentPosition.symbol}`;
            } else if (!bot.running) {
                status = 'paused';
                statusText = 'Pausado';
            }

            // Calculate next analysis time
            const lastAnalysis = bot._lastAnalysis || 0;
            const interval = bot.config?.analysisInterval || 60000;
            const nextAnalysis = lastAnalysis + interval - Date.now();

            return {
                id: bot.id,
                name: bot.name,
                symbol: bot.symbol,
                running: bot.running,
                status,
                statusText,
                grade: bot.grade || 'C',
                temperature: bot.temperature || 'normal',
                balance: bot.wallet || 0,
                pnl: bot.pnl || 0,
                pnlPercent: bot.wallet > 0 ? ((bot.pnl / bot.wallet) * 100).toFixed(1) : 0,
                trades: bot.trades?.length || 0,
                winRate: this._calcBotWinRate(bot),
                currentPosition,
                nextAnalysis: nextAnalysis > 0 ? this._formatTime(nextAnalysis) : 'Pronto',
                progress: bot._analysisProgress || 0,
            };
        });

        this._notify('botStatus', this._status.bots);
    },

    _calcBotWinRate(bot) {
        const trades = bot.trades || [];
        if (trades.length === 0) return 0;
        const wins = trades.filter(t => t.pnl > 0).length;
        return ((wins / trades.length) * 100).toFixed(0);
    },

    _formatTime(ms) {
        if (ms < 60000) return `${Math.round(ms / 1000)}s`;
        return `${Math.round(ms / 60000)}m`;
    },

    // ═══════════════════════════════════════
    // MASTERBOTS
    // ═══════════════════════════════════════

    async _updateMasterBots() {
        if (typeof MasterBots === 'undefined') return;
        if (!State.symbol || !State.candles || State.candles.length < 21) return;

        try {
            const candles = State.candles.map(c => ({
                open: c.o, high: c.h, low: c.l, close: c.c, volume: c.v
            }));

            const indicators = this._computeIndicators(State.candles);
            await MasterBots.analyzeAll(State.symbol, candles, indicators);

            const reports = MasterBots.getReports?.(State.symbol) || [];

            // Calculate consensus
            let greenCount = 0;
            let totalScore = 0;
            const botResults = [];

            reports.forEach(report => {
                if (!report) return;
                const signal = (report.signal || '').toLowerCase();
                if (signal === 'long' || signal === 'green' || signal === 'buy') greenCount++;
                totalScore += report.score || 50;
                botResults.push({
                    name: report.name || report.bot,
                    signal: this._normalizeSignal(signal),
                    score: report.score || 50,
                    reason: report.reason || report.reasons?.[0] || '',
                });
            });

            const totalBots = reports.length || 7;
            const consensus = greenCount / totalBots;
            let consensusSignal = 'neutral';
            if (consensus >= 0.6) consensusSignal = 'bullish';
            else if (consensus <= 0.4) consensusSignal = 'bearish';

            this._status.masterBots = {
                lastUpdate: Date.now(),
                symbol: State.symbol,
                consensus: consensusSignal,
                consensusPercent: ((greenCount / totalBots) * 100).toFixed(0),
                avgScore: (totalScore / totalBots).toFixed(0),
                bots: botResults,
            };

            this._notify('masterBots', this._status.masterBots);
        } catch (e) {
            console.warn('MasterBots update error:', e);
        }
    },

    _normalizeSignal(signal) {
        if (!signal) return 'neutral';
        signal = signal.toLowerCase();
        if (['long', 'green', 'buy', 'bullish'].includes(signal)) return 'bullish';
        if (['short', 'red', 'sell', 'bearish'].includes(signal)) return 'bearish';
        return 'neutral';
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

    // ═══════════════════════════════════════
    // RADAR STATUS
    // ═══════════════════════════════════════

    updateRadarProgress(current, total, symbol) {
        this._status.radar.scanning = current < total;
        this._status.radar.currentSymbol = symbol;
        this._status.radar.progress = current;
        this._status.radar.total = total;

        this._notify('radar', this._status.radar);
    },

    setRadarResults(results) {
        this._status.radar.results = results;
        this._status.radar.scanning = false;
        this._status.radar.lastScan = Date.now();

        this._notify('radar', this._status.radar);
    },

    // ═══════════════════════════════════════
    // PUBLIC GETTERS
    // ═══════════════════════════════════════

    getAutonomyStatus() {
        return this._status.autonomy;
    },

    getBotStatus() {
        return this._status.bots;
    },

    getMasterBotsStatus() {
        return this._status.masterBots;
    },

    getRadarStatus() {
        return this._status.radar;
    },
};

// Auto-init when DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => LiveUpdater.init());
} else {
    LiveUpdater.init();
}
