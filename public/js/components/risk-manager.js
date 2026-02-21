/* ========================================
   RISK MANAGER — Automatic Protection System
   TheRealShortShady v4.2.0
   
   Guardrails automáticos:
   - Max daily loss → pausa bots
   - Max drawdown → cierra todo
   - Consecutive losses → cooldown
   - Position sizing dinámico
   - Portfolio correlation limit
   ======================================== */


const RiskManager = {

    // Configuración por defecto (el usuario puede cambiarla en settings)
    _config: {
        maxDailyLossPct: 5,         // 5% del balance inicial → pausa 24h
        maxDrawdownPct: 15,         // 15% del balance inicial → cierra todo
        maxConsecutiveLosses: 5,    // 5 losses seguidos → cooldown 30 min
        maxPositionPct: 25,         // Máximo 25% del wallet del bot en una posición
        maxOpenPositions: 10,       // Máximo 10 posiciones abiertas TOTAL (configurable desde Dashboard)
        maxSameSymbol: 2,           // Máximo 2 bots en el mismo symbol
        cooldownMinutes: 30,        // Cooldown después de consecutive losses
        minBalance: 5,              // Balance mínimo para seguir operando (en USD)
    },

    _cooldowns: {},    // { botId: expireTimestamp }
    _dailyPnL: {},     // { 'YYYY-MM-DD': { pnl: number, startBalance: number } }
    _paused: false,    // Pausa global de emergencia

    init() {
        // Cargar config guardada
        try {
            const saved = localStorage.getItem('tp_risk_config');
            if (saved) Object.assign(this._config, JSON.parse(saved));
        } catch(e) {}
        console.log('🛡️ RiskManager initialized');
    },

    /** Update a single config key and persist */
    setConfig(key, value) {
        this._config[key] = value;
        try {
            localStorage.setItem('tp_risk_config', JSON.stringify(this._config));
        } catch(e) {}
        console.log(`🛡️ RiskManager: ${key} = ${value}`);
    },

    // ═══════════════════════════════════════
    // CHECKS PRE-TRADE
    // ═══════════════════════════════════════

    /** Check principal: ¿puede este bot abrir una posición? */
    canTrade(bot, options = {}) {
        const checks = [
            this._checkGlobalPause(),
            this._checkMinBalance(bot),
            this._checkDailyLoss(bot),
            this._checkMaxDrawdown(bot),
            this._checkConsecutiveLosses(bot),
            this._checkCooldown(bot),
            this._checkMaxPositions(),
            this._checkSameSymbol(bot),
            this._checkPositionSize(bot, options.margin),
        ];

        const blocked = checks.find(c => !c.allowed);
        if (blocked) {
            EventFeed.riskBlock(`${bot.name}: ${blocked.reason}`);
            return blocked;
        }

        return { allowed: true };
    },

    /** Pausa global de emergencia */
    _checkGlobalPause() {
        if (this._paused) {
            return { allowed: false, reason: 'Sistema pausado por emergencia' };
        }
        return { allowed: true };
    },

    /** Balance mínimo para seguir operando */
    _checkMinBalance(bot) {
        if (bot.currentBalance < this._config.minBalance) {
            return { allowed: false, reason: `Balance $${bot.currentBalance.toFixed(2)} < mínimo $${this._config.minBalance}` };
        }
        return { allowed: true };
    },

    /** Max daily loss: si ya perdimos X% hoy, parar */
    _checkDailyLoss(bot) {
        const today = new Date().toISOString().slice(0, 10);
        const trades = (bot.trades || []).filter(t => 
            t.closedAt && t.closedAt.startsWith(today)
        );
        
        if (trades.length === 0) return { allowed: true };

        const dailyPnl = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);
        const initialBalance = bot.initialBalance || 100;
        const dailyLossPct = Math.abs(dailyPnl) / initialBalance * 100;

        if (dailyPnl < 0 && dailyLossPct >= this._config.maxDailyLossPct) {
            return { 
                allowed: false, 
                reason: `Daily loss ${dailyLossPct.toFixed(1)}% ≥ ${this._config.maxDailyLossPct}% — pausado hasta mañana` 
            };
        }
        return { allowed: true };
    },

    /** Max drawdown total: si el bot perdió X% desde inicio, parar todo */
    _checkMaxDrawdown(bot) {
        const initialBalance = bot.initialBalance || 100;
        const currentBalance = bot.currentBalance || 0;
        const drawdown = (initialBalance - currentBalance) / initialBalance * 100;

        if (drawdown >= this._config.maxDrawdownPct) {
            return { 
                allowed: false, 
                reason: `Drawdown ${drawdown.toFixed(1)}% ≥ ${this._config.maxDrawdownPct}% — bot detenido` 
            };
        }
        return { allowed: true };
    },

    /** Consecutive losses: reduce risk but KEEP TRADING so bot can learn */
    _checkConsecutiveLosses(bot) {
        const trades = bot.trades || [];
        if (trades.length < 3) return { allowed: true };

        // Contar losses consecutivos desde el final
        let consecutive = 0;
        for (let i = trades.length - 1; i >= 0; i--) {
            if (trades[i].pnl <= 0) consecutive++;
            else break;
        }

        // Instead of blocking: flag the streak so calculateOptimalMargin reduces size
        // Bot keeps trading with smaller positions = keeps learning
        if (consecutive >= 3) {
            bot._lossStreak = consecutive;
            EventFeed.log('risk', '🛡️', `${bot.name}: ${consecutive} losses seguidos — reduciendo riesgo (no frenando)`);
        } else {
            // FIX: Reset loss streak when bot wins (consecutive = 0, 1, or 2)
            if (bot._lossStreak) {
                delete bot._lossStreak;
                EventFeed.log('risk', '🛡️', `${bot.name}: racha de pérdidas terminada — riesgo normalizado`);
            }
        }

        // Only hard-block at extreme streaks (10+) as safety valve
        if (consecutive >= 10) {
            const cooldownEnd = Date.now() + (5 * 60 * 1000); // 5 min short cooldown, not 30
            this._cooldowns[bot.id] = cooldownEnd;
            return { 
                allowed: false, 
                reason: `${consecutive} losses seguidos — pausa breve 5 min para recalibrar` 
            };
        }

        return { allowed: true };
    },

    /** Check cooldown activo */
    _checkCooldown(bot) {
        const cooldownEnd = this._cooldowns[bot.id];
        if (cooldownEnd && Date.now() < cooldownEnd) {
            const remaining = Math.ceil((cooldownEnd - Date.now()) / 60000);
            return { allowed: false, reason: `En cooldown — ${remaining} min restantes` };
        }
        // Limpiar cooldown expirado
        if (cooldownEnd) delete this._cooldowns[bot.id];
        return { allowed: true };
    },

    /** Max posiciones abiertas total entre todos los bots */
    _checkMaxPositions() {
        if (typeof Lab === 'undefined') return { allowed: true };
        const allBots = Lab._getBots().filter(b => b.status === 'running');
        const totalPositions = allBots.reduce((sum, b) => sum + (b.positions || []).length, 0);

        if (totalPositions >= this._config.maxOpenPositions) {
            return { allowed: false, reason: `${totalPositions}/${this._config.maxOpenPositions} posiciones abiertas — máximo alcanzado` };
        }
        return { allowed: true };
    },

    /** Max bots en el mismo symbol */
    _checkSameSymbol(bot) {
        if (typeof Lab === 'undefined') return { allowed: true };
        const allBots = Lab._getBots().filter(b => b.status === 'running');
        const sameSymbol = allBots.filter(b => 
            b.id !== bot.id && 
            b.symbol === bot.symbol && 
            (b.positions || []).length > 0
        );

        if (sameSymbol.length >= this._config.maxSameSymbol) {
            return { 
                allowed: false, 
                reason: `Ya hay ${sameSymbol.length} bots con posición en ${bot.symbol}` 
            };
        }
        return { allowed: true };
    },

    /** Position size máximo */
    _checkPositionSize(bot, margin) {
        if (!margin) return { allowed: true };
        const maxMargin = bot.currentBalance * (this._config.maxPositionPct / 100);
        if (margin > maxMargin) {
            return { 
                allowed: false, 
                reason: `Margin $${margin.toFixed(2)} > máx ${this._config.maxPositionPct}% ($${maxMargin.toFixed(2)})` 
            };
        }
        return { allowed: true };
    },

    // ═══════════════════════════════════════
    // POSITION SIZING DINÁMICO
    // ═══════════════════════════════════════

    /** Calcula el margin óptimo basándose en performance del bot */
    calculateOptimalMargin(bot, baseRiskPct) {
        const trades = bot.trades || [];
        let multiplier = 1.0;

        // Si hay suficiente data, aplicar ajustes
        if (trades.length >= 10) {
            const wr = (bot.stats?.wins || 0) / trades.length;

            // Si WR < 40%, reducir position size
            if (wr < 0.40) multiplier *= 0.7;
            // Si WR > 60%, podemos ser un poco más agresivos (pero no mucho)
            else if (wr > 0.60) multiplier *= 1.1;
        }

        // Loss streak scaling: reduce size progressively but never stop
        // This is the key: bot keeps trading small to accumulate learning data
        const streak = bot._lossStreak || 0;
        if (streak >= 3) {
            // 3 losses = 50%, 5 = 30%, 7 = 20%, 9 = 15%
            const streakMultiplier = Math.max(0.15, 1 - streak * 0.12);
            multiplier *= streakMultiplier;
            console.log(`🛡️ ${bot.name}: loss streak ${streak} → position size ${(streakMultiplier*100).toFixed(0)}%`);
        }

        // Recovery: after winning, gradually increase back
        if (trades.length >= 2 && streak === 0) {
            const last3 = trades.slice(-3);
            const recentWins = last3.filter(t => t.pnl > 0).length;
            if (recentWins >= 2) {
                multiplier *= 1.05; // Small recovery boost
            }
        }

        const margin = bot.currentBalance * (baseRiskPct / 100) * multiplier;
        
        // Clamp: mínimo 0.5% del balance (tiny trades for learning), máximo según config
        const min = bot.currentBalance * 0.005;
        const max = bot.currentBalance * (this._config.maxPositionPct / 100);
        
        return Math.max(min, Math.min(max, margin));
    },

    // ═══════════════════════════════════════
    // POST-TRADE CHECKS
    // ═══════════════════════════════════════

    /** Llamar después de cada trade cerrado para verificar si hay que pausar */
    afterTrade(bot) {
        // Check daily loss
        const dailyCheck = this._checkDailyLoss(bot);
        if (!dailyCheck.allowed) {
            EventFeed.riskBlock(`${bot.name}: ${dailyCheck.reason}`);
            this._pauseBot(bot, dailyCheck.reason);
            return;
        }

        // Check drawdown
        const ddCheck = this._checkMaxDrawdown(bot);
        if (!ddCheck.allowed) {
            EventFeed.riskBlock(`${bot.name}: ${ddCheck.reason}`);
            this._pauseBot(bot, ddCheck.reason);
            return;
        }

        // Check consecutive losses → cooldown
        const clCheck = this._checkConsecutiveLosses(bot);
        if (!clCheck.allowed) {
            EventFeed.riskBlock(`${bot.name}: ${clCheck.reason}`);
            // No pausar permanentemente, solo cooldown (ya se seteo en el check)
        }
    },

    /** Pausar un bot por razón de riesgo */
    _pauseBot(bot, reason) {
        if (typeof Lab !== 'undefined' && Lab.stopBot) {
            Lab.stopBot(bot.id);
            Utils.showNotification(`🛡️ ${bot.name} detenido: ${reason}`, 'error', 10000);
        }
    },

    // ═══════════════════════════════════════
    // EMERGENCY CONTROLS
    // ═══════════════════════════════════════

    /** Kill switch: pausa TODOS los bots inmediatamente */
    emergencyStop() {
        this._paused = true;
        if (typeof Lab !== 'undefined') {
            const bots = Lab._getBots().filter(b => b.status === 'running');
            bots.forEach(b => Lab.stopBot(b.id));
            EventFeed.riskBlock(`⚠️ EMERGENCY STOP — ${bots.length} bots detenidos`);
            Utils.showNotification(`🛡️ EMERGENCIA: ${bots.length} bots detenidos`, 'error', 15000);
        }
    },

    /** Reactivar después de emergency stop */
    resume() {
        this._paused = false;
        this._cooldowns = {};
        EventFeed.system('🛡️ Risk Manager reactivado — bots pueden operar');
        Utils.showNotification('🛡️ Sistema reactivado', 'success');
    },

    // ═══════════════════════════════════════
    // MANUAL CONTROLS — POSICIONES DEL USUARIO
    // ═══════════════════════════════════════

    /** Smart Close: evalúa y cierra posiciones manuales que estima no llegarán al TP */
    smartCloseCheck() {
        const positions = State.positions;
        if (positions.length === 0) {
            Utils.showNotification('🛡️ Sin posiciones abiertas', 'info');
            return { closed: 0, evaluated: 0, details: [] };
        }

        const details = [];
        const toClose = [];

        for (const pos of positions) {
            const price = State.prices[pos.symbol]?.price;
            if (!price) continue;
            const eval_ = this._evaluatePositionHealth(pos, price);
            details.push(eval_);
            if (eval_.action === 'CLOSE') {
                toClose.push({ id: pos.id, reason: eval_.reason });
            }
        }

        for (const { id, reason } of toClose) {
            if (typeof Trading !== 'undefined' && Trading._executeClose) {
                Trading._executeClose(id, `🛡️ Smart Close: ${reason}`, '');
            }
        }

        if (toClose.length > 0) {
            Utils.showNotification(`🛡️ Smart Close: ${toClose.length} posición(es) cerrada(s)`, 'warning', 8000);
        } else {
            Utils.showNotification(`🛡️ Smart Close: ${positions.length} evaluadas — todas OK`, 'success');
        }

        this.renderManualRiskPanel();
        return { closed: toClose.length, evaluated: positions.length, details };
    },

    /** Evalúa la salud de una posición individual */
    _evaluatePositionHealth(pos, currentPrice) {
        const isLong = pos.direction === 'LONG';
        const elapsed = Date.now() - new Date(pos.timestamp).getTime();
        const elapsedMin = elapsed / 60000;

        const exitFee = pos.fee || (pos.size * (CONFIG.TRADING.FEE_RATE || 0.0004));
        const pnl = isLong
            ? ((currentPrice - pos.entry) / pos.entry) * pos.size - exitFee
            : ((pos.entry - currentPrice) / pos.entry) * pos.size - exitFee;
        const pnlPct = pos.margin > 0 ? (pnl / pos.margin) * 100 : 0;

        const tpDist = pos.tp ? Math.abs(pos.tp - currentPrice) / currentPrice * 100 : 999;
        const slDist = pos.sl ? Math.abs(pos.sl - currentPrice) / currentPrice * 100 : 999;
        const liqDist = pos.liq ? Math.abs(pos.liq - currentPrice) / currentPrice * 100 : 999;

        const totalRange = Math.abs((pos.tp || 0) - (pos.sl || 0));
        let progress = 50;
        if (totalRange > 0) {
            if (isLong) progress = ((currentPrice - pos.sl) / totalRange) * 100;
            else progress = ((pos.sl - currentPrice) / totalRange) * 100;
        }
        progress = Math.max(0, Math.min(100, progress));

        const modeTimeouts = { scalping: 10, intraday: 360, swing: 2880, position: 20160 };
        const maxTime = modeTimeouts[pos.mode] || modeTimeouts.intraday;

        let action = 'HOLD';
        let reason = '';
        let healthScore = 100;

        if (pnlPct < -50) {
            action = 'CLOSE'; reason = `Pérdida severa: ${pnlPct.toFixed(1)}%`; healthScore = 5;
        } else if (liqDist < 2) {
            action = 'CLOSE'; reason = `Cerca de liquidación: ${liqDist.toFixed(1)}%`; healthScore = 3;
        } else if (elapsedMin > maxTime * 1.5 && pnlPct < -5) {
            action = 'CLOSE'; reason = `Timeout x1.5 + pérdida ${pnlPct.toFixed(1)}%`; healthScore = 15;
        } else if (progress < 15 && pnlPct < -3) {
            action = 'CLOSE'; reason = `Cerca del SL (${progress.toFixed(0)}%) + pérdida`; healthScore = 12;
        } else if (elapsedMin > maxTime * 0.8 && pnlPct < 0 && progress < 35) {
            action = 'CLOSE'; reason = `Sin recuperación (progreso ${progress.toFixed(0)}%)`; healthScore = 20;
        } else if (pnlPct < -20) {
            healthScore = 25; reason = `Pérdida ${pnlPct.toFixed(1)}% — monitorear`;
        } else if (progress < 30) {
            healthScore = 40; reason = `Cerca del SL (${progress.toFixed(0)}%)`;
        } else if (pnlPct > 0) {
            healthScore = 80 + Math.min(20, pnlPct); reason = `En ganancia +${pnlPct.toFixed(1)}%`;
        } else {
            healthScore = 60 + pnlPct; reason = `Normal — ${pnlPct.toFixed(1)}%`;
        }

        return {
            id: pos.id, symbol: pos.symbol, direction: pos.direction,
            pnl, pnlPct, progress, liqDist, elapsedMin,
            healthScore: Math.max(0, Math.min(100, Math.round(healthScore))),
            action, reason
        };
    },

    /** Force close ALL manual positions */
    forceCloseAllManual() {
        const positions = [...State.positions];
        if (positions.length === 0) { Utils.showNotification('🛡️ Sin posiciones', 'info'); return; }
        let closed = 0;
        for (const pos of positions) {
            if (typeof Trading !== 'undefined' && Trading._executeClose) {
                Trading._executeClose(pos.id, '🛡️ Force Close All', '');
                closed++;
            }
        }
        Utils.showNotification(`🛡️ ${closed} posiciones cerradas`, 'warning', 8000);
        this.renderManualRiskPanel();
    },

    /** Get aggregated risk status for manual positions */
    getManualPositionsRisk() {
        const positions = State.positions;
        if (positions.length === 0) return { positions: [], avgHealth: 100, worstHealth: 100 };
        const evaluated = positions.map(pos => {
            const price = State.prices[pos.symbol]?.price || pos.entry;
            return this._evaluatePositionHealth(pos, price);
        });
        const avgHealth = evaluated.reduce((s, e) => s + e.healthScore, 0) / evaluated.length;
        return { positions: evaluated, avgHealth: Math.round(avgHealth), worstHealth: Math.min(...evaluated.map(e => e.healthScore)) };
    },

    /** Render manual risk panel UI */
    renderManualRiskPanel() {
        const container = document.getElementById('riskManagerPanel');
        if (!container) return;

        const risk = this.getManualPositionsRisk();
        const hc = risk.avgHealth >= 70 ? 'var(--green)' : risk.avgHealth >= 40 ? 'var(--yellow)' : 'var(--red)';

        container.innerHTML = `
            <div class="risk-panel">
                <div class="risk-panel-header">
                    <span>🛡️ Risk Manager</span>
                    <span class="risk-health" style="color:${hc}">${risk.avgHealth}% salud</span>
                </div>
                ${risk.positions.length > 0 ? `
                    <div class="risk-positions-list">
                        ${risk.positions.map(p => `
                            <div class="risk-pos-item ${p.action === 'CLOSE' ? 'danger' : p.healthScore < 40 ? 'warning' : ''}">
                                <span>${p.direction === 'LONG' ? '▲' : '▼'} ${p.symbol}</span>
                                <span style="color:${p.pnl >= 0 ? 'var(--green)' : 'var(--red)'}">${p.pnlPct.toFixed(1)}%</span>
                                <span class="risk-health-badge" style="background:${p.healthScore >= 70 ? 'var(--green)' : p.healthScore >= 40 ? 'var(--yellow)' : 'var(--red)'}">${p.healthScore}</span>
                                ${p.action === 'CLOSE' ? '<span style="color:var(--red);font-size:10px">⚠ CERRAR</span>' : ''}
                            </div>
                        `).join('')}
                    </div>
                ` : '<div class="risk-empty">Sin posiciones abiertas</div>'}
                <div class="risk-actions">
                    <button class="risk-btn risk-btn-smart" onclick="RiskManager.smartCloseCheck()" title="Evalúa y cierra posiciones que no llegarán al TP">
                        🧠 Smart Close
                    </button>
                    <button class="risk-btn risk-btn-close-all" onclick="RiskManager.confirmForceCloseAll()" title="Cerrar TODAS las posiciones">
                        ⚠️ Cerrar Todo
                    </button>
                    ${this._paused ?
                        `<button class="risk-btn risk-btn-resume" onclick="RiskManager.resume()">▶ Reactivar</button>` :
                        `<button class="risk-btn risk-btn-pause" onclick="RiskManager.emergencyStop()">⏸ Pausar Bots</button>`
                    }
                </div>
            </div>
        `;
    },

    _forceCloseConfirm: false,
    confirmForceCloseAll() {
        const count = State.positions.length;
        if (count === 0) { Utils.showNotification('Sin posiciones', 'info'); return; }
        if (!this._forceCloseConfirm) {
            this._forceCloseConfirm = true;
            Utils.showNotification(`⚠️ Clickeá otra vez para cerrar ${count} posiciones`, 'warning', 4000);
            setTimeout(() => { this._forceCloseConfirm = false; }, 4000);
        } else {
            this._forceCloseConfirm = false;
            this.forceCloseAllManual();
        }
    },

    // ═══════════════════════════════════════
    // STATUS & REPORTING
    // ═══════════════════════════════════════

    /** Resumen del estado de riesgo de un bot */
    getBotRiskStatus(bot) {
        const trades = bot.trades || [];
        const initialBalance = bot.initialBalance || 100;
        const currentBalance = bot.currentBalance || 0;
        const drawdown = ((initialBalance - currentBalance) / initialBalance * 100);

        // Daily PnL
        const today = new Date().toISOString().slice(0, 10);
        const todayTrades = trades.filter(t => t.closedAt && t.closedAt.startsWith(today));
        const dailyPnl = todayTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
        const dailyLossPct = dailyPnl < 0 ? Math.abs(dailyPnl) / initialBalance * 100 : 0;

        // Consecutive losses
        let consecutiveLosses = 0;
        for (let i = trades.length - 1; i >= 0; i--) {
            if (trades[i].pnl <= 0) consecutiveLosses++;
            else break;
        }

        // Cooldown status
        const cooldownEnd = this._cooldowns[bot.id];
        const inCooldown = cooldownEnd && Date.now() < cooldownEnd;
        const cooldownRemaining = inCooldown ? Math.ceil((cooldownEnd - Date.now()) / 60000) : 0;

        return {
            drawdown: drawdown.toFixed(1),
            drawdownPct: drawdown,
            maxDrawdownPct: this._config.maxDrawdownPct,
            dailyPnl: dailyPnl.toFixed(2),
            dailyLossPct: dailyLossPct.toFixed(1),
            maxDailyLossPct: this._config.maxDailyLossPct,
            consecutiveLosses,
            maxConsecutiveLosses: this._config.maxConsecutiveLosses,
            inCooldown,
            cooldownRemaining,
            healthScore: this._healthScore(drawdown, dailyLossPct, consecutiveLosses),
        };
    },

    /** Health score 0-100 (100 = perfecto, 0 = al borde de pausa) */
    _healthScore(drawdown, dailyLossPct, consecutiveLosses) {
        let score = 100;
        
        // Drawdown impact (0-40 points)
        score -= (drawdown / this._config.maxDrawdownPct) * 40;
        
        // Daily loss impact (0-30 points)
        score -= (dailyLossPct / this._config.maxDailyLossPct) * 30;
        
        // Consecutive losses impact (0-30 points)
        score -= (consecutiveLosses / this._config.maxConsecutiveLosses) * 30;

        return Math.max(0, Math.min(100, Math.round(score)));
    },
};
