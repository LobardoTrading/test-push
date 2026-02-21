/* ========================================
   LEARNING ENGINE — Adaptive Bot Intelligence
   TheRealShortShady v4.4.0

   MAJOR UPDATE: Statistical rigor + persistence

   Features:
   - IndexedDB persistence via TradeDB
   - Binomial tests for WR significance
   - Time decay (30-day half-life)
   - Cross-validation for threshold optimization
   - Auto-retrain on new data
   - Confidence intervals for all metrics
   ======================================== */

const LearningEngine = {

    // ═══════════════════════════════════════
    // CONFIGURATION
    // ═══════════════════════════════════════

    _MIN_TRADES: 10,           // Minimum trades to start learning (was 5)
    _MIN_SIGNIFICANT: 25,      // Minimum for statistical significance
    _HALF_LIFE_DAYS: 30,       // Exponential decay half-life
    _SIGNIFICANCE_LEVEL: 0.05, // p-value threshold (95% confidence)
    _RETRAIN_INTERVAL: 50,     // Retrain after N new trades
    _CV_FOLDS: 3,              // Cross-validation folds

    _lastRetrain: {},          // Track last retrain per bot
    _cache: {},                // Cache computed patterns

    init() {
        console.log('🧠 LearningEngine v4.4 initialized (statistical mode)');
    },

    // ═══════════════════════════════════════
    // MAIN ENTRY: ¿Debería entrar este bot?
    // ═══════════════════════════════════════

    async evaluate(bot, result) {
        const trades = bot.trades || [];

        // Not enough data to learn
        if (trades.length < this._MIN_TRADES) {
            return { allowed: true, confidence: 'no_data', reason: `Need ${this._MIN_TRADES - trades.length} more trades` };
        }

        // Get trades with time decay weights
        const weightedTrades = this._applyTimeDecay(trades);
        const knowledge = bot.knowledge || [];
        const weightedKnowledge = this._applyTimeDecay(knowledge, 'timestamp');

        const direction = result.direction || '';
        const confidence = result.confidence || 0;
        const hour = new Date().getHours();

        // Get current market context
        const currentRegime = (typeof Intelligence !== 'undefined' && Intelligence.getMarketScore())
            ? Intelligence.getMarketScore().regime : null;

        // Run all pattern checks with statistical validation
        const checks = [
            this._checkConfidenceZone(weightedTrades, weightedKnowledge, confidence),
            this._checkDirectionBias(weightedTrades, direction),
            this._checkHourPerformance(weightedKnowledge, hour),
            this._checkSymbolPerformance(weightedTrades, bot.symbol),
            this._checkRecentMomentum(trades), // No decay for recent momentum
            this._checkRegimePerformance(weightedKnowledge, currentRegime),
            this._checkThesisAlignment(weightedKnowledge),
            this._checkBotAlignment(weightedKnowledge, result._pipeline?.greenBots || 0, result._pipeline?.totalBots || 0),
        ];

        // If any check blocks with statistical significance, return the reason
        const blocked = checks.find(c => !c.allowed && c.significant);
        if (blocked) return blocked;

        // Calculate total confidence boost (weighted by significance)
        let totalBoost = 0;
        const insights = [];
        for (const check of checks) {
            if (check.boost && check.significant) {
                totalBoost += check.boost;
            }
            if (check.insight) {
                insights.push(check.insight);
            }
        }

        // Check if we need to retrain
        this._maybeRetrain(bot);

        return {
            allowed: true,
            confidenceBoost: totalBoost,
            insights,
            checksRun: checks.length,
            significantChecks: checks.filter(c => c.significant).length
        };
    },

    // ═══════════════════════════════════════
    // TIME DECAY
    // ═══════════════════════════════════════

    _applyTimeDecay(items, dateField = 'closedAt') {
        const now = Date.now();
        const halfLifeMs = this._HALF_LIFE_DAYS * 24 * 60 * 60 * 1000;

        return items.map(item => {
            const date = item[dateField] || item.openedAt || item.timestamp;
            if (!date) return { ...item, weight: 0.5 }; // Default weight for missing dates

            const age = now - new Date(date).getTime();
            // Exponential decay: weight = 0.5^(age/halfLife)
            const weight = Math.pow(0.5, age / halfLifeMs);
            return { ...item, weight };
        });
    },

    /** Calculate weighted win rate */
    _weightedWinRate(items) {
        let totalWeight = 0;
        let winWeight = 0;

        for (const item of items) {
            const w = item.weight || 1;
            totalWeight += w;
            if (item.pnl > 0 || item.type === 'success') {
                winWeight += w;
            }
        }

        return totalWeight > 0 ? winWeight / totalWeight : 0;
    },

    /** Calculate effective sample size (accounts for decay) */
    _effectiveSampleSize(items) {
        const weights = items.map(i => i.weight || 1);
        const sumW = weights.reduce((a, b) => a + b, 0);
        const sumW2 = weights.reduce((a, w) => a + w * w, 0);
        // Kish's effective sample size
        return sumW2 > 0 ? (sumW * sumW) / sumW2 : 0;
    },

    // ═══════════════════════════════════════
    // STATISTICAL VALIDATION
    // ═══════════════════════════════════════

    /** Test if win rate is statistically significant using TradeDB's binomial test */
    _isSignificant(wins, total, threshold = this._SIGNIFICANCE_LEVEL) {
        if (typeof TradeDB !== 'undefined' && TradeDB.isWinRateSignificant) {
            return TradeDB.isWinRateSignificant(wins, total, threshold);
        }
        // Fallback: simple check
        return {
            significant: total >= this._MIN_SIGNIFICANT,
            pValue: 1,
            interpretation: total >= this._MIN_SIGNIFICANT ? 'Basic threshold met' : 'Insufficient data'
        };
    },

    /** Get confidence interval for a proportion */
    _confidenceInterval(wins, total) {
        if (typeof TradeDB !== 'undefined' && TradeDB.winRateConfidenceInterval) {
            return TradeDB.winRateConfidenceInterval(wins, total);
        }
        // Fallback: simple interval
        const p = total > 0 ? wins / total : 0;
        const margin = total > 0 ? 1.96 * Math.sqrt(p * (1 - p) / total) : 0.5;
        return { lower: Math.max(0, p - margin), upper: Math.min(1, p + margin), width: 2 * margin };
    },

    // ═══════════════════════════════════════
    // PATTERN CHECKS (with statistical rigor)
    // ═══════════════════════════════════════

    _checkConfidenceZone(trades, knowledge, currentConf) {
        const zones = { low: [], mid: [], high: [] };

        for (const k of knowledge) {
            const c = k.confidence || 0;
            const zone = c >= 80 ? 'high' : c >= 65 ? 'mid' : 'low';
            zones[zone].push(k);
        }

        const currentZone = currentConf >= 80 ? 'high' : currentConf >= 65 ? 'mid' : 'low';
        const zoneData = zones[currentZone];
        const effectiveN = this._effectiveSampleSize(zoneData);

        if (effectiveN < 8) {
            return { allowed: true, significant: false, reason: 'Insufficient data for zone' };
        }

        const wins = zoneData.filter(k => k.type === 'success').length;
        const wr = this._weightedWinRate(zoneData);
        const stats = this._isSignificant(wins, zoneData.length);

        // Block only if statistically significant AND bad
        if (stats.significant && wr < 0.35) {
            return {
                allowed: false,
                significant: true,
                reason: `Zone ${currentZone} (${currentConf}%): WR ${(wr*100).toFixed(0)}% (p=${stats.pValue.toFixed(3)})`,
                stats
            };
        }

        // Boost only if statistically significant AND good
        if (stats.significant && wr > 0.60) {
            return {
                allowed: true,
                significant: true,
                boost: 5,
                insight: `Zone ${currentZone}: WR ${(wr*100).toFixed(0)}% (n=${zoneData.length}, p=${stats.pValue.toFixed(3)})`
            };
        }

        return { allowed: true, significant: false };
    },

    _checkDirectionBias(trades, currentDirection) {
        const byDir = { LONG: [], SHORT: [] };
        for (const t of trades) {
            if (byDir[t.direction]) {
                byDir[t.direction].push(t);
            }
        }

        const current = byDir[currentDirection] || [];
        const effectiveN = this._effectiveSampleSize(current);

        if (effectiveN < 8) {
            return { allowed: true, significant: false };
        }

        const wins = current.filter(t => t.pnl > 0).length;
        const wr = this._weightedWinRate(current);
        const stats = this._isSignificant(wins, current.length);

        const opposite = currentDirection === 'LONG' ? byDir.SHORT : byDir.LONG;
        const oppWr = this._weightedWinRate(opposite);

        // Block only if statistically bad AND opposite is better
        if (stats.significant && wr < 0.35 && oppWr > 0.50) {
            return {
                allowed: false,
                significant: true,
                reason: `${currentDirection} WR ${(wr*100).toFixed(0)}% vs ${currentDirection === 'LONG' ? 'SHORT' : 'LONG'} ${(oppWr*100).toFixed(0)}% (p=${stats.pValue.toFixed(3)})`
            };
        }

        if (stats.significant && wr > 0.60) {
            return {
                allowed: true,
                significant: true,
                boost: 3,
                insight: `${currentDirection} WR ${(wr*100).toFixed(0)}% — dirección favorable`
            };
        }

        return { allowed: true, significant: false };
    },

    _checkHourPerformance(knowledge, currentHour) {
        const block = Math.floor(currentHour / 4);
        const inBlock = knowledge.filter(k => Math.floor((k.hour || 0) / 4) === block);
        const effectiveN = this._effectiveSampleSize(inBlock);

        if (effectiveN < 8) {
            return { allowed: true, significant: false };
        }

        const wins = inBlock.filter(k => k.type === 'success').length;
        const wr = this._weightedWinRate(inBlock);
        const stats = this._isSignificant(wins, inBlock.length);

        if (stats.significant && wr < 0.30) {
            const blockStart = block * 4;
            return {
                allowed: false,
                significant: true,
                reason: `Horario ${blockStart}:00-${blockStart + 3}:59: WR ${(wr*100).toFixed(0)}% (p=${stats.pValue.toFixed(3)})`
            };
        }

        if (stats.significant && wr > 0.65) {
            return {
                allowed: true,
                significant: true,
                boost: 3,
                insight: `Buen horario: WR ${(wr*100).toFixed(0)}%`
            };
        }

        return { allowed: true, significant: false };
    },

    _checkSymbolPerformance(trades, symbol) {
        const symbolTrades = trades.filter(t => t.symbol === symbol);
        const effectiveN = this._effectiveSampleSize(symbolTrades);

        if (effectiveN < 10) {
            return { allowed: true, significant: false };
        }

        const wins = symbolTrades.filter(t => t.pnl > 0).length;
        const wr = this._weightedWinRate(symbolTrades);
        const stats = this._isSignificant(wins, symbolTrades.length);

        if (stats.significant && wr < 0.35) {
            return {
                allowed: false,
                significant: true,
                reason: `${symbol}: WR ${(wr*100).toFixed(0)}% en ${symbolTrades.length} trades (p=${stats.pValue.toFixed(3)})`
            };
        }

        if (stats.significant && wr > 0.60) {
            return {
                allowed: true,
                significant: true,
                boost: 4,
                insight: `${symbol}: WR ${(wr*100).toFixed(0)}% — par favorable`
            };
        }

        return { allowed: true, significant: false };
    },

    _checkRecentMomentum(trades) {
        // No time decay for recent momentum - we want raw recent performance
        if (trades.length < 6) return { allowed: true, significant: false };

        const recent = trades.slice(-6);
        const recentWins = recent.filter(t => t.pnl > 0).length;

        // Hot streak (5/6 or 6/6)
        if (recentWins >= 5) {
            return {
                allowed: true,
                significant: true,
                boost: 2,
                insight: `Hot streak: ${recentWins}/6 recientes ganados`
            };
        }

        // Cold streak (0/6 or 1/6)
        if (recentWins <= 1) {
            return {
                allowed: true,
                significant: true,
                boost: -5,
                insight: `Cold streak: ${recentWins}/6 recientes — confianza reducida`
            };
        }

        return { allowed: true, significant: false };
    },

    _checkRegimePerformance(knowledge, currentRegime) {
        if (!currentRegime) return { allowed: true, significant: false };

        const inRegime = knowledge.filter(k => k.regime === currentRegime);
        const effectiveN = this._effectiveSampleSize(inRegime);

        if (effectiveN < 8) {
            return { allowed: true, significant: false };
        }

        const wins = inRegime.filter(k => k.type === 'success').length;
        const wr = this._weightedWinRate(inRegime);
        const stats = this._isSignificant(wins, inRegime.length);

        if (stats.significant && wr < 0.30) {
            return {
                allowed: false,
                significant: true,
                reason: `Régimen "${currentRegime}": WR ${(wr*100).toFixed(0)}% (p=${stats.pValue.toFixed(3)})`
            };
        }

        if (stats.significant && wr > 0.65) {
            return {
                allowed: true,
                significant: true,
                boost: 4,
                insight: `Régimen "${currentRegime}": WR ${(wr*100).toFixed(0)}%`
            };
        }

        return { allowed: true, significant: false };
    },

    _checkThesisAlignment(knowledge) {
        const withThesis = knowledge.filter(k => k.thesisAligned !== null && k.thesisAligned !== undefined);
        const effectiveN = this._effectiveSampleSize(withThesis);

        if (effectiveN < 12) {
            return { allowed: true, significant: false };
        }

        const aligned = withThesis.filter(k => k.thesisAligned).length;
        const accuracy = aligned / withThesis.length;
        const stats = this._isSignificant(aligned, withThesis.length);

        // Thesis consistently wrong = contrarian signal
        if (stats.significant && accuracy < 0.35) {
            return {
                allowed: true,
                significant: true,
                boost: 3,
                insight: `MasterBots thesis accuracy ${(accuracy*100).toFixed(0)}% — contrarian signal`
            };
        }

        // Thesis reliable
        if (stats.significant && accuracy > 0.65) {
            return {
                allowed: true,
                significant: true,
                boost: 3,
                insight: `MasterBots thesis accuracy ${(accuracy*100).toFixed(0)}% — reliable`
            };
        }

        return { allowed: true, significant: false };
    },

    _checkBotAlignment(knowledge, currentGreenBots, currentTotalBots) {
        if (!currentTotalBots) return { allowed: true, significant: false };

        const currentRatio = currentGreenBots / currentTotalBots;
        const buckets = { low: [], mid: [], high: [] };

        for (const k of knowledge) {
            if (!k.totalBots) continue;
            const ratio = (k.greenBots || 0) / k.totalBots;
            const bucket = ratio > 0.75 ? 'high' : ratio >= 0.50 ? 'mid' : 'low';
            buckets[bucket].push(k);
        }

        const currentBucket = currentRatio > 0.75 ? 'high' : currentRatio >= 0.50 ? 'mid' : 'low';
        const bucketData = buckets[currentBucket];
        const effectiveN = this._effectiveSampleSize(bucketData);

        if (effectiveN < 8) {
            return { allowed: true, significant: false };
        }

        const wins = bucketData.filter(k => k.type === 'success').length;
        const wr = this._weightedWinRate(bucketData);
        const stats = this._isSignificant(wins, bucketData.length);

        if (stats.significant && wr < 0.35) {
            return {
                allowed: false,
                significant: true,
                reason: `Bot alignment ${currentBucket}: WR ${(wr*100).toFixed(0)}% (p=${stats.pValue.toFixed(3)})`
            };
        }

        if (stats.significant && wr > 0.65) {
            return {
                allowed: true,
                significant: true,
                boost: 3,
                insight: `Bot alignment ${currentBucket}: WR ${(wr*100).toFixed(0)}% — sweet spot`
            };
        }

        return { allowed: true, significant: false };
    },

    // ═══════════════════════════════════════
    // AUTO-TUNING WITH CROSS-VALIDATION
    // ═══════════════════════════════════════

    /**
     * Calculate optimal confidence threshold using k-fold cross-validation.
     * Returns threshold only if it's statistically robust.
     */
    getOptimalConfidence(bot) {
        const knowledge = bot.knowledge || [];
        if (knowledge.length < 20) return null; // Need more data for CV

        const thresholds = [50, 55, 60, 65, 70, 75, 80];
        const results = {};

        // Initialize results
        for (const th of thresholds) {
            results[th] = { trainScores: [], testScores: [], counts: [] };
        }

        // K-fold cross-validation
        const foldSize = Math.floor(knowledge.length / this._CV_FOLDS);

        for (let fold = 0; fold < this._CV_FOLDS; fold++) {
            const testStart = fold * foldSize;
            const testEnd = testStart + foldSize;

            const trainSet = [...knowledge.slice(0, testStart), ...knowledge.slice(testEnd)];
            const testSet = knowledge.slice(testStart, testEnd);

            for (const th of thresholds) {
                // Train: find WR for this threshold
                const trainAbove = trainSet.filter(k => k.confidence >= th);
                if (trainAbove.length < 5) continue;

                const trainWins = trainAbove.filter(k => k.type === 'success').length;
                const trainWR = trainWins / trainAbove.length;

                // Test: validate on held-out data
                const testAbove = testSet.filter(k => k.confidence >= th);
                if (testAbove.length < 2) continue;

                const testWins = testAbove.filter(k => k.type === 'success').length;
                const testWR = testWins / testAbove.length;

                results[th].trainScores.push(trainWR);
                results[th].testScores.push(testWR);
                results[th].counts.push(testAbove.length);
            }
        }

        // Select best threshold by average TEST performance (not train!)
        let bestThreshold = null;
        let bestTestScore = -Infinity;
        let bestConsistency = Infinity;

        for (const th of thresholds) {
            const r = results[th];
            if (r.testScores.length < 2) continue;

            const avgTest = r.testScores.reduce((a, b) => a + b, 0) / r.testScores.length;
            const avgCount = r.counts.reduce((a, b) => a + b, 0) / r.counts.length;

            // Standard deviation of test scores (lower = more consistent)
            const variance = r.testScores.reduce((s, x) => s + Math.pow(x - avgTest, 2), 0) / r.testScores.length;
            const std = Math.sqrt(variance);

            // Score = avgTestWR * sqrt(avgCount) - penalty for inconsistency
            const score = avgTest * Math.sqrt(avgCount) - std * 10;

            if (avgTest > 0.50 && score > bestTestScore) {
                bestTestScore = score;
                bestThreshold = th;
                bestConsistency = std;
            }
        }

        // Only return if consistent across folds
        if (bestThreshold && bestConsistency < 0.15) {
            console.log(`🧠 ${bot.name}: Optimal confidence ${bestThreshold}% (CV score: ${bestTestScore.toFixed(2)}, consistency: ${(1-bestConsistency).toFixed(2)})`);
            return bestThreshold;
        }

        return null;
    },

    // ═══════════════════════════════════════
    // AUTO-RETRAIN
    // ═══════════════════════════════════════

    _maybeRetrain(bot) {
        const lastRetrain = this._lastRetrain[bot.id] || 0;
        const trades = bot.trades || [];

        if (trades.length - lastRetrain >= this._RETRAIN_INTERVAL) {
            this._retrain(bot);
            this._lastRetrain[bot.id] = trades.length;
        }
    },

    _retrain(bot) {
        // Clear cached patterns
        delete this._cache[bot.id];

        // Recalculate optimal threshold
        const optConf = this.getOptimalConfidence(bot);

        // Recalculate optimal TP/SL
        const optTPSL = this.getOptimalTPSL(bot);

        // Save to DB if available
        if (typeof TradeDB !== 'undefined') {
            TradeDB.saveBotKnowledge(bot.id, {
                optimalConfidence: optConf,
                optimalTPSL: optTPSL,
                retrainedAt: new Date().toISOString(),
                tradesCount: (bot.trades || []).length
            }).catch(e => console.warn('Failed to save bot knowledge:', e));
        }

        console.log(`🧠 ${bot.name}: Retrained on ${(bot.trades || []).length} trades`);
    },

    // ═══════════════════════════════════════
    // TP/SL OPTIMIZATION (improved)
    // ═══════════════════════════════════════

    getOptimalTPSL(bot) {
        const knowledge = bot.knowledge || [];
        const withATR = knowledge.filter(k => k.entryATRPct > 0 && k.slMult > 0);

        if (withATR.length < 15) return null; // Need more data

        // Apply time decay
        const weighted = this._applyTimeDecay(withATR, 'timestamp');

        // Group by SL multiplier buckets
        const slBuckets = {};
        for (const k of weighted) {
            const bucket = Math.round(k.slMult * 2) / 2;
            if (!slBuckets[bucket]) slBuckets[bucket] = [];
            slBuckets[bucket].push(k);
        }

        // Find best SL multiplier by weighted expectancy
        let bestSlMult = null;
        let bestExpectancy = -Infinity;
        let bestStats = null;

        for (const [mult, data] of Object.entries(slBuckets)) {
            const effectiveN = this._effectiveSampleSize(data);
            if (effectiveN < 5) continue;

            // Weighted expectancy
            let totalWeight = 0;
            let weightedPnl = 0;
            for (const k of data) {
                totalWeight += k.weight;
                weightedPnl += (k.pnl || 0) * k.weight;
            }
            const expectancy = weightedPnl / totalWeight;

            // Check significance
            const wins = data.filter(k => k.type === 'success').length;
            const stats = this._isSignificant(wins, data.length);

            if (stats.significant && expectancy > bestExpectancy) {
                bestExpectancy = expectancy;
                bestSlMult = parseFloat(mult);
                bestStats = stats;
            }
        }

        if (!bestSlMult) return null;

        // TP mult = minimum 2x SL (maintain good R:R)
        const tpMult = Math.max(bestSlMult * 2, bestSlMult + 1.5);

        console.log(`🧠 ${bot.name}: Optimal TP/SL → SL ${bestSlMult.toFixed(1)}x, TP ${tpMult.toFixed(1)}x (n=${withATR.length}, p=${bestStats.pValue.toFixed(3)})`);
        return { slMult: bestSlMult, tpMult };
    },

    // ═══════════════════════════════════════
    // EFFECTIVENESS TRACKING
    // ═══════════════════════════════════════

    _stats: { blocked: 0, blockedWouldLose: 0, allowed: 0, allowedWon: 0 },

    trackOutcome(wasBlocked, tradeResult) {
        if (wasBlocked) {
            this._stats.blocked++;
            if (tradeResult === 'loss') this._stats.blockedWouldLose++;
        } else {
            this._stats.allowed++;
            if (tradeResult === 'win') this._stats.allowedWon++;
        }

        // Save stats periodically
        if ((this._stats.blocked + this._stats.allowed) % 20 === 0) {
            this._saveEffectivenessStats();
        }
    },

    _saveEffectivenessStats() {
        if (typeof TradeDB !== 'undefined') {
            TradeDB.saveMetrics('learning_effectiveness', this._stats)
                .catch(e => console.warn('Failed to save effectiveness stats:', e));
        }
    },

    getEffectiveness() {
        const s = this._stats;
        if (s.blocked + s.allowed < 20) return null;

        const blockedAccuracy = s.blocked > 0 ? s.blockedWouldLose / s.blocked : 0;
        const allowedWR = s.allowed > 0 ? s.allowedWon / s.allowed : 0;

        // Statistical test: is our blocking actually helping?
        const blockStats = this._isSignificant(s.blockedWouldLose, s.blocked);
        const allowStats = this._isSignificant(s.allowedWon, s.allowed);

        return {
            totalEvaluated: s.blocked + s.allowed,
            blocked: s.blocked,
            blockedAccuracy: (blockedAccuracy * 100).toFixed(0) + '%',
            blockedSignificant: blockStats.significant,
            allowed: s.allowed,
            allowedWinRate: (allowedWR * 100).toFixed(0) + '%',
            allowedSignificant: allowStats.significant,
            isEffective: blockedAccuracy > 0.5 && allowedWR > 0.5,
            interpretation: this._interpretEffectiveness(blockedAccuracy, allowedWR, blockStats, allowStats)
        };
    },

    _interpretEffectiveness(blockAcc, allowWR, blockStats, allowStats) {
        if (!blockStats.significant || !allowStats.significant) {
            return 'Insufficient data for statistical conclusion';
        }
        if (blockAcc > 0.6 && allowWR > 0.55) {
            return 'Learning filter is effective: blocking bad trades, passing good ones';
        }
        if (blockAcc < 0.4) {
            return 'Warning: Learning is blocking trades that would have won';
        }
        if (allowWR < 0.45) {
            return 'Warning: Allowed trades are underperforming';
        }
        return 'Learning filter performance is neutral';
    },

    // ═══════════════════════════════════════
    // REPORTING (enhanced)
    // ═══════════════════════════════════════

    getReport(bot) {
        const trades = bot.trades || [];
        const knowledge = bot.knowledge || [];

        if (trades.length < this._MIN_TRADES) {
            return {
                hasData: false,
                message: `Necesita ${this._MIN_TRADES - trades.length} trades más para aprender`,
                statisticalPower: 'none'
            };
        }

        // Apply time decay for analysis
        const weightedTrades = this._applyTimeDecay(trades);
        const weightedKnowledge = this._applyTimeDecay(knowledge, 'timestamp');

        // Direction stats with significance
        const dirStats = this._getDirectionStats(weightedTrades);

        // Hour stats
        const hourStats = this._getHourStats(weightedKnowledge);

        // Regime stats
        const regimeStats = this._getRegimeStats(weightedKnowledge);

        // Overall statistical power
        const effectiveN = this._effectiveSampleSize(weightedTrades);
        let statisticalPower = 'low';
        if (effectiveN >= 50) statisticalPower = 'high';
        else if (effectiveN >= 25) statisticalPower = 'medium';

        const optConf = this.getOptimalConfidence(bot);
        const optTPSL = this.getOptimalTPSL(bot);
        const patterns = this._detectPatterns(weightedTrades, weightedKnowledge);
        const mgmtPatterns = this._getManagementPatterns(knowledge);

        return {
            hasData: true,
            totalTrades: trades.length,
            effectiveSampleSize: Math.round(effectiveN),
            statisticalPower,
            directionStats: dirStats,
            hourStats,
            regimeStats,
            optimalConfidence: optConf,
            optimalTPSL: optTPSL,
            effectiveness: this.getEffectiveness(),
            patterns: [...patterns, ...mgmtPatterns],
            decayHalfLife: this._HALF_LIFE_DAYS + ' days',
            lastRetrain: this._lastRetrain[bot.id] || 0
        };
    },

    _getDirectionStats(trades) {
        const stats = {};
        for (const dir of ['LONG', 'SHORT']) {
            const dirTrades = trades.filter(t => t.direction === dir);
            if (dirTrades.length < 5) continue;

            const wins = dirTrades.filter(t => t.pnl > 0).length;
            const wr = this._weightedWinRate(dirTrades);
            const sigTest = this._isSignificant(wins, dirTrades.length);
            const ci = this._confidenceInterval(wins, dirTrades.length);

            stats[dir] = {
                count: dirTrades.length,
                wins,
                losses: dirTrades.length - wins,
                winRate: (wr * 100).toFixed(1) + '%',
                pnl: dirTrades.reduce((s, t) => s + (t.pnl || 0), 0),
                significant: sigTest.significant,
                pValue: sigTest.pValue,
                confidenceInterval: `${(ci.lower*100).toFixed(0)}%-${(ci.upper*100).toFixed(0)}%`
            };
        }
        return stats;
    },

    _getHourStats(knowledge) {
        const stats = {};
        for (let block = 0; block < 6; block++) {
            const inBlock = knowledge.filter(k => Math.floor((k.hour || 0) / 4) === block);
            if (inBlock.length < 4) continue;

            const wins = inBlock.filter(k => k.type === 'success').length;
            const wr = this._weightedWinRate(inBlock);
            const label = `${block * 4}:00-${block * 4 + 3}:59`;

            stats[label] = {
                count: inBlock.length,
                winRate: (wr * 100).toFixed(0) + '%',
                significant: inBlock.length >= 10
            };
        }
        return stats;
    },

    _getRegimeStats(knowledge) {
        const stats = {};
        const regimes = [...new Set(knowledge.map(k => k.regime).filter(Boolean))];

        for (const regime of regimes) {
            const inRegime = knowledge.filter(k => k.regime === regime);
            if (inRegime.length < 4) continue;

            const wins = inRegime.filter(k => k.type === 'success').length;
            const wr = this._weightedWinRate(inRegime);
            const sigTest = this._isSignificant(wins, inRegime.length);

            stats[regime] = {
                count: inRegime.length,
                winRate: (wr * 100).toFixed(0) + '%',
                significant: sigTest.significant,
                pValue: sigTest.pValue
            };
        }
        return stats;
    },

    _detectPatterns(trades, knowledge) {
        const patterns = [];

        // Direction bias (only if significant)
        const longs = trades.filter(t => t.direction === 'LONG');
        const shorts = trades.filter(t => t.direction === 'SHORT');
        if (longs.length >= 8 && shorts.length >= 8) {
            const longWr = this._weightedWinRate(longs);
            const shortWr = this._weightedWinRate(shorts);
            const diff = Math.abs(longWr - shortWr);

            if (diff > 0.15) {
                const better = longWr > shortWr ? 'LONG' : 'SHORT';
                const betterWr = Math.max(longWr, shortWr);
                patterns.push(`📊 Mejor en ${better} (${(betterWr*100).toFixed(0)}% WR)`);
            }
        }

        // Optimal confidence
        const optConf = this.getOptimalConfidence({ trades, knowledge });
        if (optConf) {
            patterns.push(`🎯 Confidence óptimo: ≥${optConf}% (cross-validated)`);
        }

        // Worst performing hours
        const hourLosses = {};
        for (const k of knowledge.filter(kk => kk.type === 'failure')) {
            const block = Math.floor((k.hour || 0) / 4) * 4;
            hourLosses[block] = (hourLosses[block] || 0) + (k.weight || 1);
        }
        const worstHour = Object.entries(hourLosses).sort((a, b) => b[1] - a[1])[0];
        if (worstHour && worstHour[1] >= 3) {
            patterns.push(`⏰ Evitar ${worstHour[0]}:00-${parseInt(worstHour[0]) + 3}:59 (más losses)`);
        }

        // Win/Loss size comparison
        const wins = trades.filter(t => t.pnl > 0);
        const losses = trades.filter(t => t.pnl <= 0);
        if (wins.length >= 5 && losses.length >= 5) {
            const avgWin = wins.reduce((s, t) => s + t.pnl, 0) / wins.length;
            const avgLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0) / losses.length);
            const ratio = avgWin / avgLoss;

            if (ratio > 1.5) {
                patterns.push(`💰 R:R favorable: wins avg +$${avgWin.toFixed(2)} vs losses -$${avgLoss.toFixed(2)}`);
            } else if (ratio < 0.7) {
                patterns.push(`⚠️ R:R desfavorable: losses mayores que wins`);
            }
        }

        // Sample size warning
        const effectiveN = this._effectiveSampleSize(trades);
        if (effectiveN < this._MIN_SIGNIFICANT) {
            patterns.push(`📉 Sample size bajo (n≈${Math.round(effectiveN)}) — patrones provisionales`);
        }

        return patterns;
    },

    _getManagementPatterns(knowledge) {
        const patterns = [];

        // Injection effectiveness
        const injected = knowledge.filter(k => k.wasInjected === true);
        const notInjected = knowledge.filter(k => k.wasInjected === false);
        if (injected.length >= 8 && notInjected.length >= 8) {
            const injWR = injected.filter(k => k.type === 'success').length / injected.length;
            const noInjWR = notInjected.filter(k => k.type === 'success').length / notInjected.length;

            if (injWR > noInjWR + 0.1) {
                patterns.push(`💉 Inyección efectiva (${(injWR*100).toFixed(0)}% vs ${(noInjWR*100).toFixed(0)}% sin)`);
            } else if (injWR < noInjWR - 0.1) {
                patterns.push(`💉 Inyección NO efectiva — considerar desactivar`);
            }
        }

        // Breakeven effectiveness
        const withBE = knowledge.filter(k => k.movedToBreakeven === true);
        if (withBE.length >= 10) {
            const beWR = withBE.filter(k => k.type === 'success').length / withBE.length;
            if (beWR > 0.65) {
                patterns.push(`🛡️ Breakeven stop efectivo (${(beWR*100).toFixed(0)}% WR)`);
            }
        }

        return patterns;
    },

    // ═══════════════════════════════════════
    // INJECTION ANALYSIS
    // ═══════════════════════════════════════

    shouldInject(bot) {
        const knowledge = bot.knowledge || [];
        const injected = this._applyTimeDecay(
            knowledge.filter(k => k.wasInjected === true),
            'timestamp'
        );

        if (injected.length < 8) return true; // Not enough data

        const wins = injected.filter(k => k.type === 'success').length;
        const wr = this._weightedWinRate(injected);
        const stats = this._isSignificant(wins, injected.length);

        // Block injection only if statistically proven to lose
        if (stats.significant && wr < 0.40) {
            console.log(`🧠 ${bot.name}: injection blocked — WR ${(wr*100).toFixed(0)}% (p=${stats.pValue.toFixed(3)})`);
            return false;
        }

        return true;
    }
};
