/* ========================================
   AUTONOMY — Self-Managing Bot System
   TheRealShortShady v4.2.0
   
   Niveles de autonomía:
   L0: Manual — usuario crea/controla todo
   L1: Sugerencias — sugiere bots, usuario aprueba
   L2: Semi-auto — crea bots, usuario puede vetar
   L3: Full auto — crea, mata, rebalancea solo
   
   Escalación: sube de nivel con performance probada,
   baja si pierde demasiado.
   ======================================== */

const Autonomy = {

    _STORAGE_KEY: 'tp_autonomy',
    _checkInterval: null,
    _lastCheck: 0,
    _running: false,
    _currentMode: 'moderate',

    // ═══════════════════════════════════════
    // CONFIG
    // ═══════════════════════════════════════

    _defaults: {
        level: 1,                     // Arranca en L1 (sugerencias)
        maxAutoBots: 10,              // Máx bots auto-creados (configurable desde Dashboard)
        autoWallet: 50,               // Wallet por bot auto-creado
        autoMode: 'intraday',         // Modo default para auto-bots
        autoTemp: 'normal',           // Temperatura default
        minRadarConfidence: 55,       // Min confidence del radar para auto-crear
        minRadarSignal: 'moderate',   // Min señal del radar (moderate = ENTER + conf >= 55)
        killGrade: 'F',              // Grade mínimo antes de matar bot
        killDrawdown: 20,             // % drawdown para matar bot
        rebalanceEnabled: true,       // Redistribuir capital
        checkIntervalMs: 90000,       // Check cada 90s (was 120s)
        // === SNIPER MODE ===
        sniperEnabled: false,         // Toggle Sniper mode
        sniperMinConf: 78,            // Min confidence for Sniper (data says 78+ is profitable)
        sniperLeverage: 50,           // Configurable leverage (10-125)
        sniperMarginPct: 5,           // % of wallet per trade (1-25)
        sniperDirection: 'regime',    // 'regime' = follow market, 'long' = long only, 'short' = short only, 'both' = any
        sniperBlacklist: [],          // Symbols to avoid (e.g. ['XRP','ADA','LINK','DOT'])
        sniperWhitelist: [],          // If set, ONLY these symbols (empty = all allowed)
        sniperShadowMode: true,       // Blacklisted symbols run in shadow (no real wallet) to detect recovery
    },

    // Criterios para escalar/desescalar nivel
    _escalation: {
        // Para subir de nivel necesitás:
        // FIX: Requisitos reducidos para permitir aprendizaje más rápido
        promoteRules: {
            1: { minTrades: 0,  minWR: 0,  minPnl: 0,    description: 'Inicio — solo sugiere' },
            2: { minTrades: 8,  minWR: 50, minPnl: 0,    description: '8+ trades, WR>50%, PnL positivo → semi-auto' },
            3: { minTrades: 20, minWR: 53, minPnl: 2,    description: '20+ trades, WR>53%, PnL>$2 → full auto' },
        },
        // Para bajar de nivel:
        demoteRules: {
            dailyLoss: 8,     // Si pierde 8% en un día → bajar nivel
            weeklyLoss: 15,   // Si pierde 15% en una semana → bajar nivel
        }
    },

    // ═══════════════════════════════════════
    // INIT & LIFECYCLE
    // ═══════════════════════════════════════

    init() {
        this._loadState();
        console.log(`🤖 Autonomy initialized — Level ${this.state.level}`);
        if (typeof EventFeed !== 'undefined') {
            EventFeed.system(`Autonomía activa — Nivel ${this.state.level}: ${this._getLevelName()}`);
        }
    },

    start() {
        if (this._running) return;
        this._running = true;

        // Start periodic checks
        this._checkInterval = setInterval(() => this._periodicCheck(), this.state.config.checkIntervalMs);
        // First check after 30s
        setTimeout(() => this._periodicCheck(), 30000);

        console.log('🤖 Autonomy started');
        Utils.showNotification('Autonomy Bot iniciado', 'success');
        if (typeof EventFeed !== 'undefined') {
            EventFeed.system('Autonomy Bot activado');
        }
    },

    stop() {
        if (!this._running) return;
        this._running = false;

        if (this._checkInterval) {
            clearInterval(this._checkInterval);
            this._checkInterval = null;
        }

        console.log('🤖 Autonomy stopped');
        Utils.showNotification('Autonomy Bot detenido', 'info');
        if (typeof EventFeed !== 'undefined') {
            EventFeed.system('Autonomy Bot detenido');
        }
    },

    isRunning() {
        return this._running;
    },

    getStatus() {
        return {
            running: this._running,
            level: this.state?.level || 0,
            levelName: this._getLevelName(),
            autoBots: (this.state?.autoBotIds || []).length,
            config: this.state?.config || {},
            stats: {
                totalTrades: this.state?.totalAutoTrades || 0,
                winRate: this.state?.totalAutoTrades > 0
                    ? ((this.state?.totalAutoWins || 0) / this.state.totalAutoTrades * 100)
                    : 0,
                totalPnl: this.state?.totalAutoPnl || 0
            },
            history: this.state?.history || []
        };
    },

    setMode(mode) {
        this._currentMode = mode;
        if (this.state?.config) {
            this.state.config.autoTemp = mode;
            this._saveState();
        }
    },

    _loadState() {
        try {
            const saved = JSON.parse(localStorage.getItem(this._STORAGE_KEY));
            if (saved) {
                this.state = saved;
                // Merge new defaults sin pisar config existente
                this.state.config = { ...this._defaults, ...this.state.config };
                // Force-update critical values that were too strict in older versions
                if (this.state.config.minRadarConfidence > 65) this.state.config.minRadarConfidence = this._defaults.minRadarConfidence;
                if (this.state.config.minRadarSignal === 'strong') this.state.config.minRadarSignal = this._defaults.minRadarSignal;
                if (this.state.config.checkIntervalMs > 100000) this.state.config.checkIntervalMs = this._defaults.checkIntervalMs;
                return;
            }
        } catch(e) {}
        // Default state
        this.state = {
            level: 1,
            config: { ...this._defaults },
            autoBotIds: [],           // IDs de bots creados automáticamente
            totalAutoTrades: 0,
            totalAutoWins: 0,
            totalAutoPnl: 0,
            promotedAt: null,
            demotedAt: null,
            suggestions: [],          // Queue de sugerencias pendientes (L1)
            history: [],              // Log de acciones autónomas
        };
    },

    _saveState() {
        try { localStorage.setItem(this._STORAGE_KEY, JSON.stringify(this.state)); }
        catch(e) {}
    },

    // ═══════════════════════════════════════
    // SNIPER MODE
    // ═══════════════════════════════════════

    /** Get sniper config (used by Lab for filtering) */
    getSniperConfig() {
        if (!this.state?.config?.sniperEnabled) return null;
        const cfg = this.state.config;
        return {
            enabled: true,
            minConf: cfg.sniperMinConf || 78,
            leverage: cfg.sniperLeverage || 50,
            marginPct: cfg.sniperMarginPct || 5,
            direction: cfg.sniperDirection || 'regime',
            blacklist: cfg.sniperBlacklist || [],
            whitelist: cfg.sniperWhitelist || [],
            shadowMode: cfg.sniperShadowMode !== false, // default true
        };
    },

    /** Toggle sniper mode */
    setSniperEnabled(enabled) {
        this.state.config.sniperEnabled = !!enabled;
        this._saveState();
        const label = enabled ? '🎯 SNIPER MODE ACTIVADO' : '🎯 Sniper mode desactivado';
        EventFeed.log('system', '🎯', label);
        Utils.showNotification(label, enabled ? 'success' : 'info');
        // Run auto-tune immediately on activation
        if (enabled) {
            this._sniperLastTune = 0; // Reset timer to force immediate tune
            this._sniperAutoTune();
            this._saveState();
        }
    },

    /** Update a sniper config value */
    setSniperConfig(key, value) {
        if (!this.state.config) return;
        this.state.config['sniper' + key.charAt(0).toUpperCase() + key.slice(1)] = value;
        this._saveState();
    },

    /** Toggle a symbol in blacklist */
    toggleSniperBlacklist(symbol) {
        const bl = this.state.config.sniperBlacklist || [];
        const idx = bl.indexOf(symbol);
        if (idx >= 0) bl.splice(idx, 1);
        else bl.push(symbol);
        this.state.config.sniperBlacklist = bl;
        this._saveState();
    },

    // ═══════════════════════════════════════
    // SNIPER AUTO-TUNE — Self-adapting brain
    // ═══════════════════════════════════════

    _sniperLastTune: 0,

    _sniperAutoTune() {
        // Run every 5 minutes max
        const now = Date.now();
        if (now - this._sniperLastTune < 300000) return;
        this._sniperLastTune = now;

        // Collect ALL trades across ALL bots
        const bots = typeof Lab !== 'undefined' ? Lab._getBots() : [];
        const allTrades = [];
        for (const bot of bots) {
            for (const t of (bot.trades || [])) {
                allTrades.push({ ...t, _symbol: bot.symbol, _botId: bot.id });
            }
        }

        if (allTrades.length < 8) return; // Need minimum data

        const cfg = this.state.config;
        const changes = [];

        // ═══════════════════════════════════════
        // 1. AUTO-BLACKLIST losing symbols
        // ═══════════════════════════════════════
        const symbolStats = {};
        for (const t of allTrades) {
            if (t.shadow) continue; // Don't count shadow trades for blacklist decisions
            const s = t._symbol;
            if (!symbolStats[s]) symbolStats[s] = { wins: 0, losses: 0, pnl: 0, count: 0 };
            symbolStats[s].count++;
            symbolStats[s].pnl += (t.pnl || 0);
            if ((t.pnl || 0) > 0) symbolStats[s].wins++;
            else symbolStats[s].losses++;
        }

        const currentBlacklist = cfg.sniperBlacklist || [];
        for (const [symbol, stats] of Object.entries(symbolStats)) {
            const wr = stats.count > 0 ? (stats.wins / stats.count) : 0;
            // Auto-blacklist: 5+ trades, WR < 30%, and negative PnL
            if (stats.count >= 5 && wr < 0.30 && stats.pnl < 0 && !currentBlacklist.includes(symbol)) {
                currentBlacklist.push(symbol);
                changes.push(`🚫 ${symbol} blacklisted → shadow mode (WR ${(wr*100).toFixed(0)}%, PnL $${stats.pnl.toFixed(2)}, ${stats.count} trades)`);
            }
        }

        // Check shadow trades for reactivation
        for (const blockedSymbol of [...currentBlacklist]) {
            const shadowTrades = allTrades.filter(t => t._symbol === blockedSymbol && t.shadow === true);
            if (shadowTrades.length >= 5) {
                const shadowWins = shadowTrades.filter(t => t.pnl > 0).length;
                const shadowWR = shadowWins / shadowTrades.length;
                const shadowPnl = shadowTrades.reduce((s, t) => s + (t.pnl || 0), 0);

                if (shadowWR > 0.50 && shadowPnl > 0) {
                    // Reactivate!
                    const idx = currentBlacklist.indexOf(blockedSymbol);
                    if (idx >= 0) currentBlacklist.splice(idx, 1);
                    changes.push(`✅ ${blockedSymbol} reactivado! Shadow mostró WR ${(shadowWR*100).toFixed(0)}%, PnL $${shadowPnl.toFixed(3)} en ${shadowTrades.length} trades`);
                } else if (shadowTrades.length >= 10 && shadowWR < 0.30) {
                    // Still bad in shadow, log it
                    changes.push(`👻 ${blockedSymbol} sigue en shadow (WR ${(shadowWR*100).toFixed(0)}%, ${shadowTrades.length} trades — aún no se reactiva)`);
                }
            }
        }
        cfg.sniperBlacklist = currentBlacklist;

        // ═══════════════════════════════════════
        // 2. AUTO-DIRECTION — follow what works
        // ═══════════════════════════════════════
        const realTrades = allTrades.filter(t => !t.shadow);
        const longTrades = realTrades.filter(t => t.direction === 'LONG');
        const shortTrades = realTrades.filter(t => t.direction === 'SHORT');
        const longWR = longTrades.length >= 5 ? longTrades.filter(t => t.pnl > 0).length / longTrades.length : null;
        const shortWR = shortTrades.length >= 5 ? shortTrades.filter(t => t.pnl > 0).length / shortTrades.length : null;
        const longPnl = longTrades.reduce((s, t) => s + (t.pnl || 0), 0);
        const shortPnl = shortTrades.reduce((s, t) => s + (t.pnl || 0), 0);

        if (longWR !== null && shortWR !== null) {
            const prevDir = cfg.sniperDirection;
            
            // If one direction is clearly terrible (WR < 30% with 5+ trades and negative PnL)
            if (shortWR < 0.30 && shortPnl < -0.5 && longWR > 0.45) {
                if (prevDir !== 'long') {
                    cfg.sniperDirection = 'long';
                    changes.push(`📊 Dirección → Solo LONG (SHORT WR ${(shortWR*100).toFixed(0)}% pierde $${Math.abs(shortPnl).toFixed(2)})`);
                }
            } else if (longWR < 0.30 && longPnl < -0.5 && shortWR > 0.45) {
                if (prevDir !== 'short') {
                    cfg.sniperDirection = 'short';
                    changes.push(`📊 Dirección → Solo SHORT (LONG WR ${(longWR*100).toFixed(0)}% pierde $${Math.abs(longPnl).toFixed(2)})`);
                }
            } else if (longWR > 0.45 && shortWR > 0.45 && prevDir !== 'both' && prevDir !== 'regime') {
                // Both directions working — switch back to regime
                cfg.sniperDirection = 'regime';
                changes.push(`📊 Dirección → Régimen (ambas direcciones rentables)`);
            }
        }

        // ═══════════════════════════════════════
        // 3. AUTO-CONFIDENCE — find the sweet spot
        // ═══════════════════════════════════════
        if (realTrades.length >= 15) {
            // Bucket by confidence and find the profitable threshold
            const confBuckets = {};
            for (const t of realTrades) {
                const conf = t.confidence || 0;
                const bucket = Math.floor(conf / 2) * 2; // 2% buckets
                if (!confBuckets[bucket]) confBuckets[bucket] = { wins: 0, losses: 0, pnl: 0, count: 0 };
                confBuckets[bucket].count++;
                confBuckets[bucket].pnl += (t.pnl || 0);
                if ((t.pnl || 0) > 0) confBuckets[bucket].wins++;
                else confBuckets[bucket].losses++;
            }

            // Find lowest confidence that's still profitable (cumulative from top)
            const sortedBuckets = Object.keys(confBuckets).map(Number).sort((a, b) => b - a);
            let cumWins = 0, cumTotal = 0, cumPnl = 0;
            let bestThreshold = cfg.sniperMinConf;

            for (const bucket of sortedBuckets) {
                cumWins += confBuckets[bucket].wins;
                cumTotal += confBuckets[bucket].count;
                cumPnl += confBuckets[bucket].pnl;
                const cumWR = cumWins / cumTotal;

                // If adding this bucket keeps WR > 50% and PnL positive, include it
                if (cumWR > 0.50 && cumPnl > 0 && cumTotal >= 5) {
                    bestThreshold = bucket;
                }
            }

            // Only adjust if meaningfully different (±2 or more) and within sane range
            if (Math.abs(bestThreshold - cfg.sniperMinConf) >= 2 && bestThreshold >= 70 && bestThreshold <= 92) {
                const prev = cfg.sniperMinConf;
                cfg.sniperMinConf = bestThreshold;
                changes.push(`🎚️ Confianza ${prev}% → ${bestThreshold}% (optimizado con ${realTrades.length} trades)`);
            }
        }

        // ═══════════════════════════════════════
        // 4. AUTO-LEVERAGE — reduce if losing, maintain if winning
        // ═══════════════════════════════════════
        const recentTrades = realTrades.slice(-15); // Last 15 real trades
        if (recentTrades.length >= 10) {
            const recentWR = recentTrades.filter(t => t.pnl > 0).length / recentTrades.length;
            const recentPnl = recentTrades.reduce((s, t) => s + (t.pnl || 0), 0);
            const currentLev = cfg.sniperLeverage;

            // Losing streak: reduce leverage to protect capital
            if (recentWR < 0.35 && recentPnl < -1) {
                const newLev = Math.max(10, Math.round(currentLev * 0.6 / 5) * 5); // Drop 40%, round to 5
                if (newLev < currentLev) {
                    cfg.sniperLeverage = newLev;
                    changes.push(`⚠️ Leverage ${currentLev}x → ${newLev}x (protección: WR reciente ${(recentWR*100).toFixed(0)}%)`);
                }
            }
            // Winning streak: cautiously increase (but never above 75x auto)
            else if (recentWR > 0.60 && recentPnl > 1 && currentLev < 75) {
                const newLev = Math.min(75, Math.round(currentLev * 1.2 / 5) * 5); // +20%, cap 75x
                if (newLev > currentLev) {
                    cfg.sniperLeverage = newLev;
                    changes.push(`📈 Leverage ${currentLev}x → ${newLev}x (WR reciente ${(recentWR*100).toFixed(0)}%)`);
                }
            }
        }

        // ═══════════════════════════════════════
        // 5. AUTO-KILL bots on blacklisted symbols (only if shadow mode OFF)
        // ═══════════════════════════════════════
        const bl = cfg.sniperBlacklist || [];
        if (bl.length > 0 && !cfg.sniperShadowMode) {
            for (const bot of bots) {
                if (bot.status === 'running' && bl.includes(bot.symbol)) {
                    if ((bot.positions || []).length > 0) {
                        changes.push(`☠️ Cerrando ${bot.name} (${bot.symbol} en blacklist, shadow OFF)`);
                        if (typeof Lab !== 'undefined') {
                            Lab.stopBot(bot.id);
                        }
                    }
                }
            }
        }

        // ═══════════════════════════════════════
        // LOG all changes
        // ═══════════════════════════════════════
        if (changes.length > 0) {
            console.log('🎯 Sniper Auto-Tune:', changes);
            for (const change of changes) {
                EventFeed.log('system', '🎯', `Auto-Tune: ${change}`);
            }
            Utils.showNotification(`🎯 Sniper se auto-ajustó (${changes.length} cambios)`, 'info', 5000);

            // Save tune history
            if (!this.state.sniperTuneHistory) this.state.sniperTuneHistory = [];
            this.state.sniperTuneHistory.push({
                timestamp: new Date().toISOString(),
                trades: allTrades.length,
                changes
            });
            // Keep last 50 tunes
            if (this.state.sniperTuneHistory.length > 50) {
                this.state.sniperTuneHistory = this.state.sniperTuneHistory.slice(-50);
            }
        }
    },

    // ═══════════════════════════════════════
    // PERIODIC CHECK — El cerebro autónomo
    // ═══════════════════════════════════════

    _periodicCheck() {
        if (typeof Lab === 'undefined') return;
        if (!this.state) this._loadState();

        const now = Date.now();
        if (now - this._lastCheck < 60000) return; // Mínimo 60s entre checks
        this._lastCheck = now;

        console.log(`🤖 Autonomy check — L${this.state.level} (${this._getLevelName()}) | radar: ${(Lab._opportunities || []).length} ops | autoBots: ${this.state.autoBotIds.length}/${this.state.config.maxAutoBots}`);

        // 1. Evaluar si hay que escalar/desescalar nivel
        this._evaluateEscalation();

        // 2. Buscar oportunidades para crear bots
        this._evaluateOpportunities();

        // 3. Evaluar bots existentes para matar underperformers
        this._evaluateKills();

        // 4. Rebalancear si aplica
        if (this.state.config.rebalanceEnabled) {
            this._evaluateRebalance();
        }

        // 5. Sniper Auto-Tune — analyze and adapt
        if (this.state.config.sniperEnabled) {
            this._sniperAutoTune();
        }

        this._saveState();
    },

    // ═══════════════════════════════════════
    // ESCALACIÓN DE NIVEL
    // ═══════════════════════════════════════

    _evaluateEscalation() {
        const stats = this._getGlobalAutoStats();
        const currentLevel = this.state.level;

        // Check promoción (always allowed)
        if (currentLevel < 3) {
            const nextLevel = currentLevel + 1;
            const rules = this._escalation.promoteRules[nextLevel];
            if (rules &&
                stats.totalTrades >= rules.minTrades &&
                stats.winRate >= rules.minWR &&
                stats.totalPnl >= rules.minPnl) {
                this._promote(nextLevel, rules.description);
            }
        }

        // Check demote — skip if user manually set the level
        if (this.state.manualOverride) return;
        
        if (currentLevel > 1) {
            const todayPnl = this._getTodayPnl();
            const initialTotal = this._getTotalInitialBalance();
            if (initialTotal > 0) {
                const dailyLossPct = Math.abs(todayPnl) / initialTotal * 100;
                if (todayPnl < 0 && dailyLossPct >= this._escalation.demoteRules.dailyLoss) {
                    this._demote(`Daily loss ${dailyLossPct.toFixed(1)}% ≥ ${this._escalation.demoteRules.dailyLoss}%`);
                }
            }
        }
    },

    _promote(newLevel, reason) {
        const oldLevel = this.state.level;
        this.state.level = newLevel;
        this.state.promotedAt = new Date().toISOString();

        const msg = `⬆️ PROMOCIÓN: Nivel ${oldLevel} → ${newLevel} (${this._getLevelName()}) — ${reason}`;
        EventFeed.log('system', '⬆️', msg);
        Utils.showNotification(`🤖 ${msg}`, 'success', 10000);
        this._logAction('promote', msg);
        this._saveState();
    },

    _demote(reason) {
        const oldLevel = this.state.level;
        this.state.level = Math.max(1, oldLevel - 1);
        this.state.demotedAt = new Date().toISOString();

        const msg = `⬇️ DEMOTE: Nivel ${oldLevel} → ${this.state.level} (${this._getLevelName()}) — ${reason}`;
        EventFeed.log('system', '⬇️', msg);
        Utils.showNotification(`🤖 ${msg}`, 'error', 10000);
        this._logAction('demote', msg);
        this._saveState();
    },

    // ═══════════════════════════════════════
    // AUTO-CREATE BOTS
    // ═══════════════════════════════════════

    _evaluateOpportunities() {
        const ops = Lab._opportunities;
        
        if (!ops || ops.length === 0) {
            // Log why nothing is happening
            if (this.state.level >= 2) {
                EventFeed.log('system', '🤖', `Autonomy L${this.state.level}: radar sin datos aún — esperando scan`);
            }
            return;
        }

        const cfg = this.state.config;
        const currentAutoBots = this.state.autoBotIds.filter(id => {
            const b = Lab._getBot(id);
            return b && b.status !== 'archived';
        });
        this.state.autoBotIds = currentAutoBots;

        // ¿Hay espacio para más auto-bots?
        const allBots = Lab._getBots().filter(b => b.status !== 'archived');
        if (allBots.length >= 10) {
            EventFeed.log('system', '🤖', `Autonomy: límite de 10 bots alcanzado`);
            return;
        }
        if (currentAutoBots.length >= cfg.maxAutoBots) {
            EventFeed.log('system', '🤖', `Autonomy: máx auto-bots (${cfg.maxAutoBots}) alcanzado`);
            return;
        }

        // L3 Full Auto: accept moderate signals + lower confidence
        const isFullAuto = this.state.level >= 3;
        const minConf = isFullAuto ? Math.min(cfg.minRadarConfidence, 50) : cfg.minRadarConfidence;
        const validSignals = isFullAuto
            ? ['strong', 'moderate']
            : (cfg.minRadarSignal === 'strong' ? ['strong'] : ['strong', 'moderate']);

        const opportunities = ops.filter(o =>
            validSignals.includes(o.signal) &&
            o.confidence >= minConf &&
            o.decision === 'ENTER'
        );

        // Log what was filtered
        const enterOps = ops.filter(o => o.decision === 'ENTER');
        if (enterOps.length === 0 && this.state.level >= 2) {
            EventFeed.log('system', '🤖', `Autonomy: ${ops.length} symbols escaneados, ninguno con ENTER — mercado en WAIT`);
        } else if (opportunities.length === 0 && enterOps.length > 0 && this.state.level >= 2) {
            const best = enterOps[0];
            EventFeed.log('system', '🤖', `Autonomy: ${enterOps.length} con ENTER pero conf insuficiente (mejor: ${best.symbol} ${best.confidence}%, mín: ${minConf}%)`);
        }

        if (opportunities.length === 0) return;

        // No crear bot en symbol donde ya hay uno
        const existingSymbols = allBots
            .filter(b => b.status === 'running')
            .map(b => b.symbol);

        const fresh = opportunities.filter(o => !existingSymbols.includes(o.symbol));
        if (fresh.length === 0) {
            EventFeed.log('system', '🤖', `Autonomy: oportunidades encontradas pero ya hay bots en esos symbols`);
            return;
        }

        // Sniper mode filtering at creation level
        let filtered = fresh;
        const sniper = this.getSniperConfig();
        if (sniper) {
            filtered = fresh.filter(o => {
                // Blacklist
                if (sniper.blacklist.length > 0 && sniper.blacklist.includes(o.symbol)) return false;
                // Whitelist
                if (sniper.whitelist.length > 0 && !sniper.whitelist.includes(o.symbol)) return false;
                // Min conf
                if (o.confidence < sniper.minConf) return false;
                return true;
            });
            if (filtered.length === 0 && fresh.length > 0) {
                EventFeed.log('system', '🎯', `Sniper: ${fresh.length} oportunidades filtradas (conf/blacklist)`);
                return;
            }
        }

        // Tomar la mejor oportunidad
        const best = filtered[0];

        // Risk Manager check global
        if (typeof RiskManager !== 'undefined') {
            const fakeBot = { 
                id: 'check', 
                name: 'AutoCheck',
                symbol: best.symbol, 
                currentBalance: cfg.autoWallet, 
                initialBalance: cfg.autoWallet, 
                initialWallet: cfg.autoWallet,
                trades: [], 
                positions: [],
                stats: { trades: 0, wins: 0, losses: 0, totalPnl: 0 }
            };
            const riskCheck = RiskManager.canTrade(fakeBot);
            if (!riskCheck.allowed) {
                EventFeed.log('system', '🛡️', `Autonomy: oportunidad ${best.symbol} bloqueada por Risk Manager — ${riskCheck.reason}`);
                return;
            }
        }

        if (this.state.level === 1) {
            // L1: Solo sugerir
            this._suggest(best);
        } else if (this.state.level >= 2) {
            // L2/L3: Crear automáticamente
            this._autoCreateBot(best);
        }
    },

    /** L1: Sugerir creación de bot */
    _suggest(opportunity) {
        // No repetir sugerencia del mismo symbol en los últimos 5 minutos
        const recentSuggestion = this.state.suggestions.find(s =>
            s.symbol === opportunity.symbol &&
            Date.now() - new Date(s.timestamp).getTime() < 300000
        );
        if (recentSuggestion) return;

        const suggestion = {
            id: 'sug_' + Date.now().toString(36),
            symbol: opportunity.symbol,
            direction: opportunity.direction,
            confidence: opportunity.confidence,
            signal: opportunity.signal,
            timestamp: new Date().toISOString(),
            status: 'pending'
        };

        this.state.suggestions.push(suggestion);
        if (this.state.suggestions.length > 20) this.state.suggestions = this.state.suggestions.slice(-20);
        this._saveState();

        EventFeed.log('system', '💡',
            `SUGERENCIA: Crear bot ${opportunity.symbol} ${opportunity.direction} (${opportunity.confidence}% conf)`
        );
        Utils.showNotification(
            `🤖 Sugerencia: ${opportunity.symbol} ${opportunity.direction} (${opportunity.confidence}%) — ¿Crear bot?`,
            'info', 8000
        );

        this._logAction('suggest', `${opportunity.symbol} ${opportunity.direction} ${opportunity.confidence}%`);
    },

    /** Aprobar sugerencia manualmente (L1) */
    approveSuggestion(sugId) {
        const sug = this.state.suggestions.find(s => s.id === sugId);
        if (!sug || sug.status !== 'pending') return;

        sug.status = 'approved';
        this._autoCreateBot({
            symbol: sug.symbol,
            direction: sug.direction,
            confidence: sug.confidence
        });
        this._saveState();
    },

    /** L2/L3: Crear bot automáticamente */
    _autoCreateBot(opportunity) {
        const cfg = this.state.config;

        const botName = `Auto_${opportunity.symbol}_${Date.now().toString(36).slice(-3)}`;
        const bots = Lab._getBots();
        const activeBots = bots.filter(b => b.status !== 'archived');

        // Use configurable limit instead of hardcoded 10
        if (activeBots.length >= cfg.maxAutoBots + 5) return; // +5 buffer for manual bots

        const bot = {
            id: 'bot_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4),
            name: botName,
            symbol: opportunity.symbol,
            mode: cfg.autoMode,
            temperature: cfg.autoTemp,
            initialWallet: cfg.autoWallet,
            initialBalance: cfg.autoWallet,
            currentBalance: cfg.autoWallet,
            status: 'running',
            positions: [], trades: [], knowledge: [],
            stats: { trades: 0, wins: 0, losses: 0, totalPnl: 0 },
            checksRun: 0, lastCheck: null,
            createdAt: new Date().toISOString(),
            autoCreated: true, // Flag para identificar bots autónomos
            createdBy: 'autonomy',
            creationReason: `Radar: ${opportunity.symbol} ${opportunity.direction} ${opportunity.confidence}%`
        };

        bots.push(bot);
        Lab._saveBots(bots);
        this.state.autoBotIds.push(bot.id);
        this._saveState();

        // Arrancar el bot
        Lab._startBotInterval(bot.id);
        Lab.render();
        Header.updateLabCount();

        const msg = `AUTO-CREATE: ${botName} → ${opportunity.symbol} (${opportunity.confidence}% conf)`;
        EventFeed.log('system', '🤖', msg);
        Utils.showNotification(`🤖 ${msg}`, 'success', 8000);
        this._logAction('create', msg);
    },

    // ═══════════════════════════════════════
    // AUTO-KILL UNDERPERFORMERS
    // ═══════════════════════════════════════

    /** Calculate composite fitness score for bot ranking (0-100)
     *  IMPROVED: Uses proper risk metrics (Sharpe, real MaxDD, baselined WR) */
    _calculateFitnessScore(bot) {
        const trades = bot.trades || [];
        if (trades.length < 8) return { score: 50, components: {}, insufficient: true };

        const wins = trades.filter(t => t.pnl > 0);
        const losses = trades.filter(t => t.pnl <= 0);
        const wr = wins.length / trades.length;

        // ─── Win Rate Score (0-100) — weight 25% ───
        // FIXED: 50% WR = 50 points (baseline), not 50% = 50 points raw
        // Scale: 40% = 0, 50% = 50, 60% = 100
        const wrScore = Math.max(0, Math.min(100, (wr - 0.40) * 500));

        // ─── Profit Factor (0-100) — weight 20% ───
        const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
        const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
        const pf = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 5 : 0;
        // PF 1.0 = 0, PF 1.5 = 50, PF 2.0 = 100
        const pfScore = Math.max(0, Math.min(100, (pf - 1.0) * 100));

        // ─── Max Drawdown - Peak to Trough (0-100) — weight 20% ───
        const initial = bot.initialBalance || bot.initialWallet || 100;
        let peak = initial;
        let maxDD = 0;
        let runningBalance = initial;

        // Calculate true peak-to-trough drawdown
        for (const trade of trades) {
            runningBalance += trade.pnl || 0;
            if (runningBalance > peak) peak = runningBalance;
            const dd = (peak - runningBalance) / peak;
            if (dd > maxDD) maxDD = dd;
        }
        const maxDDPct = maxDD * 100;
        // 0% DD = 100, 10% DD = 50, 20% DD = 0
        const ddScore = Math.max(0, Math.min(100, 100 - maxDDPct * 5));

        // ─── Sharpe Ratio (0-100) — weight 20% ───
        const returns = trades.map(t => (t.pnlPercent || (t.pnl / initial * 100)));
        const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
        const variance = returns.reduce((s, r) => s + Math.pow(r - avgReturn, 2), 0) / returns.length;
        const stdDev = Math.sqrt(variance);
        // Sharpe = (avgReturn - riskFreeRate) / stdDev, using 0 as risk-free
        const sharpe = stdDev > 0 ? avgReturn / stdDev : 0;
        // Annualized approximation (assume ~100 trades/year for scalping)
        const annualizedSharpe = sharpe * Math.sqrt(Math.min(trades.length, 252));
        // Sharpe 0 = 50, Sharpe 1 = 75, Sharpe 2 = 100, Sharpe -1 = 25
        const sharpeScore = Math.max(0, Math.min(100, 50 + annualizedSharpe * 25));

        // ─── Sortino Ratio (0-100) — weight 15% ───
        const negReturns = returns.filter(r => r < 0);
        const downsideDev = negReturns.length > 0
            ? Math.sqrt(negReturns.reduce((s, r) => s + r * r, 0) / negReturns.length)
            : 0.001;
        const sortino = avgReturn / downsideDev;
        const sortinoScore = Math.max(0, Math.min(100, 50 + sortino * 20));

        // ─── Composite Score ───
        const composite = Math.round(
            wrScore * 0.25 +
            pfScore * 0.20 +
            ddScore * 0.20 +
            sharpeScore * 0.20 +
            sortinoScore * 0.15
        );

        // Current simple drawdown (for display)
        const currentDD = Math.max(0, (initial - bot.currentBalance) / initial * 100);
        const totalReturn = ((bot.currentBalance - initial) / initial) * 100;

        return {
            score: composite,
            components: {
                winRate: Math.round(wrScore),
                profitFactor: Math.round(pfScore),
                maxDrawdown: Math.round(ddScore),
                sharpe: Math.round(sharpeScore),
                sortino: Math.round(sortinoScore),
            },
            // Raw metrics for display
            wr: (wr * 100).toFixed(0),
            pf: pf.toFixed(2),
            maxDDPct: maxDDPct.toFixed(1),
            currentDD: currentDD.toFixed(1),
            sharpeRatio: annualizedSharpe.toFixed(2),
            sortinoRatio: sortino.toFixed(2),
            totalReturn: totalReturn.toFixed(1),
            tradesCount: trades.length,
        };
    },

    _evaluateKills() {
        // Solo en L2+ puede matar bots
        if (this.state.level < 2) return;

        const autoBots = this.state.autoBotIds
            .map(id => Lab._getBot(id))
            .filter(Boolean);

        // FIX: Calculate fitness for all bots and log ranking
        const ranked = autoBots
            .map(bot => ({ bot, fitness: this._calculateFitnessScore(bot) }))
            .filter(r => !r.fitness.insufficient)
            .sort((a, b) => b.fitness.score - a.fitness.score);

        if (ranked.length > 0) {
            const rankStr = ranked.map((r, i) =>
                `#${i+1} ${r.bot.name}: ${r.fitness.score}pts (WR:${r.fitness.wr}% PF:${r.fitness.pf})`
            ).join(' · ');
            console.log(`🤖 Autonomy ranking: ${rankStr}`);
        }

        for (const bot of autoBots) {
            const shouldKill = this._shouldKillBot(bot);
            if (shouldKill) {
                this._autoKillBot(bot, shouldKill.reason);
            }
        }
    },

    _shouldKillBot(bot) {
        const cfg = this.state.config;
        const trades = bot.trades || [];

        // Kill por drawdown (unchanged — this is a hard safety limit)
        const initialBalance = bot.initialBalance || bot.initialWallet || 100;
        const drawdown = ((initialBalance - bot.currentBalance) / initialBalance) * 100;
        if (drawdown >= cfg.killDrawdown) {
            return { reason: `Drawdown ${drawdown.toFixed(1)}% ≥ ${cfg.killDrawdown}%` };
        }

        // FIX: Use composite fitness score instead of just WR
        if (trades.length >= 10) {
            const fitness = this._calculateFitnessScore(bot);
            if (!fitness.insufficient) {
                // Fitness < 20 for 2+ evaluations = kill
                if (!bot._lowFitnessStreak) bot._lowFitnessStreak = 0;
                if (fitness.score < 20) {
                    bot._lowFitnessStreak++;
                    if (bot._lowFitnessStreak >= 2) {
                        return { reason: `Fitness ${fitness.score}/100 por ${bot._lowFitnessStreak} ciclos (WR:${fitness.wr}% PF:${fitness.pf} DD:${fitness.drawdown}%)` };
                    }
                } else {
                    bot._lowFitnessStreak = 0;
                }
            }
        }

        // Kill si lleva mucho tiempo sin tradear (stale bot)
        if (bot.status === 'running' && trades.length === 0 && bot.checksRun > 200) {
            return { reason: `${bot.checksRun} checks sin un solo trade — inactivo` };
        }

        return null;
    },

    _autoKillBot(bot, reason) {
        // Si tiene posiciones abiertas, dejar que el bot las maneje
        if ((bot.positions || []).length > 0) return;

        // Actualizar stats globales antes de matar
        this._updateGlobalStats(bot);

        // FIX: Archive instead of permanent delete — preserve knowledge for learning
        Lab.stopBot(bot.id);
        Lab._updateBot(bot.id, {
            status: 'archived',
            archivedAt: new Date().toISOString(),
            archiveReason: reason,
            fitnessAtDeath: this._calculateFitnessScore(bot)
        });
        this.state.autoBotIds = this.state.autoBotIds.filter(id => id !== bot.id);
        this._saveState();

        Lab.render();
        Header.updateLabCount();

        const msg = `AUTO-ARCHIVE: ${bot.name} archivado — ${reason}`;
        EventFeed.log('system', '📦', msg);
        Utils.showNotification(`🤖 ${msg}`, 'warning', 8000);
        this._logAction('archive', msg);
    },

    // ═══════════════════════════════════════
    // REBALANCE — Redistribuir capital
    // ═══════════════════════════════════════

    _evaluateRebalance() {
        if (this.state.level < 3) return; // Solo en L3

        const autoBots = this.state.autoBotIds
            .map(id => Lab._getBot(id))
            .filter(b => b && b.status === 'running' && (b.positions || []).length === 0);

        if (autoBots.length < 2) return;

        // Encontrar el peor y el mejor bot
        const sorted = autoBots
            .filter(b => (b.trades || []).length >= 5)
            .sort((a, b) => {
                const wrA = a.stats.trades > 0 ? a.stats.wins / a.stats.trades : 0;
                const wrB = b.stats.trades > 0 ? b.stats.wins / b.stats.trades : 0;
                return wrB - wrA;
            });

        if (sorted.length < 2) return;

        const best = sorted[0];
        const worst = sorted[sorted.length - 1];

        const bestWR = best.stats.trades > 0 ? (best.stats.wins / best.stats.trades * 100) : 0;
        const worstWR = worst.stats.trades > 0 ? (worst.stats.wins / worst.stats.trades * 100) : 0;

        // Solo rebalancear si hay diferencia significativa
        if (bestWR - worstWR < 20) return;

        // Mover 10% del wallet del peor al mejor
        const transferAmount = worst.currentBalance * 0.10;
        if (transferAmount < 2) return; // No vale la pena

        Lab._updateBot(worst.id, { currentBalance: worst.currentBalance - transferAmount });
        Lab._updateBot(best.id, { currentBalance: best.currentBalance + transferAmount });

        const msg = `REBALANCE: $${transferAmount.toFixed(2)} de ${worst.name} (${worstWR.toFixed(0)}% WR) → ${best.name} (${bestWR.toFixed(0)}% WR)`;
        EventFeed.log('system', '⚖️', msg);
        this._logAction('rebalance', msg);
    },

    // ═══════════════════════════════════════
    // HELPERS & STATS
    // ═══════════════════════════════════════

    _getGlobalAutoStats() {
        if (!this.state) this._loadState();
        const autoBots = (this.state.autoBotIds || [])
            .map(id => typeof Lab !== 'undefined' ? Lab._getBot(id) : null)
            .filter(Boolean);

        let totalTrades = 0, totalWins = 0, totalPnl = 0;
        for (const bot of autoBots) {
            totalTrades += bot.stats?.trades || 0;
            totalWins += bot.stats?.wins || 0;
            totalPnl += bot.stats?.totalPnl || 0;
        }

        // Sumar stats de bots ya eliminados
        totalTrades += this.state.totalAutoTrades;
        totalWins += this.state.totalAutoWins;
        totalPnl += this.state.totalAutoPnl;

        return {
            totalTrades,
            totalWins,
            totalPnl,
            winRate: totalTrades > 0 ? (totalWins / totalTrades * 100) : 0,
            activeBots: autoBots.filter(b => b.status === 'running').length,
            totalBots: autoBots.length
        };
    },

    _updateGlobalStats(bot) {
        // Guardar stats del bot antes de eliminarlo
        this.state.totalAutoTrades += bot.stats?.trades || 0;
        this.state.totalAutoWins += bot.stats?.wins || 0;
        this.state.totalAutoPnl += bot.stats?.totalPnl || 0;
    },

    _getTodayPnl() {
        const today = new Date().toISOString().slice(0, 10);
        const allBots = Lab._getBots();
        let pnl = 0;
        for (const bot of allBots) {
            const todayTrades = (bot.trades || []).filter(t => t.closedAt && t.closedAt.startsWith(today));
            pnl += todayTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
        }
        return pnl;
    },

    _getTotalInitialBalance() {
        return Lab._getBots()
            .filter(b => b.status === 'running')
            .reduce((sum, b) => sum + (b.initialBalance || b.initialWallet || 100), 0);
    },

    _getLevelName() {
        const names = { 1: 'Sugerencias', 2: 'Semi-Auto', 3: 'Full Auto' };
        return names[this.state.level] || 'Unknown';
    },

    _logAction(type, message) {
        this.state.history.push({
            type, message,
            level: this.state.level,
            timestamp: new Date().toISOString()
        });
        if (this.state.history.length > 100) this.state.history = this.state.history.slice(-100);
    },

    // ═══════════════════════════════════════
    // MANUAL CONTROLS
    // ═══════════════════════════════════════

    /** Forzar un nivel específico */
    setLevel(level) {
        if (level < 1 || level > 3) return;
        if (!this.state) this._loadState();
        const old = this.state.level;
        this.state.level = level;
        this.state.manualOverride = true; // Prevent auto-demotion
        this._saveState();
        EventFeed.system(`Autonomía: Nivel forzado ${old} → ${level} (${this._getLevelName()})`);
        Utils.showNotification(`🤖 Nivel ${level}: ${this._getLevelName()}`, 'success');
    },

    /** Ver estado completo */
    getStatus() {
        if (!this.state) this._loadState();
        const stats = this._getGlobalAutoStats();
        return {
            level: this.state.level,
            levelName: this._getLevelName(),
            config: this.state.config,
            stats,
            autoBots: this.state.autoBotIds.length,
            pendingSuggestions: this.state.suggestions.filter(s => s.status === 'pending').length,
            history: this.state.history.slice(-10),
            escalation: this._escalation,
        };
    },

    /** Actualizar configuración */
    configure(updates) {
        if (!this.state) this._loadState();
        Object.assign(this.state.config, updates);
        this._saveState();
        EventFeed.system(`Autonomía: Config actualizada`);
    },

    /** Update a single config key (used by Dashboard UI) */
    setConfig(key, value) {
        this.configure({ [key]: value });
    },

    /** Detener todo el sistema autónomo */
    shutdown() {
        if (this._checkInterval) clearInterval(this._checkInterval);
        this._checkInterval = null;

        if (!this.state) this._loadState();

        // Detener todos los auto-bots
        const autoBots = this.state.autoBotIds.map(id => Lab._getBot(id)).filter(Boolean);
        autoBots.forEach(b => {
            if (b.status === 'running') Lab.stopBot(b.id);
        });

        EventFeed.system('🤖 Autonomía APAGADA — todos los auto-bots detenidos');
        Utils.showNotification('🤖 Sistema autónomo apagado', 'warning');
    }
};
