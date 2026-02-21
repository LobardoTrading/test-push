/* ========================================
   SMART ENGINE — Analysis Consistency + Smart Exits
   Prevents flip-flopping, manages dynamic TP/SL
   TheRealShortShady v4.1
   ======================================== */

const SmartEngine = {

    // === ANALYSIS CONSISTENCY ===

    _analysisHistory: {},   // Per symbol: last N analyses
    _cooldowns: {},         // Per symbol: minimum time between analyses
    _HISTORY_SIZE: 5,
    _COOLDOWN_MS: 10000,    // 10s minimum between analyses
    _STORAGE_KEY: 'tp_smart_history',

    /** Load persisted history on start */
    _loadHistory() {
        try {
            const saved = localStorage.getItem(this._STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                // Only restore if recent (< 1 hour old)
                for (const [symbol, entries] of Object.entries(parsed)) {
                    if (entries.length > 0 && Date.now() - entries[entries.length - 1].timestamp < 3600000) {
                        this._analysisHistory[symbol] = entries;
                    }
                }
            }
        } catch(e) {}
    },

    _saveHistory() {
        try {
            localStorage.setItem(this._STORAGE_KEY, JSON.stringify(this._analysisHistory));
        } catch(e) {}
    },

    /** Record an analysis result */
    recordAnalysis(symbol, result) {
        if (!result) return;

        if (!this._analysisHistory[symbol]) this._analysisHistory[symbol] = [];
        const history = this._analysisHistory[symbol];

        history.push({
            direction: result.direction,
            decision: result.decision,
            confidence: result.confidence,
            timestamp: Date.now()
        });

        if (history.length > this._HISTORY_SIZE) {
            history.splice(0, history.length - this._HISTORY_SIZE);
        }

        this._saveHistory(); // FIX: persist across page reloads
    },

    /** Check if we should apply consistency filter */
    shouldOverrideAnalysis(symbol, newResult) {
        if (!newResult) return null;

        const history = this._analysisHistory[symbol];
        if (!history || history.length < 2) return null;

        const last = history[history.length - 1];
        const prev = history[history.length - 2];

        // If direction flip-flops with low confidence, maintain previous direction
        if (last.direction && newResult.direction && last.direction !== newResult.direction) {
            // Both are low confidence — flip-flop detected
            if (newResult.confidence < 65 && last.confidence < 65) {
                console.log(`🧠 Anti-flip: ${newResult.direction} blocked, maintaining ${last.direction} (both low conf)`);
                return {
                    ...newResult,
                    direction: last.direction,
                    decision: 'WAIT',
                    reason: `⚠️ Señal mixta — ${last.direction} anterior mantenido. ${newResult.reason}`,
                    _wasFiltered: true
                };
            }

            // New signal is weaker than previous — keep previous
            if (newResult.confidence < last.confidence - 10) {
                console.log(`🧠 Anti-flip: ${newResult.direction} (${newResult.confidence}%) weaker than ${last.direction} (${last.confidence}%)`);
                return {
                    ...newResult,
                    direction: last.direction,
                    decision: newResult.confidence > 60 ? newResult.decision : 'WAIT',
                    reason: `↩️ Manteniendo ${last.direction} (señal anterior más fuerte). ${newResult.reason}`,
                    _wasFiltered: true
                };
            }
        }

        // Count direction changes in recent history
        let flips = 0;
        for (let i = 1; i < history.length; i++) {
            if (history[i].direction !== history[i-1].direction) flips++;
        }

        // Too many flips = market is choppy, suggest WAIT
        if (flips >= 3 && newResult.confidence < 75) {
            console.log(`🧠 Anti-flip: ${flips} flips detected, market choppy`);
            return {
                ...newResult,
                decision: 'WAIT',
                reason: `🌀 Mercado indeciso (${flips} cambios de dirección recientes). ${newResult.reason}`,
                _wasFiltered: true
            };
        }

        return null; // No override needed
    },

    /** Check cooldown */
    isOnCooldown(symbol) {
        const last = this._cooldowns[symbol];
        if (!last) return false;
        return Date.now() - last < this._COOLDOWN_MS;
    },

    setCooldown(symbol) {
        this._cooldowns[symbol] = Date.now();
    },

    /** Get consistency info for display */
    getConsistencyInfo(symbol) {
        const history = this._analysisHistory[symbol];
        if (!history || history.length < 2) return null;

        const directions = history.map(h => h.direction);
        const longCount = directions.filter(d => d === 'LONG').length;
        const shortCount = directions.filter(d => d === 'SHORT').length;

        let flips = 0;
        for (let i = 1; i < directions.length; i++) {
            if (directions[i] !== directions[i-1]) flips++;
        }

        const avgConf = (history.reduce((s, h) => s + (h.confidence || 0), 0) / history.length).toFixed(0);
        const dominant = longCount > shortCount ? 'LONG' : shortCount > longCount ? 'SHORT' : 'MIXED';

        return {
            totalAnalyses: history.length,
            longCount, shortCount, flips,
            avgConfidence: parseInt(avgConf),
            dominant,
            isChoppy: flips >= 3,
            lastDirection: directions[directions.length - 1]
        };
    },

    // === SMART BOT EXITS ===

    /**
     * Evaluate if a bot position should be closed early or TP/SL adjusted
     * Called by Lab._checkBotPositions() for each open position
     */
    /**
     * Zone-based position management
     * Zones: RED (losing badly) → NEUTRAL (breakeven zone) → GREEN (winning) → GOLDEN (big profit)
     * 
     * RED:    PnL < -50% of SL distance → Do nothing, let SL work
     * NEUTRAL: -50% SL to +50% TP       → Consider injection if signals align
     * GREEN:  +50% TP to +85% TP        → Move SL to breakeven, trail
     * GOLDEN: > 85% TP                  → Partial close or extend TP
     */
    evaluatePosition(pos, currentPrice, candles) {
        if (!pos || !currentPrice) return null;

        const entry = pos.entry;
        const isLong = pos.direction === 'LONG';
        const elapsed = Date.now() - new Date(pos.timestamp).getTime();
        const elapsedMin = elapsed / 60000;

        // Calculate current PnL %
        const pnlPct = isLong
            ? ((currentPrice - entry) / entry) * 100
            : ((entry - currentPrice) / entry) * 100;

        // TP/SL distances in %
        const tpDistPct = pos.tp ? Math.abs(pos.tp - entry) / entry * 100 : 1;
        const slDistPct = pos.sl ? Math.abs(pos.sl - entry) / entry * 100 : 0.5;

        // Track max PnL for drawdown detection
        const maxPnlPct = Math.max(pos.maxPnlPct || 0, pnlPct);

        // Determine current zone
        let zone;
        if (pnlPct < -(slDistPct * 0.5)) {
            zone = 'red';
        } else if (pnlPct < tpDistPct * 0.5) {
            zone = 'neutral';
        } else if (pnlPct < tpDistPct * 0.85) {
            zone = 'green';
        } else {
            zone = 'golden';
        }

        const actions = [];

        // Always update tracking
        actions.push({
            type: 'UPDATE_TRACKING',
            zone,
            maxPnlPct,
        });

        // === ZONE: RED — Losing badly ===
        if (zone === 'red') {
            // Do nothing extra. SL will handle it.
            // Only cut early if WAY past timeout
            const modeTimeouts = { scalping: 15, intraday: 480, swing: 4320, position: 43200 };
            const maxTime = modeTimeouts[pos.mode] || modeTimeouts.intraday;
            if (elapsedMin > maxTime * 1.5) {
                actions.push({
                    type: 'CLOSE_TIME',
                    reason: `⏰ Timeout extremo (${Math.round(elapsedMin)}min) en zona roja — cortar pérdida ${pnlPct.toFixed(1)}%`
                });
            }
        }

        // === ZONE: NEUTRAL — Breakeven area ===
        if (zone === 'neutral') {
            // Time-based exit: if stale and modest profit
            const modeTimeouts = { scalping: 15, intraday: 480, swing: 4320, position: 43200 };
            const maxTime = modeTimeouts[pos.mode] || modeTimeouts.intraday;

            if (elapsedMin > maxTime * 0.7 && pnlPct > 0 && pnlPct < tpDistPct * 0.3) {
                actions.push({
                    type: 'CLOSE_TIME',
                    reason: `⏰ Timeout (${Math.round(elapsedMin)}min), PnL modesto +${pnlPct.toFixed(1)}% — cerrar`
                });
            }

            // Injection opportunity: if still in neutral after 30%+ of timeout AND current
            // analysis still supports direction AND hasn't injected before
            if (!pos.injected && elapsedMin > maxTime * 0.2 && pnlPct > 0 && pnlPct < tpDistPct * 0.3) {
                actions.push({
                    type: 'CONSIDER_INJECTION',
                    reason: `💉 Zona neutra, PnL +${pnlPct.toFixed(1)}%, evaluando inyección...`
                });
            }
        }

        // === ZONE: GREEN — Winning ===
        if (zone === 'green') {
            // Move SL to breakeven if not done yet
            if (!pos.movedToBreakeven && pos.sl) {
                const bePrice = isLong ? entry * 1.001 : entry * 0.999;
                const shouldMove = isLong ? pos.sl < bePrice : pos.sl > bePrice;
                if (shouldMove) {
                    actions.push({
                        type: 'MOVE_SL',
                        newSL: bePrice,
                        markBreakeven: true,
                        reason: `🟢 Breakeven: proteger capital en +${pnlPct.toFixed(1)}%`
                    });
                }
            }

            // Start trailing at 40% of current profit
            if (pos.movedToBreakeven) {
                const trailPct = pnlPct * 0.40;
                const trailPrice = isLong
                    ? currentPrice * (1 - trailPct / 100)
                    : currentPrice * (1 + trailPct / 100);

                const shouldTrail = isLong ? (pos.sl && trailPrice > pos.sl) : (pos.sl && trailPrice < pos.sl);
                if (shouldTrail) {
                    actions.push({
                        type: 'MOVE_SL',
                        newSL: trailPrice,
                        markTrailing: true,
                        reason: `📈 Trailing: PnL +${pnlPct.toFixed(1)}%, SL → $${Utils.formatPrice(trailPrice)}`
                    });
                }
            }

            // Injection if not done yet and momentum is strong
            if (!pos.injected && candles && candles.length >= 3) {
                const last3 = candles.slice(-3);
                const closes = last3.map(c => c.c || c.close || 0);
                let inFavor = 0;
                for (let i = 1; i < closes.length; i++) {
                    if (isLong && closes[i] > closes[i - 1]) inFavor++;
                    if (!isLong && closes[i] < closes[i - 1]) inFavor++;
                }
                if (inFavor >= 2) {
                    actions.push({
                        type: 'CONSIDER_INJECTION',
                        reason: `💉 Zona verde + momentum fuerte (${inFavor}/2 velas a favor), evaluar inyección`
                    });
                }
            }

            // Momentum reversal check
            if (candles && candles.length >= 5 && pnlPct > tpDistPct * 0.6) {
                const last5 = candles.slice(-5);
                const closes = last5.map(c => c.c || c.close || 0);
                let against = 0;
                for (let i = 1; i < closes.length; i++) {
                    if (isLong && closes[i] < closes[i - 1]) against++;
                    if (!isLong && closes[i] > closes[i - 1]) against++;
                }
                if (against >= 3) {
                    actions.push({
                        type: 'CLOSE_REVERSAL',
                        reason: `🔄 Reversión (${against}/4 velas en contra), asegurar +${pnlPct.toFixed(1)}%`
                    });
                }
            }
        }

        // === ZONE: GOLDEN — Big profit, manage actively ===
        if (zone === 'golden') {
            // Ensure breakeven + trailing are active
            if (!pos.movedToBreakeven) {
                const bePrice = isLong ? entry * 1.002 : entry * 0.998;
                actions.push({
                    type: 'MOVE_SL',
                    newSL: bePrice,
                    markBreakeven: true,
                    reason: `🏆 Golden zone: breakeven lock en +${pnlPct.toFixed(1)}%`
                });
            }

            // Aggressive trailing: 30% of profit (tighter than green)
            const trailPct = pnlPct * 0.30;
            const trailPrice = isLong
                ? currentPrice * (1 - trailPct / 100)
                : currentPrice * (1 + trailPct / 100);
            const shouldTrail = isLong ? (pos.sl && trailPrice > pos.sl) : (pos.sl && trailPrice < pos.sl);
            if (shouldTrail) {
                actions.push({
                    type: 'MOVE_SL',
                    newSL: trailPrice,
                    markTrailing: true,
                    reason: `🏆 Golden trailing: PnL +${pnlPct.toFixed(1)}%, SL → $${Utils.formatPrice(trailPrice)}`
                });
            }

            // If momentum is dying, partial close 70%
            if (!pos.partialClosed && candles && candles.length >= 3) {
                const last3 = candles.slice(-3);
                const closes = last3.map(c => c.c || c.close || 0);
                let against = 0;
                for (let i = 1; i < closes.length; i++) {
                    if (isLong && closes[i] < closes[i - 1]) against++;
                    if (!isLong && closes[i] > closes[i - 1]) against++;
                }
                if (against >= 2) {
                    actions.push({
                        type: 'PARTIAL_CLOSE',
                        pct: 0.70,
                        reason: `🏆 Golden + momentum frenando → cerrar 70%, dejar 30% con trailing`
                    });
                }
            }

            // If momentum STRONG, extend TP
            if (!pos.partialClosed && candles && candles.length >= 3) {
                const last3 = candles.slice(-3);
                const closes = last3.map(c => c.c || c.close || 0);
                let inFavor = 0;
                for (let i = 1; i < closes.length; i++) {
                    if (isLong && closes[i] > closes[i - 1]) inFavor++;
                    if (!isLong && closes[i] < closes[i - 1]) inFavor++;
                }
                if (inFavor >= 2) {
                    const newTP = isLong
                        ? pos.originalTP + (pos.originalTP - entry) * 0.5
                        : pos.originalTP - (entry - pos.originalTP) * 0.5;
                    actions.push({
                        type: 'EXTEND_TP',
                        newTP,
                        reason: `🚀 Momentum fuerte en golden → extender TP a $${Utils.formatPrice(newTP)} (+50%)`
                    });
                }
            }
        }

        return actions.length > 0 ? actions : null;
    },

    /**
     * Apply smart exit actions to a bot position
     * Returns: { close: boolean, newSL: number|null, reason: string }
     */
    applyActions(actions) {
        if (!actions || actions.length === 0) return { close: false, newSL: null };

        const result = {
            close: false,
            partialClose: false,
            partialPct: 0,
            newSL: null,
            newTP: null,
            inject: false,
            markBreakeven: false,
            markTrailing: false,
            zone: null,
            maxPnlPct: null,
            reason: null,
        };

        // 1. Tracking updates (always apply)
        const tracking = actions.find(a => a.type === 'UPDATE_TRACKING');
        if (tracking) {
            result.zone = tracking.zone;
            result.maxPnlPct = tracking.maxPnlPct;
        }

        // 2. Close actions (highest priority)
        const closeAction = actions.find(a =>
            a.type === 'CLOSE_TIME' || a.type === 'CLOSE_REVERSAL'
        );
        if (closeAction) {
            result.close = true;
            result.reason = closeAction.reason;
            return result;
        }

        // 3. Partial close
        const partialAction = actions.find(a => a.type === 'PARTIAL_CLOSE');
        if (partialAction) {
            result.partialClose = true;
            result.partialPct = partialAction.pct;
            result.reason = partialAction.reason;
            // Don't return — still apply SL/TP changes
        }

        // 4. Injection consideration
        const injectAction = actions.find(a => a.type === 'CONSIDER_INJECTION');
        if (injectAction) {
            result.inject = true;
            result.reason = result.reason || injectAction.reason;
        }

        // 5. TP extension
        const extendAction = actions.find(a => a.type === 'EXTEND_TP');
        if (extendAction) {
            result.newTP = extendAction.newTP;
            result.reason = result.reason || extendAction.reason;
        }

        // 6. SL moves (take the most favorable one)
        const slMoves = actions.filter(a => a.type === 'MOVE_SL');
        if (slMoves.length > 0) {
            // Pick the highest SL for LONG, lowest for SHORT (most protective)
            const bestSL = slMoves.reduce((best, a) => {
                if (!best) return a;
                return a.newSL > best.newSL ? a : best; // Works for LONG; SHORT handled by caller
            }, null);
            if (bestSL) {
                result.newSL = bestSL.newSL;
                result.markBreakeven = bestSL.markBreakeven || result.markBreakeven;
                result.markTrailing = bestSL.markTrailing || result.markTrailing;
                result.reason = result.reason || bestSL.reason;
            }
        }

        return result;
    }
};

// Self-init: load persisted history
SmartEngine._loadHistory();
