/* ========================================
   TradeDB — IndexedDB Persistence Layer
   TheRealShortShady v4.4

   Persistent storage for:
   - Complete trade history
   - Bot knowledge/learning data
   - Performance metrics over time
   - System snapshots for analysis
   ======================================== */

const TradeDB = {

    _db: null,
    _dbName: 'TradingPlatformDB',
    _dbVersion: 1,
    _ready: false,
    _readyCallbacks: [],

    // ==========================================
    //  INITIALIZATION
    // ==========================================

    async init() {
        if (this._db) return this._db;

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this._dbName, this._dbVersion);

            request.onerror = (event) => {
                console.error('TradeDB: Error opening database', event);
                reject(event.target.error);
            };

            request.onsuccess = (event) => {
                this._db = event.target.result;
                this._ready = true;
                console.log('TradeDB: Database ready');

                // Execute queued callbacks
                this._readyCallbacks.forEach(cb => cb());
                this._readyCallbacks = [];

                resolve(this._db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // ─── TRADES STORE ───
                // Complete history of all closed trades
                if (!db.objectStoreNames.contains('trades')) {
                    const tradesStore = db.createObjectStore('trades', { keyPath: 'id' });
                    tradesStore.createIndex('symbol', 'symbol', { unique: false });
                    tradesStore.createIndex('botId', 'botId', { unique: false });
                    tradesStore.createIndex('closedAt', 'closedAt', { unique: false });
                    tradesStore.createIndex('direction', 'direction', { unique: false });
                }

                // ─── BOT KNOWLEDGE STORE ───
                // Learning data per bot
                if (!db.objectStoreNames.contains('botKnowledge')) {
                    const knowledgeStore = db.createObjectStore('botKnowledge', { keyPath: 'id' });
                    knowledgeStore.createIndex('botId', 'botId', { unique: false });
                    knowledgeStore.createIndex('timestamp', 'timestamp', { unique: false });
                }

                // ─── METRICS SNAPSHOTS ───
                // Daily/hourly performance snapshots
                if (!db.objectStoreNames.contains('metrics')) {
                    const metricsStore = db.createObjectStore('metrics', { keyPath: 'id' });
                    metricsStore.createIndex('type', 'type', { unique: false });
                    metricsStore.createIndex('timestamp', 'timestamp', { unique: false });
                }

                // ─── SYSTEM STATE SNAPSHOTS ───
                // For recovery and analysis
                if (!db.objectStoreNames.contains('snapshots')) {
                    const snapshotStore = db.createObjectStore('snapshots', { keyPath: 'id' });
                    snapshotStore.createIndex('timestamp', 'timestamp', { unique: false });
                }

                console.log('TradeDB: Schema created/upgraded');
            };
        });
    },

    /** Wait for DB to be ready */
    onReady(callback) {
        if (this._ready) {
            callback();
        } else {
            this._readyCallbacks.push(callback);
        }
    },

    // ==========================================
    //  TRADES
    // ==========================================

    /** Save a completed trade */
    async saveTrade(trade) {
        if (!this._db) await this.init();

        return new Promise((resolve, reject) => {
            const tx = this._db.transaction(['trades'], 'readwrite');
            const store = tx.objectStore('trades');

            // Ensure required fields
            const record = {
                id: trade.id || `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                symbol: trade.symbol,
                direction: trade.direction,
                entry: trade.entry,
                exit: trade.exit,
                size: trade.size,
                margin: trade.margin,
                leverage: trade.leverage,
                pnl: trade.pnl,
                pnlPercent: trade.pnlPercent,
                fee: trade.fee,
                openedAt: trade.openedAt,
                closedAt: trade.closedAt || new Date().toISOString(),
                duration: trade.duration,
                reason: trade.reason,
                botId: trade.botId || 'manual',
                botName: trade.botName || 'Manual Trade',
                // Analysis context
                confidence: trade.confidence,
                thesis: trade.thesis,
                regime: trade.regime,
                indicators: trade.indicators || {},
                masterBotVotes: trade.masterBotVotes,
                // Learning metadata
                hourBlock: Math.floor(new Date(trade.openedAt).getHours() / 4),
                dayOfWeek: new Date(trade.openedAt).getDay(),
                atr: trade.atr,
                volatility: trade.volatility,
            };

            const request = store.put(record);
            request.onsuccess = () => resolve(record);
            request.onerror = () => reject(request.error);
        });
    },

    /** Get all trades, optionally filtered */
    async getTrades(filter = {}) {
        if (!this._db) await this.init();

        return new Promise((resolve, reject) => {
            const tx = this._db.transaction(['trades'], 'readonly');
            const store = tx.objectStore('trades');
            const request = store.getAll();

            request.onsuccess = () => {
                let trades = request.result || [];

                // Apply filters
                if (filter.botId) {
                    trades = trades.filter(t => t.botId === filter.botId);
                }
                if (filter.symbol) {
                    trades = trades.filter(t => t.symbol === filter.symbol);
                }
                if (filter.direction) {
                    trades = trades.filter(t => t.direction === filter.direction);
                }
                if (filter.since) {
                    const sinceDate = new Date(filter.since).getTime();
                    trades = trades.filter(t => new Date(t.closedAt).getTime() >= sinceDate);
                }
                if (filter.limit) {
                    trades = trades.slice(-filter.limit);
                }

                // Sort by closedAt descending (most recent first)
                trades.sort((a, b) => new Date(b.closedAt) - new Date(a.closedAt));

                resolve(trades);
            };
            request.onerror = () => reject(request.error);
        });
    },

    /** Get trades for a specific bot with time decay weights */
    async getTradesWithDecay(botId, halfLifeDays = 30) {
        const trades = await this.getTrades({ botId });
        const now = Date.now();
        const halfLifeMs = halfLifeDays * 24 * 60 * 60 * 1000;

        return trades.map(trade => {
            const age = now - new Date(trade.closedAt).getTime();
            // Exponential decay: weight = 0.5^(age/halfLife)
            const weight = Math.pow(0.5, age / halfLifeMs);
            return { ...trade, weight };
        });
    },

    /** Get trade statistics */
    async getTradeStats(filter = {}) {
        const trades = await this.getTrades(filter);

        if (trades.length === 0) {
            return {
                count: 0,
                wins: 0,
                losses: 0,
                winRate: 0,
                totalPnl: 0,
                avgPnl: 0,
                avgWin: 0,
                avgLoss: 0,
                profitFactor: 0,
                maxDrawdown: 0,
                sharpeRatio: 0,
                sortinoRatio: 0,
                maxConsecutiveWins: 0,
                maxConsecutiveLosses: 0,
            };
        }

        const wins = trades.filter(t => t.pnl > 0);
        const losses = trades.filter(t => t.pnl <= 0);
        const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
        const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
        const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));

        // Calculate max drawdown (peak-to-trough)
        let peak = 0;
        let maxDD = 0;
        let runningPnl = 0;
        for (const trade of trades.slice().reverse()) { // chronological order
            runningPnl += trade.pnl;
            if (runningPnl > peak) peak = runningPnl;
            const dd = peak - runningPnl;
            if (dd > maxDD) maxDD = dd;
        }

        // Sharpe Ratio (daily returns proxy)
        const returns = trades.map(t => t.pnlPercent || 0);
        const avgReturn = returns.reduce((s, r) => s + r, 0) / returns.length;
        const stdDev = Math.sqrt(
            returns.reduce((s, r) => s + Math.pow(r - avgReturn, 2), 0) / returns.length
        );
        const sharpe = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0; // Annualized

        // Sortino Ratio (only downside deviation)
        const negReturns = returns.filter(r => r < 0);
        const downsideDev = negReturns.length > 0
            ? Math.sqrt(negReturns.reduce((s, r) => s + Math.pow(r, 2), 0) / negReturns.length)
            : 0;
        const sortino = downsideDev > 0 ? (avgReturn / downsideDev) * Math.sqrt(252) : 0;

        // Consecutive wins/losses
        let maxConsecWins = 0, maxConsecLosses = 0;
        let consecWins = 0, consecLosses = 0;
        for (const trade of trades.slice().reverse()) {
            if (trade.pnl > 0) {
                consecWins++;
                consecLosses = 0;
                if (consecWins > maxConsecWins) maxConsecWins = consecWins;
            } else {
                consecLosses++;
                consecWins = 0;
                if (consecLosses > maxConsecLosses) maxConsecLosses = consecLosses;
            }
        }

        return {
            count: trades.length,
            wins: wins.length,
            losses: losses.length,
            winRate: (wins.length / trades.length) * 100,
            totalPnl,
            avgPnl: totalPnl / trades.length,
            avgWin: wins.length > 0 ? grossProfit / wins.length : 0,
            avgLoss: losses.length > 0 ? grossLoss / losses.length : 0,
            profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
            maxDrawdown: maxDD,
            sharpeRatio: sharpe,
            sortinoRatio: sortino,
            maxConsecutiveWins: maxConsecWins,
            maxConsecutiveLosses: maxConsecLosses,
            grossProfit,
            grossLoss,
        };
    },

    // ==========================================
    //  BOT KNOWLEDGE
    // ==========================================

    /** Save bot learning snapshot */
    async saveBotKnowledge(botId, knowledge) {
        if (!this._db) await this.init();

        return new Promise((resolve, reject) => {
            const tx = this._db.transaction(['botKnowledge'], 'readwrite');
            const store = tx.objectStore('botKnowledge');

            const record = {
                id: `${botId}_${Date.now()}`,
                botId,
                timestamp: new Date().toISOString(),
                knowledge: knowledge,
            };

            const request = store.put(record);
            request.onsuccess = () => resolve(record);
            request.onerror = () => reject(request.error);
        });
    },

    /** Get latest knowledge for a bot */
    async getBotKnowledge(botId) {
        if (!this._db) await this.init();

        return new Promise((resolve, reject) => {
            const tx = this._db.transaction(['botKnowledge'], 'readonly');
            const store = tx.objectStore('botKnowledge');
            const index = store.index('botId');
            const request = index.getAll(botId);

            request.onsuccess = () => {
                const records = request.result || [];
                if (records.length === 0) {
                    resolve(null);
                } else {
                    // Return most recent
                    records.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
                    resolve(records[0].knowledge);
                }
            };
            request.onerror = () => reject(request.error);
        });
    },

    // ==========================================
    //  METRICS SNAPSHOTS
    // ==========================================

    /** Save a metrics snapshot */
    async saveMetrics(type, data) {
        if (!this._db) await this.init();

        return new Promise((resolve, reject) => {
            const tx = this._db.transaction(['metrics'], 'readwrite');
            const store = tx.objectStore('metrics');

            const record = {
                id: `${type}_${Date.now()}`,
                type,
                timestamp: new Date().toISOString(),
                data,
            };

            const request = store.put(record);
            request.onsuccess = () => resolve(record);
            request.onerror = () => reject(request.error);
        });
    },

    /** Get metrics history */
    async getMetrics(type, limit = 100) {
        if (!this._db) await this.init();

        return new Promise((resolve, reject) => {
            const tx = this._db.transaction(['metrics'], 'readonly');
            const store = tx.objectStore('metrics');
            const index = store.index('type');
            const request = index.getAll(type);

            request.onsuccess = () => {
                let records = request.result || [];
                records.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
                resolve(records.slice(0, limit));
            };
            request.onerror = () => reject(request.error);
        });
    },

    // ==========================================
    //  STATISTICAL UTILITIES
    // ==========================================

    /**
     * Binomial test: Is the win rate significantly different from 50%?
     * Returns p-value (lower = more significant)
     */
    binomialTest(wins, total, expectedP = 0.5) {
        if (total === 0) return 1;

        // Using normal approximation for large samples
        if (total >= 30) {
            const p = wins / total;
            const se = Math.sqrt(expectedP * (1 - expectedP) / total);
            const z = (p - expectedP) / se;
            // Two-tailed p-value using error function approximation
            return 2 * (1 - this._normalCDF(Math.abs(z)));
        }

        // Exact binomial for small samples
        let pValue = 0;
        const observed = wins;
        for (let k = 0; k <= total; k++) {
            const prob = this._binomialPMF(k, total, expectedP);
            const kProb = this._binomialPMF(observed, total, expectedP);
            if (prob <= kProb) {
                pValue += prob;
            }
        }
        return Math.min(1, pValue);
    },

    /** Binomial probability mass function */
    _binomialPMF(k, n, p) {
        return this._binomialCoeff(n, k) * Math.pow(p, k) * Math.pow(1 - p, n - k);
    },

    /** Binomial coefficient (n choose k) */
    _binomialCoeff(n, k) {
        if (k > n) return 0;
        if (k === 0 || k === n) return 1;
        let result = 1;
        for (let i = 0; i < k; i++) {
            result = result * (n - i) / (i + 1);
        }
        return result;
    },

    /** Normal CDF approximation */
    _normalCDF(x) {
        const a1 =  0.254829592;
        const a2 = -0.284496736;
        const a3 =  1.421413741;
        const a4 = -1.453152027;
        const a5 =  1.061405429;
        const p  =  0.3275911;

        const sign = x < 0 ? -1 : 1;
        x = Math.abs(x) / Math.sqrt(2);

        const t = 1.0 / (1.0 + p * x);
        const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

        return 0.5 * (1.0 + sign * y);
    },

    /**
     * Calculate confidence interval for win rate
     * Returns { lower, upper } bounds (95% CI)
     */
    winRateConfidenceInterval(wins, total) {
        if (total === 0) return { lower: 0, upper: 1, width: 1 };

        const p = wins / total;
        // Wilson score interval (better for small samples)
        const z = 1.96; // 95% CI
        const denominator = 1 + z * z / total;
        const center = (p + z * z / (2 * total)) / denominator;
        const margin = (z / denominator) * Math.sqrt(p * (1 - p) / total + z * z / (4 * total * total));

        return {
            lower: Math.max(0, center - margin),
            upper: Math.min(1, center + margin),
            width: 2 * margin,
        };
    },

    /**
     * Check if win rate is statistically significant
     * Returns { significant, pValue, confidence, interpretation }
     */
    isWinRateSignificant(wins, total, threshold = 0.05) {
        const wr = total > 0 ? wins / total : 0;
        const pValue = this.binomialTest(wins, total, 0.5);
        const ci = this.winRateConfidenceInterval(wins, total);

        let interpretation = '';
        if (total < 10) {
            interpretation = 'Insufficient data (need 10+ trades)';
        } else if (total < 30) {
            interpretation = 'Limited data - interpret with caution';
        } else if (pValue < 0.01) {
            interpretation = wr > 0.5 ? 'Highly significant edge' : 'Highly significant underperformance';
        } else if (pValue < 0.05) {
            interpretation = wr > 0.5 ? 'Significant edge' : 'Significant underperformance';
        } else {
            interpretation = 'Not statistically different from random';
        }

        return {
            significant: pValue < threshold && total >= 10,
            pValue,
            winRate: wr,
            confidence: ci,
            sampleSize: total,
            interpretation,
        };
    },

    // ==========================================
    //  CLEANUP & MAINTENANCE
    // ==========================================

    /** Remove old data to save space */
    async cleanup(keepDays = 180) {
        if (!this._db) await this.init();

        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - keepDays);
        const cutoffISO = cutoff.toISOString();

        let deleted = 0;

        // Clean old metrics
        const metricsTx = this._db.transaction(['metrics'], 'readwrite');
        const metricsStore = metricsTx.objectStore('metrics');
        const metricsRequest = metricsStore.openCursor();

        await new Promise((resolve) => {
            metricsRequest.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    if (cursor.value.timestamp < cutoffISO) {
                        cursor.delete();
                        deleted++;
                    }
                    cursor.continue();
                } else {
                    resolve();
                }
            };
        });

        console.log(`TradeDB: Cleaned up ${deleted} old records`);
        return deleted;
    },

    /** Export all data for backup */
    async exportAll() {
        if (!this._db) await this.init();

        const trades = await this.getTrades({});
        const metrics = await this.getMetrics('daily', 1000);

        return {
            version: this._dbVersion,
            exportedAt: new Date().toISOString(),
            trades,
            metrics,
        };
    },

    /** Import data from backup */
    async importData(data) {
        if (!data || !data.trades) return false;

        let imported = 0;
        for (const trade of data.trades) {
            await this.saveTrade(trade);
            imported++;
        }

        console.log(`TradeDB: Imported ${imported} trades`);
        return imported;
    },

    /** Get database stats */
    async getDBStats() {
        const trades = await this.getTrades({});
        const now = new Date();
        const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
        const recentTrades = trades.filter(t => new Date(t.closedAt) >= thirtyDaysAgo);

        return {
            totalTrades: trades.length,
            last30DaysTrades: recentTrades.length,
            oldestTrade: trades.length > 0 ? trades[trades.length - 1].closedAt : null,
            newestTrade: trades.length > 0 ? trades[0].closedAt : null,
            uniqueBots: [...new Set(trades.map(t => t.botId))].length,
            uniqueSymbols: [...new Set(trades.map(t => t.symbol))].length,
        };
    }
};

// Auto-initialize when loaded
TradeDB.init().catch(e => console.error('TradeDB init error:', e));
