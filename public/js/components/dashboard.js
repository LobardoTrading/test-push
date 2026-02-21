/* ========================================
   DASHBOARD — Monitoring Cockpit
   TheRealShortShady v4.2.0
   
   Centro de monitoreo con vista de:
   - Overview global (PnL, WR, Balance)
   - Estado de cada sistema (Risk, Learning, Autonomy)
   - Bot performance grid
   - Activity feed en vivo
   ======================================== */

const Dashboard = {

    _refreshInterval: null,
    _isOpen: false,

    init() {
        console.log('📊 Dashboard.init()');
    },

    toggle() {
        const overlay = document.getElementById('dashboardOverlay');
        if (!overlay) return;
        if (this._isOpen) this.close();
        else this.open();
    },

    open() {
        const overlay = document.getElementById('dashboardOverlay');
        if (!overlay) return;
        overlay.classList.add('active');
        this._isOpen = true;
        this.render();
        this._refreshInterval = setInterval(() => this.render(), 5000);
    },

    close() {
        const overlay = document.getElementById('dashboardOverlay');
        if (!overlay) return;
        overlay.classList.remove('active');
        this._isOpen = false;
        if (this._refreshInterval) { clearInterval(this._refreshInterval); this._refreshInterval = null; }
    },

    render() {
        const container = document.getElementById('dashboardContent');
        if (!container) return;

        const bots = typeof Lab !== 'undefined' ? Lab._getBots() : [];
        const globals = this._calcGlobals(bots);
        const riskData = this._getRiskData(bots);
        const autonomyData = this._getAutonomyData();
        const learningData = this._getLearningData(bots);

        container.innerHTML = `
            ${this._renderOverview(globals, bots)}
            <div class="dash-grid-2">
                ${this._renderSystemHealth(riskData, autonomyData)}
                ${this._renderAutonomy(autonomyData)}
            </div>
            ${this._renderSniper()}
            ${this._renderLearningMonitor()}
            ${this._renderBotGrid(bots, learningData)}
            ${this._renderRecentActivity()}
        `;
    },

    // ═══════════════════════════════════════
    // OVERVIEW — Fila principal de métricas
    // ═══════════════════════════════════════

    _renderOverview(g, bots) {
        const running = bots.filter(b => b.status === 'running').length;
        const openPos = bots.reduce((s, b) => s + (b.positions || []).length, 0);

        return `
            <div class="dash-overview">
                <div class="dash-metric">
                    <div class="dash-metric-label">PnL Total</div>
                    <div class="dash-metric-value ${g.totalPnl >= 0 ? 'up' : 'down'}">${Utils.formatPnL(g.totalPnl)}</div>
                </div>
                <div class="dash-metric">
                    <div class="dash-metric-label">Win Rate</div>
                    <div class="dash-metric-value ${g.wr >= 50 ? 'up' : 'down'}">${g.wr}%</div>
                </div>
                <div class="dash-metric">
                    <div class="dash-metric-label">Trades</div>
                    <div class="dash-metric-value">${g.totalTrades}</div>
                </div>
                <div class="dash-metric">
                    <div class="dash-metric-label">Bots Activos</div>
                    <div class="dash-metric-value">${running} <span class="dash-metric-sub">/ ${bots.length}</span></div>
                </div>
                <div class="dash-metric">
                    <div class="dash-metric-label">Posiciones</div>
                    <div class="dash-metric-value">${openPos}</div>
                </div>
                <div class="dash-metric">
                    <div class="dash-metric-label">Capital Total</div>
                    <div class="dash-metric-value">${Utils.formatCurrency(g.totalBalance)}</div>
                </div>
            </div>
        `;
    },

    // ═══════════════════════════════════════
    // SYSTEM HEALTH — Risk + Pipeline
    // ═══════════════════════════════════════

    _renderSystemHealth(risk, autonomy) {
        const pipelineCache = typeof SignalPipeline !== 'undefined' ? SignalPipeline._cache : {};
        const cacheSize = Object.keys(pipelineCache).length;

        return `
            <div class="dash-card">
                <div class="dash-card-title">🛡️ Risk Manager</div>
                <div class="dash-card-body">
                    <div class="dash-row"><span>Estado</span><span class="dash-tag ${risk.paused ? 'red' : 'green'}">${risk.paused ? '⏸ PAUSADO' : '✅ Activo'}</span></div>
                    <div class="dash-row"><span>Daily Loss</span><span class="${risk.dailyLossPct > 3 ? 'dash-warn' : ''}">${risk.dailyLossPct.toFixed(1)}% / ${risk.maxDailyLoss}%</span></div>
                    <div class="dash-row"><span>Max Drawdown</span><span class="${risk.maxDrawdown > 10 ? 'dash-warn' : ''}">${risk.maxDrawdown.toFixed(1)}% / ${risk.maxDrawdownLimit}%</span></div>
                    <div class="dash-row"><span>Bots en Cooldown</span><span>${risk.botsInCooldown}</span></div>
                    <div class="dash-divider"></div>
                    <div class="dash-config-row">
                        <span>Máx posiciones abiertas</span>
                        <div class="dash-config-control">
                            <button class="dash-cfg-btn" onclick="RiskManager.setConfig('maxOpenPositions', Math.max(1, RiskManager._config.maxOpenPositions - 1)); Dashboard.render();">−</button>
                            <span class="dash-cfg-val">${risk.maxPositions}</span>
                            <button class="dash-cfg-btn" onclick="RiskManager.setConfig('maxOpenPositions', Math.min(30, RiskManager._config.maxOpenPositions + 1)); Dashboard.render();">+</button>
                        </div>
                    </div>
                    <div class="dash-config-row">
                        <span>Máx mismo símbolo</span>
                        <div class="dash-config-control">
                            <button class="dash-cfg-btn" onclick="RiskManager.setConfig('maxSameSymbol', Math.max(1, RiskManager._config.maxSameSymbol - 1)); Dashboard.render();">−</button>
                            <span class="dash-cfg-val">${risk.maxSameSymbol}</span>
                            <button class="dash-cfg-btn" onclick="RiskManager.setConfig('maxSameSymbol', Math.min(10, RiskManager._config.maxSameSymbol + 1)); Dashboard.render();">+</button>
                        </div>
                    </div>
                    <div class="dash-divider"></div>
                    <div class="dash-row"><span>Pipeline Cache</span><span>${cacheSize} symbols</span></div>
                    <div class="dash-row"><span>Radar Oportunidades</span><span>${typeof Lab !== 'undefined' ? (Lab._opportunities || []).length : 0}</span></div>
                </div>
            </div>
        `;
    },

    // ═══════════════════════════════════════
    // AUTONOMY STATUS
    // ═══════════════════════════════════════

    _renderAutonomy(a) {
        const levelColors = { 1: 'var(--blue)', 2: 'var(--yellow)', 3: 'var(--green)' };
        const levelColor = levelColors[a.level] || 'var(--dim)';

        const historyHTML = a.history.slice(-5).reverse().map(h => {
            const time = new Date(h.timestamp).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
            const icon = h.type === 'create' ? '🤖' : h.type === 'kill' ? '☠️' : h.type === 'promote' ? '⬆️' : h.type === 'demote' ? '⬇️' : h.type === 'suggest' ? '💡' : '📝';
            return `<div class="dash-history-item"><span class="dash-history-time">${time}</span> ${icon} ${h.message.slice(0, 60)}</div>`;
        }).join('') || '<div class="dash-empty-small">Sin actividad autónoma</div>';

        const suggestionsHTML = a.suggestions.length > 0
            ? a.suggestions.map(s => `
                <div class="dash-suggestion">
                    <span>${s.symbol} ${s.direction} (${s.confidence}%)</span>
                    <button class="dash-btn-sm" onclick="Autonomy.approveSuggestion('${s.id}'); Dashboard.render();">Aprobar</button>
                </div>
            `).join('')
            : '';

        return `
            <div class="dash-card">
                <div class="dash-card-title">🤖 Autonomía</div>
                <div class="dash-card-body">
                    <div class="dash-row">
                        <span>Nivel</span>
                        <span class="dash-level" style="color:${levelColor}">L${a.level} — ${a.levelName}</span>
                    </div>
                    <div class="dash-row"><span>Auto-bots</span><span>${a.autoBots} / ${a.maxAutoBots}</span></div>
                    <div class="dash-row"><span>Auto Trades</span><span>${a.stats.totalTrades}</span></div>
                    <div class="dash-row"><span>Auto WR</span><span class="${a.stats.winRate >= 50 ? '' : 'dash-warn'}">${a.stats.winRate.toFixed(0)}%</span></div>
                    <div class="dash-row"><span>Auto PnL</span><span class="${a.stats.totalPnl >= 0 ? 'dash-up' : 'dash-down'}">${Utils.formatPnL(a.stats.totalPnl)}</span></div>
                    ${suggestionsHTML ? `<div class="dash-divider"></div><div class="dash-subsection-title">💡 Sugerencias Pendientes</div>${suggestionsHTML}` : ''}
                    <div class="dash-divider"></div>
                    <div class="dash-subsection-title">⚙️ Configuración</div>
                    <div class="dash-config-row">
                        <span>Máx bots simultáneos</span>
                        <div class="dash-config-control">
                            <button class="dash-cfg-btn" onclick="Autonomy.setConfig('maxAutoBots', Math.max(1, (Autonomy.state.config.maxAutoBots || 3) - 1)); Dashboard.render();">−</button>
                            <span class="dash-cfg-val">${a.maxAutoBots}</span>
                            <button class="dash-cfg-btn" onclick="Autonomy.setConfig('maxAutoBots', Math.min(20, (Autonomy.state.config.maxAutoBots || 3) + 1)); Dashboard.render();">+</button>
                        </div>
                    </div>
                    <div class="dash-config-row">
                        <span>Wallet por bot</span>
                        <div class="dash-config-control">
                            <button class="dash-cfg-btn" onclick="Autonomy.setConfig('autoWallet', Math.max(10, (Autonomy.state.config.autoWallet || 50) - 10)); Dashboard.render();">−</button>
                            <span class="dash-cfg-val">$${a.autoWallet || 50}</span>
                            <button class="dash-cfg-btn" onclick="Autonomy.setConfig('autoWallet', Math.min(500, (Autonomy.state.config.autoWallet || 50) + 10)); Dashboard.render();">+</button>
                        </div>
                    </div>
                    <div class="dash-config-row">
                        <span>Modo</span>
                        <select class="dash-cfg-select" onchange="Autonomy.setConfig('autoMode', this.value); Dashboard.render();">
                            <option value="scalping" ${(a.autoMode || 'intraday') === 'scalping' ? 'selected' : ''}>Scalping</option>
                            <option value="intraday" ${(a.autoMode || 'intraday') === 'intraday' ? 'selected' : ''}>Intraday</option>
                            <option value="swing" ${(a.autoMode || 'intraday') === 'swing' ? 'selected' : ''}>Swing</option>
                        </select>
                    </div>
                    <div class="dash-config-row">
                        <span>Temperatura</span>
                        <select class="dash-cfg-select" onchange="Autonomy.setConfig('autoTemp', this.value); Dashboard.render();">
                            <option value="conservative" ${(a.autoTemp || 'normal') === 'conservative' ? 'selected' : ''}>🧊 Conservative</option>
                            <option value="normal" ${(a.autoTemp || 'normal') === 'normal' ? 'selected' : ''}>🔥 Normal</option>
                            <option value="aggressive" ${(a.autoTemp || 'normal') === 'aggressive' ? 'selected' : ''}>🌋 Aggressive</option>
                        </select>
                    </div>
                    <div class="dash-divider"></div>
                    <div class="dash-subsection-title">Historial</div>
                    <div class="dash-history">${historyHTML}</div>
                    <div class="dash-divider"></div>
                    <div class="dash-controls">
                        <button class="dash-btn ${a.level === 1 ? 'active' : ''}" onclick="Autonomy.setLevel(1); Dashboard.render();">L1 Sugerencias</button>
                        <button class="dash-btn ${a.level === 2 ? 'active' : ''}" onclick="Autonomy.setLevel(2); Dashboard.render();">L2 Semi-Auto</button>
                        <button class="dash-btn ${a.level === 3 ? 'active' : ''}" onclick="Autonomy.setLevel(3); Dashboard.render();">L3 Full Auto</button>
                    </div>
                </div>
            </div>
        `;
    },

    // ═══════════════════════════════════════
    // SNIPER MODE CONFIG
    // ═══════════════════════════════════════

    _renderSniper() {
        const sniper = typeof Autonomy !== 'undefined' ? Autonomy.getSniperConfig() : null;
        const cfg = typeof Autonomy !== 'undefined' ? Autonomy.state?.config : {};
        const enabled = cfg.sniperEnabled || false;
        const minConf = cfg.sniperMinConf || 78;
        const leverage = cfg.sniperLeverage || 50;
        const marginPct = cfg.sniperMarginPct || 5;
        const direction = cfg.sniperDirection || 'regime';
        const blacklist = cfg.sniperBlacklist || [];

        const allSymbols = ['BTC','ETH','BNB','XRP','ADA','DOT','LINK','AVAX','OP','INJ','POL','SOL'];
        const shadowOn = cfg.sniperShadowMode !== false;

        const symbolChips = allSymbols.map(s => {
            const blocked = blacklist.includes(s);
            const chipClass = blocked ? (shadowOn ? 'shadow' : 'blocked') : 'allowed';
            const icon = blocked ? (shadowOn ? '👻' : '🚫') : '✅';
            const title = blocked 
                ? (shadowOn ? 'Shadow mode — operando sin wallet, click para permitir' : 'Bloqueado — click para permitir')
                : 'Permitido — click para bloquear';
            return `<span class="sniper-chip ${chipClass}" 
                onclick="Autonomy.toggleSniperBlacklist('${s}'); Dashboard.render();"
                title="${title}"
            >${icon} ${s}</span>`;
        }).join('');

        return `
            <div class="dash-card sniper-card ${enabled ? 'sniper-active' : ''}">
                <div class="dash-card-title" style="display:flex; align-items:center; justify-content:space-between;">
                    <span>🎯 Sniper Mode</span>
                    <label class="sniper-toggle">
                        <input type="checkbox" ${enabled ? 'checked' : ''} 
                            onchange="Autonomy.setSniperEnabled(this.checked); Dashboard.render();">
                        <span class="sniper-toggle-slider"></span>
                    </label>
                </div>
                <div class="dash-card-body">
                    ${!enabled ? `
                        <div style="text-align:center; padding:10px; color:var(--dim); font-size:12px;">
                            Sniper desactivado — opera en modo normal.<br>
                            Activalo para filtrar por confianza alta, dirección y pares selectos.
                        </div>
                    ` : `
                        <div class="sniper-status">🟢 ACTIVO — Solo trades de alta probabilidad</div>

                        <div class="dash-config-row">
                            <span>Confianza mínima</span>
                            <div class="dash-config-control">
                                <button class="dash-cfg-btn" onclick="Autonomy.setSniperConfig('minConf', Math.max(60, ${minConf} - 1)); Dashboard.render();">−</button>
                                <span class="dash-cfg-val">${minConf}%</span>
                                <button class="dash-cfg-btn" onclick="Autonomy.setSniperConfig('minConf', Math.min(95, ${minConf} + 1)); Dashboard.render();">+</button>
                            </div>
                        </div>

                        <div class="dash-config-row">
                            <span>Leverage</span>
                            <div class="dash-config-control">
                                <button class="dash-cfg-btn" onclick="Autonomy.setSniperConfig('leverage', Math.max(5, ${leverage} - 5)); Dashboard.render();">−</button>
                                <span class="dash-cfg-val">${leverage}x</span>
                                <button class="dash-cfg-btn" onclick="Autonomy.setSniperConfig('leverage', Math.min(125, ${leverage} + 5)); Dashboard.render();">+</button>
                            </div>
                        </div>

                        <div class="dash-config-row">
                            <span>Margen por trade</span>
                            <div class="dash-config-control">
                                <button class="dash-cfg-btn" onclick="Autonomy.setSniperConfig('marginPct', Math.max(1, ${marginPct} - 1)); Dashboard.render();">−</button>
                                <span class="dash-cfg-val">${marginPct}%</span>
                                <button class="dash-cfg-btn" onclick="Autonomy.setSniperConfig('marginPct', Math.min(25, ${marginPct} + 1)); Dashboard.render();">+</button>
                            </div>
                        </div>

                        <div class="dash-config-row">
                            <span>Dirección</span>
                            <select class="dash-cfg-select" onchange="Autonomy.setSniperConfig('direction', this.value); Dashboard.render();">
                                <option value="regime" ${direction === 'regime' ? 'selected' : ''}>📊 Seguir régimen</option>
                                <option value="long" ${direction === 'long' ? 'selected' : ''}>🟢 Solo LONG</option>
                                <option value="short" ${direction === 'short' ? 'selected' : ''}>🔴 Solo SHORT</option>
                                <option value="both" ${direction === 'both' ? 'selected' : ''}>↕️ Ambas</option>
                            </select>
                        </div>

                        <div class="dash-divider"></div>
                        <div class="dash-subsection-title">Pares (click para bloquear/permitir)</div>
                        <div class="sniper-symbols">${symbolChips}</div>

                        <div class="dash-divider"></div>
                        <div class="sniper-summary">
                            <span>Config: ≥${minConf}% conf | ${leverage}x lev | ${marginPct}% margin | ${direction === 'regime' ? 'Régimen' : direction === 'long' ? 'Solo LONG' : direction === 'short' ? 'Solo SHORT' : 'Ambas'}</span>
                            ${blacklist.length > 0 ? `<br><span style="color:var(--bearish);">Bloqueados: ${blacklist.join(', ')}</span>` : ''}
                        </div>

                        <div class="dash-divider"></div>
                        <div class="dash-subsection-title">🧠 Auto-Tune</div>
                        <div style="font-size:10px; color:var(--dim); padding:2px 0;">
                            El Sniper analiza sus resultados cada 5 min y se auto-ajusta:
                            blacklistea pares perdedores, cambia dirección, ajusta confianza y leverage.
                        </div>
                        ${(() => {
                            const history = (typeof Autonomy !== 'undefined' && Autonomy.state?.sniperTuneHistory) || [];
                            if (history.length === 0) return '<div style="font-size:10px; color:var(--dim); padding:4px 0;">Sin ajustes todavía — esperando datos...</div>';
                            const recent = history.slice(-3).reverse();
                            return recent.map(h => {
                                const time = new Date(h.timestamp).toLocaleTimeString();
                                return '<div style="font-size:10px; padding:2px 0; border-bottom:1px solid rgba(255,255,255,0.05);">' +
                                    '<span style="color:var(--dim);">' + time + '</span> ' +
                                    h.changes.map(c => '<div style="padding-left:8px;">' + c + '</div>').join('') +
                                    '</div>';
                            }).join('');
                        })()}
                    `}
                </div>
            </div>
        `;
    },

    // ═══════════════════════════════════════
    // BOT PERFORMANCE GRID
    // ═══════════════════════════════════════

    _renderBotGrid(bots, learningData) {
        if (bots.length === 0) {
            return '<div class="dash-card"><div class="dash-card-title">🧪 Bots</div><div class="dash-card-body"><div class="dash-empty-small">Sin bots creados</div></div></div>';
        }

        const rows = bots.map(bot => {
            const pnl = bot.stats?.totalPnl || 0;
            const trades = bot.stats?.trades || 0;
            const wr = trades > 0 ? ((bot.stats.wins / trades) * 100).toFixed(0) : '--';
            const posCount = (bot.positions || []).length;
            const isRunning = bot.status === 'running';
            const learning = learningData[bot.id] || {};
            const grade = learning.grade || '--';
            const drawdown = bot.initialBalance > 0
                ? (((bot.initialBalance - bot.currentBalance) / bot.initialBalance) * 100)
                : 0;
            const dd = drawdown > 0 ? drawdown.toFixed(1) : '0.0';
            const autoTag = bot.autoCreated ? ' 🤖' : '';

            // Streak from recent trades
            let streak = '';
            const recentTrades = (bot.trades || []).slice(-5);
            if (recentTrades.length > 0) {
                streak = recentTrades.map(t => t.pnl > 0 ? '🟢' : '🔴').join('');
            }

            // Patterns
            const patternText = learning.patterns && learning.patterns.length > 0
                ? learning.patterns.slice(0, 2).join(' · ')
                : '<span style="color:var(--dim)">Acumulando datos...</span>';

            return `
                <div class="dash-bot-row ${isRunning ? '' : 'idle'}">
                    <div class="dash-bot-name">
                        <span class="dash-bot-status-dot ${isRunning ? 'on' : 'off'}"></span>
                        ${bot.name}${autoTag}
                    </div>
                    <div class="dash-bot-symbol">${bot.symbol}</div>
                    <div class="dash-bot-grade grade-${grade.replace('+', 'plus')}">${grade}</div>
                    <div class="dash-bot-trades">${trades}</div>
                    <div class="dash-bot-wr ${parseInt(wr) >= 50 ? 'up' : 'down'}">${wr}%</div>
                    <div class="dash-bot-pnl ${pnl >= 0 ? 'up' : 'down'}">${Utils.formatPnL(pnl)}</div>
                    <div class="dash-bot-dd ${drawdown > 10 ? 'warn' : ''}">${dd}%</div>
                    <div class="dash-bot-pos">${posCount}</div>
                    <div class="dash-bot-streak">${streak}</div>
                    <div class="dash-bot-pattern">${patternText}</div>
                </div>
            `;
        }).join('');

        return `
            <div class="dash-card dash-full">
                <div class="dash-card-title">🧪 Bot Performance</div>
                <div class="dash-bot-table">
                    <div class="dash-bot-row dash-bot-header">
                        <div class="dash-bot-name">Bot</div>
                        <div class="dash-bot-symbol">Par</div>
                        <div class="dash-bot-grade">Grade</div>
                        <div class="dash-bot-trades">Trades</div>
                        <div class="dash-bot-wr">WR</div>
                        <div class="dash-bot-pnl">PnL</div>
                        <div class="dash-bot-dd">DD</div>
                        <div class="dash-bot-pos">Pos</div>
                        <div class="dash-bot-streak">Racha</div>
                        <div class="dash-bot-pattern">Patrones Aprendidos</div>
                    </div>
                    ${rows}
                </div>
            </div>
        `;
    },

    // ═══════════════════════════════════════
    // LEARNING MONITOR
    // ═══════════════════════════════════════

    _renderLearningMonitor() {
        if (typeof LearningEngine === 'undefined') return '';

        const effectiveness = LearningEngine.getEffectiveness();
        const dbStats = this._getDBStats();

        return `
            <div class="dash-card dash-full">
                <div class="dash-card-title">🧠 Learning Monitor</div>
                <div class="dash-card-body" style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px;">

                    <!-- Learning Effectiveness -->
                    <div style="padding: 10px; background: rgba(0,212,255,0.03); border-radius: 6px;">
                        <div style="font-size: 10px; color: var(--dim); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.05em;">Filter Effectiveness</div>
                        ${effectiveness ? `
                            <div style="display: flex; gap: 16px; margin-bottom: 8px;">
                                <div>
                                    <div style="font-size: 18px; font-weight: 700; color: ${effectiveness.isEffective ? 'var(--green)' : 'var(--yellow)'};">
                                        ${effectiveness.isEffective ? '✅ Effective' : '⚠️ Neutral'}
                                    </div>
                                    <div style="font-size: 9px; color: var(--dim);">${effectiveness.totalEvaluated} trades evaluated</div>
                                </div>
                            </div>
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 10px;">
                                <div>
                                    <span style="color: var(--dim);">Blocked:</span>
                                    <span style="font-weight: 600;">${effectiveness.blocked}</span>
                                    <span style="color: ${parseInt(effectiveness.blockedAccuracy) > 50 ? 'var(--green)' : 'var(--red)'};">(${effectiveness.blockedAccuracy} accurate)</span>
                                </div>
                                <div>
                                    <span style="color: var(--dim);">Allowed:</span>
                                    <span style="font-weight: 600;">${effectiveness.allowed}</span>
                                    <span style="color: ${parseInt(effectiveness.allowedWinRate) > 50 ? 'var(--green)' : 'var(--red)'};">(${effectiveness.allowedWinRate} WR)</span>
                                </div>
                            </div>
                            <div style="font-size: 9px; color: var(--text-secondary); margin-top: 6px; padding-top: 6px; border-top: 1px solid var(--border);">
                                ${effectiveness.interpretation}
                            </div>
                        ` : `
                            <div style="font-size: 11px; color: var(--dim);">Collecting data... (need 20+ evaluations)</div>
                        `}
                    </div>

                    <!-- Database Stats -->
                    <div style="padding: 10px; background: rgba(0,212,255,0.03); border-radius: 6px;">
                        <div style="font-size: 10px; color: var(--dim); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.05em;">TradeDB Stats</div>
                        ${dbStats ? `
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; font-size: 10px;">
                                <div><span style="color: var(--dim);">Total trades:</span> <strong>${dbStats.totalTrades}</strong></div>
                                <div><span style="color: var(--dim);">Last 30 days:</span> <strong>${dbStats.last30DaysTrades}</strong></div>
                                <div><span style="color: var(--dim);">Unique bots:</span> <strong>${dbStats.uniqueBots}</strong></div>
                                <div><span style="color: var(--dim);">Symbols traded:</span> <strong>${dbStats.uniqueSymbols}</strong></div>
                            </div>
                            ${dbStats.oldestTrade ? `
                                <div style="font-size: 9px; color: var(--dim); margin-top: 6px;">
                                    Data range: ${new Date(dbStats.oldestTrade).toLocaleDateString()} — ${new Date(dbStats.newestTrade).toLocaleDateString()}
                                </div>
                            ` : ''}
                        ` : `
                            <div style="font-size: 11px; color: var(--dim);">IndexedDB initializing...</div>
                        `}
                    </div>

                    <!-- Statistical Config -->
                    <div style="padding: 10px; background: rgba(0,212,255,0.03); border-radius: 6px;">
                        <div style="font-size: 10px; color: var(--dim); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.05em;">Learning Config</div>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; font-size: 10px;">
                            <div><span style="color: var(--dim);">Min trades:</span> <strong>${LearningEngine._MIN_TRADES || 10}</strong></div>
                            <div><span style="color: var(--dim);">Significance:</span> <strong>${LearningEngine._MIN_SIGNIFICANT || 25}</strong></div>
                            <div><span style="color: var(--dim);">Decay half-life:</span> <strong>${LearningEngine._HALF_LIFE_DAYS || 30}d</strong></div>
                            <div><span style="color: var(--dim);">Retrain every:</span> <strong>${LearningEngine._RETRAIN_INTERVAL || 50}</strong></div>
                            <div><span style="color: var(--dim);">CV folds:</span> <strong>${LearningEngine._CV_FOLDS || 3}</strong></div>
                            <div><span style="color: var(--dim);">p-value:</span> <strong>${(LearningEngine._SIGNIFICANCE_LEVEL || 0.05) * 100}%</strong></div>
                        </div>
                    </div>

                </div>
            </div>
        `;
    },

    _getDBStats() {
        // Sync version - actual async call would need different handling
        if (typeof TradeDB === 'undefined' || !TradeDB._ready) return null;

        // Cache the stats to avoid frequent async calls
        if (this._dbStatsCache && Date.now() - this._dbStatsCacheTime < 30000) {
            return this._dbStatsCache;
        }

        // Trigger async update
        TradeDB.getDBStats().then(stats => {
            this._dbStatsCache = stats;
            this._dbStatsCacheTime = Date.now();
        }).catch(() => {});

        return this._dbStatsCache || null;
    },

    // ═══════════════════════════════════════
    // RECENT ACTIVITY
    // ═══════════════════════════════════════

    _renderRecentActivity() {
        if (typeof EventFeed === 'undefined') return '';

        const events = (EventFeed._events || []).slice(0, 15);
        if (events.length === 0) return '';

        const items = events.map(e => {
            const time = new Date(e.timestamp).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            return `<div class="dash-event dash-event-${e.type}"><span class="dash-event-time">${time}</span><span class="dash-event-icon">${e.icon}</span><span class="dash-event-msg">${e.message}</span></div>`;
        }).join('');

        return `
            <div class="dash-card dash-full">
                <div class="dash-card-title">📋 Actividad Reciente</div>
                <div class="dash-events">${items}</div>
            </div>
        `;
    },

    // ═══════════════════════════════════════
    // DATA HELPERS
    // ═══════════════════════════════════════

    _calcGlobals(bots) {
        let totalPnl = 0, totalTrades = 0, totalWins = 0, totalBalance = 0;
        for (const b of bots) {
            totalPnl += b.stats?.totalPnl || 0;
            totalTrades += b.stats?.trades || 0;
            totalWins += b.stats?.wins || 0;
            totalBalance += b.currentBalance || 0;
        }
        return {
            totalPnl, totalTrades, totalWins, totalBalance,
            wr: totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(0) : '0'
        };
    },

    _getRiskData(bots) {
        const rm = typeof RiskManager !== 'undefined' ? RiskManager : null;
        const openPositions = bots.reduce((s, b) => s + (b.positions || []).length, 0);

        // Calculate daily loss
        const today = new Date().toISOString().slice(0, 10);
        let dailyPnl = 0;
        let totalInitial = 0;
        let maxDD = 0;

        // FIX: Contar bots en cooldown desde RiskManager._cooldowns
        let cooldowns = 0;
        if (rm && rm._cooldowns) {
            const now = Date.now();
            for (const botId in rm._cooldowns) {
                if (rm._cooldowns[botId] > now) {
                    cooldowns++;
                }
            }
        }

        for (const b of bots) {
            const todayTrades = (b.trades || []).filter(t => t.closedAt && t.closedAt.startsWith(today));
            dailyPnl += todayTrades.reduce((s, t) => s + (t.pnl || 0), 0);
            totalInitial += b.initialBalance || b.initialWallet || 100;

            const ib = b.initialBalance || b.initialWallet || 100;
            const dd = ((ib - b.currentBalance) / ib) * 100;
            if (dd > maxDD) maxDD = dd;
        }

        const dailyLossPct = totalInitial > 0 && dailyPnl < 0 ? Math.abs(dailyPnl) / totalInitial * 100 : 0;

        return {
            paused: rm ? rm._paused : false,
            dailyLossPct,
            maxDailyLoss: rm ? rm._config.maxDailyLossPct : 5,
            maxDrawdown: maxDD > 0 ? maxDD : 0,
            maxDrawdownLimit: rm ? rm._config.maxDrawdownPct : 15,
            openPositions,
            maxPositions: rm ? rm._config.maxOpenPositions : 3,
            maxSameSymbol: rm ? rm._config.maxSameSymbol : 2,
            botsInCooldown: cooldowns,
        };
    },

    _getAutonomyData() {
        if (typeof Autonomy === 'undefined') {
            return { level: 0, levelName: 'No cargado', autoBots: 0, maxAutoBots: 0, stats: { totalTrades: 0, winRate: 0, totalPnl: 0 }, suggestions: [], history: [] };
        }
        const status = Autonomy.getStatus();
        return {
            level: status.level,
            levelName: status.levelName,
            autoBots: status.autoBots,
            maxAutoBots: status.config.maxAutoBots,
            autoWallet: status.config.autoWallet,
            autoMode: status.config.autoMode,
            autoTemp: status.config.autoTemp,
            stats: status.stats,
            suggestions: (Autonomy.state?.suggestions || []).filter(s => s.status === 'pending'),
            history: status.history || [],
        };
    },

    _getLearningData(bots) {
        const data = {};
        if (typeof LearningEngine === 'undefined') return data;

        for (const bot of bots) {
            try {
                const report = LearningEngine.getReport(bot);
                const trades = bot.trades || [];
                let grade = '--';

                if (trades.length >= 10) {
                    const wr = trades.filter(t => t.pnl > 0).length / trades.length * 100;
                    const pnl = bot.stats?.totalPnl || 0;
                    if (wr >= 65 && pnl > 0) grade = 'A';
                    else if (wr >= 55 && pnl >= 0) grade = 'B';
                    else if (wr >= 45) grade = 'C';
                    else if (wr >= 35) grade = 'D';
                    else grade = 'F';
                } else if (trades.length >= 5) {
                    grade = '?';
                }

                // FIX: Include fitness score from Autonomy
                let fitness = null;
                if (typeof Autonomy !== 'undefined') {
                    fitness = Autonomy._calculateFitnessScore(bot);
                }

                data[bot.id] = {
                    grade,
                    patterns: report.hasData ? report.patterns : [],
                    optimalConf: report.optimalConfidence || null,
                    // NEW: enriched data
                    fitness: fitness ? fitness.score : null,
                    fitnessComponents: fitness ? fitness.components : null,
                    regimeStats: report.regimeStats || {},
                    thesisAccuracy: report.thesisAccuracy || null,
                    effectiveness: report.effectiveness || null,
                };
            } catch (e) {
                data[bot.id] = { grade: '--', patterns: [], optimalConf: null, fitness: null };
            }
        }
        return data;
    }
};
