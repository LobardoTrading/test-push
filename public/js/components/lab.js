/* ========================================
   LAB — Autonomous Bots + Live Radar
   TheRealShortShady v4.0
   ======================================== */

const Lab = {

    _intervals: {},
    _scanInterval: null,
    _scanRunning: false,
    _opportunities: [],
    _scanCycle: 0,
    _STORAGE_KEY: 'tp_lab_bots',
    _showArchived: false,

    /** Normaliza cualquier formato de señal a green/red/yellow/neutral */
    _normalizeSignal(signal) {
        if (!signal) return 'neutral';
        const s = String(signal).toLowerCase().trim();
        if (['green', 'go', 'bullish', 'lean_bull', 'enter'].includes(s)) return 'green';
        if (['red', 'stop', 'bearish', 'lean_bear'].includes(s)) return 'red';
        if (['yellow', 'wait', 'neutral', 'caution'].includes(s)) return 'yellow';
        return 'neutral';
    },

    TEMPERATURES: {
        conservative: { label: '🧊 Conservador', minConfidence: 80, risk: 1, botAlignment: 0.85, color: '#5ebbff' },
        normal:       { label: '⚡ Normal',       minConfidence: 65, risk: 2, botAlignment: 0.70, color: '#00d4ff' },
        aggressive:   { label: '🔥 Agresivo',     minConfidence: 50, risk: 3, botAlignment: 0.50, color: '#ff6b6b' }
    },

    init() {
        console.log('🧪 Lab.init() — starting');
        const bots = this._getBots();
        bots.filter(b => b.status === 'running').forEach(bot => {
            console.log(`🧪 Restarting bot: ${bot.name}`);
            this._startBotInterval(bot.id);
        });
        if (typeof Header !== 'undefined' && Header.updateLabCount) {
            Header.updateLabCount();
        }
        this._startRadar();

        // FIX: Suscribirse a precios para actualizar PnL de bots en tiempo real
        this._pnlUpdatePending = false;
        State.subscribe('prices', () => {
            // Throttle: solo re-render si Lab está abierto y hay bots con posiciones
            if (this._pnlUpdatePending) return;
            const hasOpenPos = this._getBots().some(b => b.status === 'running' && (b.positions || []).length > 0);
            if (!hasOpenPos) return;
            this._pnlUpdatePending = true;
            requestAnimationFrame(() => {
                this._renderIfOpen();
                this._pnlUpdatePending = false;
            });
        });
    },

    // === RADAR — CONTINUOUS SCANNER ===

    _startRadar() {
        console.log('🎯 Radar starting...');
        if (this._scanInterval) clearInterval(this._scanInterval);
        setTimeout(() => this._radarScan(), 15000); // Dar tiempo a que carguen datos
        this._scanInterval = setInterval(() => this._radarScan(), 90000); // 90s entre scans
    },

    async _radarScan() {
        if (this._scanRunning) return;
        this._scanRunning = true;
        this._scanCycle++;

        const statusEl = document.getElementById('radarStatus');
        const symbols = Object.keys(CONFIG.TOKENS);
        const results = [];

        // Process in small batches to keep UI responsive
        const BATCH_SIZE = 3;
        for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
            const batch = symbols.slice(i, i + BATCH_SIZE);
            if (statusEl) statusEl.innerHTML = `<span class="radar-scanning">⏳ ${Math.min(i + BATCH_SIZE, symbols.length)}/${symbols.length}</span>`;

            // Run batch in parallel (max 3 concurrent)
            const batchPromises = batch.map(async (symbol) => {
                try {
                    const modeConfig = State.getModeConfig();
                    const result = await SignalPipeline.analyze(symbol, {
                        leverage: modeConfig.lev,
                        timeframe: modeConfig.tf
                    });

                    if (result) {
                        const conf = result.confidence || 0;
                        const decision = result.decision || 'WAIT';
                        let signal;
                        if (decision === 'ENTER' && conf >= 75) signal = 'strong';
                        else if (decision === 'ENTER' && conf >= 55) signal = 'moderate';
                        else signal = 'weak';

                        const greenBots = result._pipeline?.greenBots || (result.bots || []).filter(b =>
                            SignalPipeline.normalize(b.signal) === 'green'
                        ).length;

                        return {
                            symbol,
                            direction: result.direction || '--',
                            decision,
                            confidence: conf,
                            signal,
                            rr: result.rr_ratio || '?',
                            tp: result.tp || 0,
                            sl: result.sl || 0,
                            price: result.price || State.prices[symbol]?.price || 0,
                            reason: result.reason || result.summary || '',
                            greenBots,
                            totalBots: (result.bots || []).length,
                            scannedAt: new Date().toISOString()
                        };
                    }
                } catch (e) {
                    console.error(`Radar scan ${symbol}:`, e);
                }
                return null;
            });

            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults.filter(Boolean));

            // Yield to UI thread between batches
            await new Promise(r => setTimeout(r, 800));
        }

        const order = { strong: 0, moderate: 1, weak: 2 };
        results.sort((a, b) => {
            if (order[a.signal] !== order[b.signal]) return order[a.signal] - order[b.signal];
            return b.confidence - a.confidence;
        });

        this._opportunities = results;
        this._scanRunning = false;

        const now = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        if (statusEl) statusEl.innerHTML = `✅ ${now} <span style="color:var(--dim)">(#${this._scanCycle})</span>`;

        this._renderRadar();
        this._updateHeaderBadge();
    },

    _renderRadar() {
        const list = document.getElementById('radarList');
        const summary = document.getElementById('radarSummary');
        if (!list) return;

        const ops = this._opportunities;

        if (!ops || ops.length === 0) {
            list.innerHTML = '<div class="radar-loading">⏳ Escaneando mercado...</div>';
            return;
        }

        const strong = ops.filter(o => o.signal === 'strong');
        const moderate = ops.filter(o => o.signal === 'moderate');
        const weak = ops.filter(o => o.signal === 'weak');

        if (summary) {
            summary.innerHTML = `
                <span class="radar-count green">🟢 ${strong.length}</span>
                <span class="radar-count yellow">🟡 ${moderate.length}</span>
                <span class="radar-count red">🔴 ${weak.length}</span>
            `;
        }

        list.innerHTML = ops.map(op => {
            const sigColor = op.signal === 'strong' ? '#10b981' : op.signal === 'moderate' ? '#00d4ff' : '#f43f5e';
            const sigIcon = op.signal === 'strong' ? '🟢' : op.signal === 'moderate' ? '🟡' : '🔴';
            const dirIcon = op.direction === 'LONG' ? '▲' : op.direction === 'SHORT' ? '▼' : '—';
            const dirColor = op.direction === 'LONG' ? 'var(--green)' : op.direction === 'SHORT' ? 'var(--red)' : 'var(--dim)';
            const isEntry = op.decision === 'ENTER';

            return `
                <div class="radar-item signal-${op.signal}" onclick="Lab.radarClick('${op.symbol}')">
                    <div class="radar-item-light" style="background:${sigColor}"></div>
                    <div class="radar-item-body">
                        <div class="radar-item-top">
                            <span class="radar-item-symbol">${op.symbol}</span>
                            <span class="radar-item-dir" style="color:${dirColor}">${dirIcon} ${isEntry ? op.direction : 'WAIT'}</span>
                            <span class="radar-item-conf" style="color:${sigColor}">${op.confidence}%</span>
                            <span class="radar-item-signal">${sigIcon}</span>
                        </div>
                        ${isEntry ? `
                            <div class="radar-item-bottom">
                                R:R ${op.rr} · Bots ${op.greenBots}/${op.totalBots} · $${Utils.formatPrice(op.price)}
                            </div>
                        ` : `
                            <div class="radar-item-bottom">${op.reason ? op.reason.substring(0, 60) : 'Sin señal'}</div>
                        `}
                    </div>
                    ${isEntry ? `<div class="radar-item-arrow">→</div>` : ''}
                </div>
            `;
        }).join('');
    },

    radarClick(symbol) {
        State.set('symbol', symbol);
        if (typeof Trading !== 'undefined' && Trading.analyze) {
            Trading.analyze();
        }
    },

    _updateHeaderBadge() {
        const el = document.getElementById('labBtnCount');
        if (!el) return;
        const strong = this._opportunities.filter(o => o.signal === 'strong').length;
        const moderate = this._opportunities.filter(o => o.signal === 'moderate').length;

        if (strong > 0) {
            el.textContent = `${strong}🟢`;
            el.style.display = 'inline';
            el.style.background = '#10b981';
        } else if (moderate > 0) {
            el.textContent = `${moderate}🟡`;
            el.style.display = 'inline';
            el.style.background = '#00d4ff';
        } else {
            const bots = this._getBots();
            const running = bots.filter(b => b.status === 'running').length;
            el.textContent = running > 0 ? running : '';
            el.style.display = running > 0 ? 'inline' : 'none';
            el.style.background = '#10b981';
        }

        const radarTab = document.querySelector('[data-tab="radar"]');
        if (radarTab) {
            if (strong > 0) {
                radarTab.classList.add('radar-has-signal');
                radarTab.textContent = `🎯 Radar (${strong}🟢)`;
            } else if (moderate > 0) {
                radarTab.classList.remove('radar-has-signal');
                radarTab.textContent = `🎯 Radar (${moderate}🟡)`;
            } else {
                radarTab.classList.remove('radar-has-signal');
                radarTab.textContent = '🎯 Radar';
            }
        }
    },

    // === STORAGE ===

    _getBots() {
        try { return JSON.parse(localStorage.getItem(this._STORAGE_KEY) || '[]'); }
        catch (e) { return []; }
    },

    _saveBots(bots) {
        try { localStorage.setItem(this._STORAGE_KEY, JSON.stringify(bots)); }
        catch (e) { console.error('Error saving bots:', e); }
    },

    _getBot(id) { return this._getBots().find(b => b.id === id); },

    _updateBot(id, updates) {
        const bots = this._getBots();
        const idx = bots.findIndex(b => b.id === id);
        if (idx === -1) return null;
        Object.assign(bots[idx], updates);
        this._saveBots(bots);
        return bots[idx];
    },

    // === LAB UI ===

    open() {
        const overlay = document.getElementById('labOverlay');
        if (overlay) { overlay.classList.add('active'); this.render(); }
    },

    close() {
        const overlay = document.getElementById('labOverlay');
        if (overlay) overlay.classList.remove('active');
    },

    // === EXPORT / IMPORT ===

    exportData() {
        const data = {
            bots: JSON.parse(localStorage.getItem('tp_lab_bots') || '[]'),
            autonomy: JSON.parse(localStorage.getItem('tp_autonomy') || '{}'),
            riskConfig: JSON.parse(localStorage.getItem('tp_risk_config') || '{}'),
            smartHistory: JSON.parse(localStorage.getItem('tp_smart_history') || '{}'),
            eventLog: JSON.parse(localStorage.getItem('tp_event_log') || '[]'),
            exportedAt: new Date().toISOString(),
            version: '4.3'
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `bots_export_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
        Utils.showNotification('📥 Datos exportados', 'success', 3000);
    },

    importData() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                try {
                    const data = JSON.parse(ev.target.result);
                    if (!data.bots || !Array.isArray(data.bots)) {
                        Utils.showNotification('❌ Archivo inválido — no contiene bots', 'error');
                        return;
                    }

                    // Stop all running bots before importing
                    const current = this._getBots();
                    current.forEach(b => { if (b.status === 'running') this.stopBot(b.id); });

                    // Import
                    localStorage.setItem('tp_lab_bots', JSON.stringify(data.bots));
                    if (data.autonomy) localStorage.setItem('tp_autonomy', JSON.stringify(data.autonomy));
                    if (data.riskConfig) localStorage.setItem('tp_risk_config', JSON.stringify(data.riskConfig));
                    if (data.smartHistory) localStorage.setItem('tp_smart_history', JSON.stringify(data.smartHistory));
                    if (data.eventLog) localStorage.setItem('tp_event_log', JSON.stringify(data.eventLog));

                    // Restart
                    const imported = data.bots;
                    imported.filter(b => b.status === 'running').forEach(b => this._startBotInterval(b.id));
                    this.render();

                    Utils.showNotification(`📤 ${imported.length} bots importados (${data.exportedAt || '?'})`, 'success', 5000);
                } catch (err) {
                    Utils.showNotification(`❌ Error: ${err.message}`, 'error');
                }
            };
            reader.readAsText(file);
        };
        input.click();
    },

    render() {
        const grid = document.getElementById('labBotsGrid');
        const statsEl = document.getElementById('labGlobalStats');
        if (!grid) return;

        const allBots = this._getBots();
        const activeBots = allBots.filter(b => b.status !== 'archived');
        const archivedBots = allBots.filter(b => b.status === 'archived');
        const displayBots = this._showArchived ? archivedBots : activeBots;

        if (statsEl) {
            const totalPnl = activeBots.reduce((s, b) => s + (b.stats?.totalPnl || 0), 0);
            const totalTrades = activeBots.reduce((s, b) => s + (b.stats?.trades || 0), 0);
            const running = activeBots.filter(b => b.status === 'running').length;
            const archiveBtn = archivedBots.length > 0
                ? `<button class="lab-archive-toggle ${this._showArchived ? 'active' : ''}" onclick="Lab.toggleArchived()" title="${this._showArchived ? 'Ver activos' : 'Ver archivados'}">📦 ${archivedBots.length}</button>`
                : '';
            statsEl.innerHTML = `
                <span>Bots: <b>${activeBots.length}</b></span>
                <span>Corriendo: <b style="color:var(--green)">${running}</b></span>
                <span>Trades: <b>${totalTrades}</b></span>
                <span>PnL: <b style="color:${totalPnl >= 0 ? 'var(--green)' : 'var(--red)'}">${Utils.formatPnL(totalPnl)}</b></span>
                ${archiveBtn}
                <button class="lab-io-btn" onclick="Lab.exportData()" title="Exportar datos">📥 Export</button>
                <button class="lab-io-btn" onclick="Lab.importData()" title="Importar datos">📤 Import</button>
            `;
        }

        if (displayBots.length === 0) {
            grid.innerHTML = `
                <div class="lab-empty">
                    <div style="font-size:48px; margin-bottom:12px;">${this._showArchived ? '📦' : '🧪'}</div>
                    <div style="font-size:14px; font-weight:600; margin-bottom:6px;">${this._showArchived ? 'Sin bots archivados' : 'Sin bots creados'}</div>
                    <div style="font-size:11px; color:var(--dim);">${this._showArchived ? 'Los bots archivados aparecen acá' : 'Creá tu primer bot autónomo'}</div>
                </div>
            `;
            return;
        }

        grid.innerHTML = displayBots.map(bot => this._renderBotCard(bot)).join('');

        // Draw equity sparklines after DOM is ready
        requestAnimationFrame(() => {
            displayBots.forEach(bot => this._drawSparkline(bot));
        });

        // Update Autonomy UI, MasterBots and Learning Stats
        this._updateAutonomyUI();
        this._renderMasterBots();
        this._renderLearningStats();
    },

    toggleArchived() {
        this._showArchived = !this._showArchived;
        this.render();
    },

    /** Draw mini equity curve on bot card canvas */
    _drawSparkline(bot) {
        const canvas = document.getElementById(`spark_${bot.id}`);
        if (!canvas) return;
        const trades = bot.trades || [];
        if (trades.length < 2) return;

        const ctx = canvas.getContext('2d');
        const W = canvas.width;
        const H = canvas.height;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = W * dpr;
        canvas.height = H * dpr;
        canvas.style.width = W + 'px';
        canvas.style.height = H + 'px';
        ctx.scale(dpr, dpr);

        // Build cumulative PnL series
        const points = [0]; // Start at 0
        let cumPnl = 0;
        for (const t of trades) {
            cumPnl += t.pnl || 0;
            points.push(cumPnl);
        }

        const minY = Math.min(...points);
        const maxY = Math.max(...points);
        const range = maxY - minY || 1;
        const pad = 3;

        // Map to canvas coordinates
        const toX = (i) => pad + (i / (points.length - 1)) * (W - pad * 2);
        const toY = (v) => H - pad - ((v - minY) / range) * (H - pad * 2);

        // Zero line
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        const zeroY = toY(0);
        ctx.moveTo(pad, zeroY);
        ctx.lineTo(W - pad, zeroY);
        ctx.stroke();

        // Gradient fill
        const lastVal = points[points.length - 1];
        const color = lastVal >= 0 ? '#10b981' : '#f43f5e';
        const gradient = ctx.createLinearGradient(0, 0, 0, H);
        gradient.addColorStop(0, lastVal >= 0 ? 'rgba(16,185,129,0.20)' : 'rgba(244,63,94,0.20)');
        gradient.addColorStop(1, 'rgba(0,0,0,0)');

        // Draw filled area
        ctx.beginPath();
        ctx.moveTo(toX(0), toY(points[0]));
        for (let i = 1; i < points.length; i++) {
            ctx.lineTo(toX(i), toY(points[i]));
        }
        ctx.lineTo(toX(points.length - 1), H);
        ctx.lineTo(toX(0), H);
        ctx.closePath();
        ctx.fillStyle = gradient;
        ctx.fill();

        // Draw line
        ctx.beginPath();
        ctx.moveTo(toX(0), toY(points[0]));
        for (let i = 1; i < points.length; i++) {
            ctx.lineTo(toX(i), toY(points[i]));
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.lineJoin = 'round';
        ctx.stroke();

        // Win/loss dots
        for (let i = 1; i < points.length; i++) {
            const isWin = (trades[i - 1]?.pnl || 0) > 0;
            ctx.beginPath();
            ctx.arc(toX(i), toY(points[i]), 2, 0, Math.PI * 2);
            ctx.fillStyle = isWin ? '#10b981' : '#f43f5e';
            ctx.fill();
        }

        // End value label
        ctx.font = '9px DM Sans, sans-serif';
        ctx.fillStyle = color;
        ctx.textAlign = 'right';
        ctx.fillText(`${lastVal >= 0 ? '+' : ''}${lastVal.toFixed(2)}`, W - 2, 10);
    },

    _renderBotCard(bot) {
        const temp = this.TEMPERATURES[bot.temperature] || this.TEMPERATURES.normal;
        const isRunning = bot.status === 'running';
        const pnl = bot.stats?.totalPnl || 0;
        const wr = bot.stats?.trades > 0 ? ((bot.stats.wins / bot.stats.trades) * 100).toFixed(0) : '--';
        const walletPct = bot.initialWallet > 0 ? (((bot.currentBalance - bot.initialWallet) / bot.initialWallet) * 100).toFixed(1) : '0';
        const posCount = (bot.positions || []).length;
        const knowledgeCount = (bot.knowledge || []).length;

        const autoTag = bot.autoCreated ? ' <span style="font-size:10px;opacity:0.6" title="Creado por Autonomía">🤖</span>' : '';

        return `
            <div class="lab-bot-card ${isRunning ? 'running' : ''} ${bot.status === 'archived' ? 'archived' : ''}" data-id="${bot.id}">
                <div class="lab-bot-header">
                    <div class="lab-bot-name">${bot.name}${autoTag}</div>
                    <div class="lab-bot-status ${bot.status}">${isRunning ? '● Corriendo' : bot.status === 'archived' ? '📦 Archivado' : '○ Detenido'}</div>
                </div>
                <div class="lab-bot-info">
                    <span class="lab-bot-symbol">${bot.symbol}USDT</span>
                    <span class="lab-bot-temp" style="color:${temp.color}">${temp.label}</span>
                    <span class="lab-bot-mode">${bot.mode}</span>
                </div>
                <div class="lab-bot-wallet">
                    <div class="lab-bot-wallet-row"><span>Wallet</span><span style="font-weight:700">${Utils.formatCurrency(bot.currentBalance)}</span></div>
                    <div class="lab-bot-wallet-row"><span>Inicial</span><span>${Utils.formatCurrency(bot.initialWallet)}</span></div>
                    <div class="lab-bot-wallet-row"><span>Rendimiento</span><span style="color:${parseFloat(walletPct) >= 0 ? 'var(--green)' : 'var(--red)'}; font-weight:700">${walletPct}%</span></div>
                </div>
                <div class="lab-bot-stats-grid">
                    <div class="lab-bot-stat"><div class="lab-bot-stat-val">${bot.stats?.trades || 0}</div><div class="lab-bot-stat-label">Trades</div></div>
                    <div class="lab-bot-stat"><div class="lab-bot-stat-val" style="color:${parseInt(wr) >= 50 ? 'var(--green)' : 'var(--red)'}">${wr}%</div><div class="lab-bot-stat-label">Win Rate</div></div>
                    <div class="lab-bot-stat"><div class="lab-bot-stat-val" style="color:${pnl >= 0 ? 'var(--green)' : 'var(--red)'}">${Utils.formatPnL(pnl)}</div><div class="lab-bot-stat-label">PnL</div></div>
                    <div class="lab-bot-stat"><div class="lab-bot-stat-val">${posCount}</div><div class="lab-bot-stat-label">Abiertas</div></div>
                </div>
                ${(bot.trades || []).length >= 2 ? `
                    <div class="lab-bot-sparkline">
                        <canvas id="spark_${bot.id}" width="280" height="40"></canvas>
                    </div>
                ` : ''}
                ${posCount > 0 ? `
                    <div class="lab-bot-positions">
                        ${(bot.positions || []).map(p => {
                            const price = State.prices[p.symbol]?.price || p.entry;
                            const exitFee = p.fee;
                            const bpnl = p.direction === 'LONG'
                                ? ((price - p.entry) / p.entry) * p.size - exitFee
                                : ((p.entry - price) / p.entry) * p.size - exitFee;
                            const bpnlPct = p.margin > 0 ? ((bpnl / p.margin) * 100).toFixed(1) : '0.0';
                            const elapsed = Date.now() - new Date(p.timestamp).getTime();
                            const elapsedStr = elapsed < 60000 ? '<1m'
                                : elapsed < 3600000 ? Math.floor(elapsed/60000) + 'm'
                                : Math.floor(elapsed/3600000) + 'h' + Math.floor((elapsed%3600000)/60000) + 'm';
                            const tpDist = p.tp ? (p.direction === 'LONG'
                                ? ((p.tp - price) / price * 100).toFixed(1)
                                : ((price - p.tp) / price * 100).toFixed(1)) : '?';
                            const slDist = p.sl ? (p.direction === 'LONG'
                                ? ((price - p.sl) / price * 100).toFixed(1)
                                : ((p.sl - price) / price * 100).toFixed(1)) : '?';
                            return `<div class="lab-bot-pos-expanded">
                                <div class="lab-pos-main" style="color:${bpnl >= 0 ? 'var(--green)' : 'var(--red)'}">
                                    ${p.direction === 'LONG' ? '▲' : '▼'} ${p.symbol} <b>${Utils.formatPnL(bpnl)}</b> (${bpnlPct}%)
                                </div>
                                <div class="lab-pos-details">
                                    <span>Entry $${Utils.formatPrice(p.entry)}</span>
                                    <span>Lev ${p.leverage}x</span>
                                    <span>Conf ${p.confidence}%</span>
                                    <span>⏱ ${elapsedStr}</span>
                                </div>
                                <div class="lab-pos-details">
                                    <span style="color:var(--green)">TP ${tpDist}%</span>
                                    <span style="color:var(--red)">SL ${slDist}%</span>
                                    <span>Margen $${p.margin?.toFixed(1) || '?'}</span>
                                    ${p.regime ? `<span style="opacity:0.6">${p.regime}</span>` : ''}
                                </div>
                            </div>`;
                        }).join('')}
                    </div>
                ` : ''}
                <div class="lab-bot-meta">
                    <span>Checks: ${bot.checksRun || 0}</span>
                    <span>${bot.lastCheck ? new Date(bot.lastCheck).toLocaleTimeString('es-AR', {hour:'2-digit',minute:'2-digit'}) : '--'}</span>
                </div>
                <div class="lab-bot-actions">
                    ${bot.status === 'archived' ? `
                        <button class="lab-btn lab-btn-start" onclick="Lab.restoreBot('${bot.id}')">↩ Restaurar</button>
                        <button class="lab-btn lab-btn-delete" onclick="Lab.confirmDelete('${bot.id}')" title="Eliminar permanentemente">🗑</button>
                    ` : `
                        ${isRunning
                            ? `<button class="lab-btn lab-btn-stop" onclick="Lab.stopBot('${bot.id}')">⏹ Detener</button>`
                            : `<button class="lab-btn lab-btn-start" onclick="Lab.startBot('${bot.id}')">▶ Iniciar</button>`
                        }
                        <button class="lab-btn lab-btn-knowledge" onclick="Lab.showKnowledge('${bot.id}')">📚 ${knowledgeCount}</button>
                        <button class="lab-btn lab-btn-archive" onclick="Lab.archiveBot('${bot.id}')" title="Archivar bot">📦</button>
                        <button class="lab-btn lab-btn-delete" onclick="Lab.confirmDelete('${bot.id}')" title="Eliminar bot">🗑</button>
                    `}
                </div>
            </div>
        `;
    },

    // === CREATE BOT ===

    showCreateModal() {
        const existing = document.getElementById('labCreateModal');
        if (existing) existing.remove();

        const symbols = Object.keys(CONFIG.TOKENS);
        const modal = document.createElement('div');
        modal.id = 'labCreateModal';
        modal.className = 'modal-overlay active';
        modal.innerHTML = `
            <div class="modal" style="width:420px">
                <div class="modal-header">
                    <h3>🧪 Nuevo Bot</h3>
                    <button class="modal-close" onclick="document.getElementById('labCreateModal').remove()">✕</button>
                </div>
                <div class="modal-body">
                    <div class="setting-group">
                        <label class="setting-label">Nombre</label>
                        <input type="text" id="labBotName" class="setting-input" placeholder="ej: BTC Scalper" maxlength="20">
                    </div>
                    <div class="setting-group">
                        <label class="setting-label">Par</label>
                        <select id="labBotSymbol" class="setting-input">
                            ${symbols.map(s => `<option value="${s}">${s}USDT</option>`).join('')}
                        </select>
                    </div>
                    <div class="setting-group">
                        <label class="setting-label">Wallet Inicial (USDT)</label>
                        <input type="number" id="labBotWallet" class="setting-input" value="100" min="10" max="100000" step="10">
                    </div>
                    <div class="setting-group">
                        <label class="setting-label">Modo</label>
                        <select id="labBotMode" class="setting-input">
                            ${Object.entries(CONFIG.MODES).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('')}
                        </select>
                    </div>
                    <div class="setting-group">
                        <label class="setting-label">Temperatura</label>
                        <div class="lab-temp-selector">
                            <button class="lab-temp-btn" data-temp="conservative" style="border-color:#5ebbff">🧊 Conservador<br><small>Conf ≥80%</small></button>
                            <button class="lab-temp-btn active" data-temp="normal" style="border-color:#00d4ff">⚡ Normal<br><small>Conf ≥65%</small></button>
                            <button class="lab-temp-btn" data-temp="aggressive" style="border-color:#ff6b6b">🔥 Agresivo<br><small>Conf ≥50%</small></button>
                        </div>
                    </div>
                    <div class="setting-actions">
                        <button class="btn btn-analyze" onclick="Lab.createBot()">Crear Bot</button>
                        <button class="btn btn-short" onclick="document.getElementById('labCreateModal').remove()" style="flex:none; width:auto; padding:11px 20px;">Cancelar</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.querySelectorAll('.lab-temp-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                modal.querySelectorAll('.lab-temp-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });
    },

    createBot() {
        const name = document.getElementById('labBotName')?.value.trim() || 'Bot sin nombre';
        const symbol = document.getElementById('labBotSymbol')?.value || 'BTC';
        const wallet = parseFloat(document.getElementById('labBotWallet')?.value) || 100;
        const mode = document.getElementById('labBotMode')?.value || 'intraday';
        const tempBtn = document.querySelector('#labCreateModal .lab-temp-btn.active');
        const temperature = tempBtn ? tempBtn.dataset.temp : 'normal';

        if (wallet < 10 || wallet > 100000) { Utils.showNotification('Wallet: $10 — $100,000', 'warning'); return; }

        const bots = this._getBots();
        if (bots.length >= 10) { Utils.showNotification('Máximo 10 bots', 'warning'); return; }

        const bot = {
            id: 'bot_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4),
            name, symbol, mode, temperature,
            initialWallet: wallet, initialBalance: wallet, currentBalance: wallet,
            status: 'idle', positions: [], trades: [], knowledge: [],
            stats: { trades: 0, wins: 0, losses: 0, totalPnl: 0 },
            checksRun: 0, lastCheck: null, createdAt: new Date().toISOString()
        };

        bots.push(bot);
        this._saveBots(bots);
        document.getElementById('labCreateModal')?.remove();
        this.render();
        Utils.showNotification(`🧪 Bot "${name}" creado`, 'success');
    },

    // === BOT CONTROL ===

    startBot(id) {
        const bot = this._updateBot(id, { status: 'running', checksRun: 0 });
        if (!bot) return;
        this._startBotInterval(id);
        this.render();
        Header.updateLabCount();
        Utils.showNotification(`▶ Bot "${bot.name}" iniciado`, 'success');
    },

    stopBot(id) {
        const bot = this._updateBot(id, { status: 'idle' });
        if (this._intervals[id]) { clearInterval(this._intervals[id]); delete this._intervals[id]; }
        this.render();
        Header.updateLabCount();
        if (bot) Utils.showNotification(`⏹ Bot "${bot.name}" detenido`, 'warning');
    },

    deleteBot(id) {
        const bot = this._getBot(id);
        if (!bot) return;
        if (bot.status === 'running') this.stopBot(id);
        if ((bot.positions || []).length > 0) { Utils.showNotification('Cerrá las posiciones primero', 'warning'); return; }
        this._saveBots(this._getBots().filter(b => b.id !== id));
        this.render();
        Header.updateLabCount();
        Utils.showNotification(`🗑 Bot "${bot.name}" eliminado`, 'info');
    },

    confirmDelete(id) {
        const bot = this._getBot(id);
        if (!bot) return;
        const hasPositions = (bot.positions || []).length > 0;

        const existing = document.getElementById('labConfirmModal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'labConfirmModal';
        modal.style.cssText = 'position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(6,9,17,0.9);';
        modal.innerHTML = `
            <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:24px;max-width:380px;width:90%;">
                <div style="font-size:15px;font-weight:700;margin-bottom:8px;">🗑 Eliminar "${bot.name}"?</div>
                <div style="font-size:12px;color:var(--text-secondary);margin-bottom:4px;">
                    ${bot.stats?.trades || 0} trades · ${Utils.formatPnL(bot.stats?.totalPnl || 0)} PnL
                </div>
                ${hasPositions ? `
                    <div style="font-size:11px;color:var(--red);margin-bottom:12px;padding:8px;background:var(--red-bg);border-radius:6px;">
                        ⚠️ Tiene ${(bot.positions || []).length} posición(es) abierta(s). Se cerrarán a precio de mercado.
                    </div>
                ` : '<div style="margin-bottom:12px;"></div>'}
                <div style="font-size:11px;color:var(--dim);margin-bottom:16px;">Esta acción no se puede deshacer. Considerá archivar en vez de borrar.</div>
                <div style="display:flex;gap:8px;">
                    <button class="btn btn-ghost" onclick="document.getElementById('labConfirmModal').remove()" style="flex:1;padding:9px 12px;font-size:11px;">Cancelar</button>
                    <button class="btn btn-analyze" onclick="Lab.archiveBot('${bot.id}');document.getElementById('labConfirmModal').remove()" style="flex:1;padding:9px 12px;font-size:11px;">📦 Archivar</button>
                    <button class="btn btn-short" onclick="Lab.forceDeleteBot('${bot.id}');document.getElementById('labConfirmModal').remove()" style="flex:1;padding:9px 12px;font-size:11px;">🗑 Eliminar</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    },

    archiveBot(id) {
        const bot = this._getBot(id);
        if (!bot) return;
        // Stop if running
        if (bot.status === 'running') this.stopBot(id);
        // Force close any open positions
        this._forceCloseAllPositions(id);
        // Archive
        this._updateBot(id, { status: 'archived', archivedAt: new Date().toISOString() });
        this.render();
        Header.updateLabCount();
        Utils.showNotification(`📦 Bot "${bot.name}" archivado`, 'info');
    },

    restoreBot(id) {
        const bot = this._getBot(id);
        if (!bot) return;
        this._updateBot(id, { status: 'idle', archivedAt: null });
        this.render();
        Header.updateLabCount();
        Utils.showNotification(`↩ Bot "${bot.name}" restaurado`, 'success');
    },

    forceDeleteBot(id) {
        const bot = this._getBot(id);
        if (!bot) return;
        // Stop if running
        if (bot.status === 'running') this.stopBot(id);
        // Force close any positions
        this._forceCloseAllPositions(id);
        // Delete permanently
        this._saveBots(this._getBots().filter(b => b.id !== id));
        this.render();
        Header.updateLabCount();
        Utils.showNotification(`🗑 Bot "${bot.name}" eliminado permanentemente`, 'info');
    },

    _forceCloseAllPositions(id) {
        const bot = this._getBot(id);
        if (!bot || !bot.positions || bot.positions.length === 0) return;
        // Close each position at current market price
        const positions = [...bot.positions];
        for (const pos of positions) {
            const price = State.prices[pos.symbol]?.price || pos.entry;
            this._botClosePosition(id, pos.id, price, 'Cierre forzado');
        }
    },

    // === BOT ENGINE ===

    _startBotInterval(id) {
        if (this._intervals[id]) clearInterval(this._intervals[id]);
        const bot = this._getBot(id);
        if (!bot) return;

        // Intervals — slowed down to reduce API congestion
        const intervalMap = { scalping: 45000, intraday: 60000, swing: 120000, position: 240000 };
        const interval = intervalMap[bot.mode] || 45000;

        // Stagger: cada bot arranca con delay diferente para no saturar
        const bots = this._getBots().filter(b => b.status === 'running');
        const botIndex = bots.findIndex(b => b.id === id);
        const stagger = Math.max(0, botIndex) * 5000 + 3000; // 3s, 8s, 13s, 18s...

        console.log(`🧪 Bot ${bot.name}: interval=${interval}ms, stagger=${stagger}ms`);

        setTimeout(() => this._botCheck(id), stagger);
        this._intervals[id] = setInterval(() => this._botCheck(id), interval);
    },

    /** Analiza ambas direcciones y retorna la mejor */
    async _analyzeBestDirection(symbol, leverage, timeframe) {
        try {
            const [longR, shortR] = await Promise.all([
                API.analyze(symbol, 'LONG', leverage, timeframe),
                API.analyze(symbol, 'SHORT', leverage, timeframe)
            ]);

            if (!longR && !shortR) return null;
            if (!longR) return shortR;
            if (!shortR) return longR;

            // ENTER vale 100 puntos + confidence
            const lScore = (longR.decision === 'ENTER' ? 100 : 0) + (longR.confidence || 0);
            const sScore = (shortR.decision === 'ENTER' ? 100 : 0) + (shortR.confidence || 0);

            const best = lScore >= sScore ? longR : shortR;

            // Log para transparencia
            console.log(`🔄 ${symbol}: LONG ${longR.decision}(${longR.confidence}%) vs SHORT ${shortR.decision}(${shortR.confidence}%) → ${best.direction}`);

            return best;
        } catch (e) {
            console.error(`_analyzeBestDirection ${symbol}:`, e);
            // Fallback: intentar solo LONG
            try { return await API.analyze(symbol, 'LONG', leverage, timeframe); }
            catch (e2) { return null; }
        }
    },

    async _botCheck(id) {
        // Don't run bot checks while radar is scanning (prevents API overload)
        if (this._scanRunning) {
            console.log(`🧪 Bot ${id}: skipping check — radar scanning`);
            return;
        }
        
        let bot = this._getBot(id);
        if (!bot || bot.status !== 'running') {
            if (this._intervals[id]) { clearInterval(this._intervals[id]); delete this._intervals[id]; }
            return;
        }

        bot = this._updateBot(id, { checksRun: (bot.checksRun || 0) + 1, lastCheck: new Date().toISOString() });
        console.log(`🧪 ${bot.name} check #${bot.checksRun}`);

        if (bot.checksRun >= 500) {
            this.stopBot(id);
            return;
        }

        this._checkBotPositions(id);
        bot = this._getBot(id);

        if ((bot.positions || []).length > 0) {
            this._renderIfOpen();
            return;
        }

        try {
            const modeConfig = CONFIG.MODES[bot.mode] || CONFIG.MODES.intraday;
            const result = await SignalPipeline.analyze(bot.symbol, {
                leverage: modeConfig.lev,
                timeframe: modeConfig.tf,
                temperature: bot.temperature
            });

            console.log(`🧪 ${bot.name} analysis:`, result ? `${result.decision} ${result.direction} ${result.confidence}%` : 'null');

            if (!result) return;

            if (this._evaluateBotEntry(bot, result)) {
                // Risk Manager gate — última barrera antes de abrir
                if (typeof RiskManager !== 'undefined') {
                    const riskCheck = RiskManager.canTrade(bot);
                    if (!riskCheck.allowed) {
                        console.log(`🛡️ ${bot.name}: BLOCKED by Risk Manager — ${riskCheck.reason}`);
                        return;
                    }
                }
                console.log(`🧪 ${bot.name}: ENTERING ${result.direction}`);
                this._botOpenPosition(id, result);
            } else {
                // Log skip reason al EventFeed
                EventFeed.botCheck(bot.name, result);
            }
        } catch (e) {
            console.error(`Bot ${bot.name} error:`, e);
            EventFeed.error(`Bot ${bot.name}`, e);
        }

        this._renderIfOpen();
    },

    _evaluateBotEntry(bot, result) {
        if (!result) return false;

        const decision = (result.decision || '').toUpperCase();
        const isEntry = decision === 'ENTER' || decision === 'LONG' || decision === 'SHORT';
        if (!isEntry) return false;

        const temp = this.TEMPERATURES[bot.temperature] || this.TEMPERATURES.normal;
        const confidence = result.confidence || 0;
        const direction = result.direction || '';

        // === SNIPER MODE OVERRIDES ===
        const sniper = typeof Autonomy !== 'undefined' ? Autonomy.getSniperConfig() : null;
        this._nextTradeShadow = false; // Reset shadow flag

        if (sniper) {
            // 1. Confidence override — Sniper min takes priority
            if (confidence < sniper.minConf) {
                console.log(`🎯 ${bot.name}: SNIPER skip — conf ${confidence}% < ${sniper.minConf}%`);
                return false;
            }

            // 2. Symbol blacklist — shadow mode instead of blocking
            if (sniper.blacklist.length > 0 && sniper.blacklist.includes(bot.symbol)) {
                if (sniper.shadowMode) {
                    console.log(`👻 ${bot.name}: SHADOW mode — ${bot.symbol} en blacklist, operando sin wallet`);
                    this._nextTradeShadow = true;
                    // Still apply other filters below
                } else {
                    console.log(`🎯 ${bot.name}: SNIPER skip — ${bot.symbol} en blacklist`);
                    return false;
                }
            }

            // 3. Symbol whitelist (if set, ONLY these)
            if (sniper.whitelist.length > 0 && !sniper.whitelist.includes(bot.symbol)) {
                console.log(`🎯 ${bot.name}: SNIPER skip — ${bot.symbol} no está en whitelist`);
                return false;
            }

            // 4. Direction filter
            if (sniper.direction === 'long' && direction === 'SHORT') {
                console.log(`🎯 ${bot.name}: SNIPER skip — SHORT bloqueado (long only)`);
                return false;
            }
            if (sniper.direction === 'short' && direction === 'LONG') {
                console.log(`🎯 ${bot.name}: SNIPER skip — LONG bloqueado (short only)`);
                return false;
            }
            if (sniper.direction === 'regime') {
                // Follow market regime — block counter-trend
                const ms = (typeof Intelligence !== 'undefined' && Intelligence.getMarketScore) ? Intelligence.getMarketScore() : null;
                const regimeLabel = ms?.regime || '';
                const isBearish = regimeLabel.includes('BAJISTA') || regimeLabel.includes('FEAR') || regimeLabel.includes('BEARISH');
                const isBullish = regimeLabel.includes('ALCISTA') || regimeLabel.includes('GREED') || regimeLabel.includes('BULLISH');

                if (direction === 'LONG' && isBearish) {
                    console.log(`🎯 ${bot.name}: SNIPER skip — LONG vs ${regimeLabel}`);
                    return false;
                }
                if (direction === 'SHORT' && isBullish) {
                    console.log(`🎯 ${bot.name}: SNIPER skip — SHORT vs ${regimeLabel}`);
                    return false;
                }
            }
        } else {
            // Normal mode — use temperature minConfidence
            if (confidence < temp.minConfidence) {
                console.log(`🧪 ${bot.name}: skip — conf ${confidence}% < ${temp.minConfidence}%`);
                return false;
            }
        }

        // Bot alignment check
        if (result.bots && result.bots.length > 0) {
            const agreeing = result.bots.filter(b =>
                SignalPipeline.normalize(b.signal) === 'green' ||
                b.vote === 'ENTER' || b.vote === 'GO'
            ).length;
            const alignment = agreeing / result.bots.length;
            if (alignment < temp.botAlignment) {
                console.log(`🧪 ${bot.name}: skip — alignment ${(alignment*100).toFixed(0)}% < ${(temp.botAlignment*100).toFixed(0)}%`);
                return false;
            }
        }

        // R:R check
        const rr = parseFloat(result.rr_ratio);
        if (!isNaN(rr) && rr < 1.2) {
            console.log(`🧪 ${bot.name}: skip — R:R ${rr} < 1.2`);
            return false;
        }

        // Knowledge-based filtering via LearningEngine
        if (typeof LearningEngine !== 'undefined') {
            const learn = LearningEngine.evaluate(bot, result);
            if (!learn.allowed) {
                console.log(`🧠 ${bot.name}: skip — ${learn.reason}`);
                EventFeed.log('bot', '🧠', `${bot.name}: aprendizaje bloqueó — ${learn.reason}`);
                return false;
            }

            // FIX: Apply confidence boost from learned patterns
            if (learn.confidenceBoost && learn.confidenceBoost !== 0) {
                const original = result.confidence;
                result.confidence = Math.max(0, Math.min(100, result.confidence + learn.confidenceBoost));
                console.log(`🧠 ${bot.name}: conf ${original}% → ${result.confidence}% (boost ${learn.confidenceBoost > 0 ? '+' : ''}${learn.confidenceBoost})`);
            }

            // FIX v4.3: Apply learned optimal confidence threshold
            // Si LearningEngine dio boost positivo, reducir el threshold requerido
            // (el sistema "confía" más en esta entrada por sus patrones positivos)
            const optConf = LearningEngine.getOptimalConfidence(bot);
            if (optConf !== null) {
                const boostAdjustment = (learn.confidenceBoost > 0) ? Math.min(5, learn.confidenceBoost) : 0;
                const adjustedOptConf = optConf - boostAdjustment;
                if (result.confidence < adjustedOptConf) {
                    console.log(`🧠 ${bot.name}: skip — conf ${result.confidence}% < optimal ${optConf}% (adj: ${adjustedOptConf}%)`);
                    EventFeed.log('bot', '🧠', `${bot.name}: conf ${result.confidence}% < óptimo ${adjustedOptConf}%`);
                    return false;
                }
            }

            // Log insights si hay
            if (learn.insights && learn.insights.length > 0) {
                console.log(`🧠 ${bot.name}: ${learn.insights.join(' · ')}`);
            }
        } else {
            // Fallback: check básico de 3 losses
            const knowledge = bot.knowledge || [];
            if (knowledge.length >= 5) {
                const recent = knowledge.slice(-3);
                if (recent.every(l => l.type === 'failure')) {
                    console.log(`🧪 ${bot.name}: skip — 3 losses in a row, cooling down`);
                    return false;
                }
            }
        }

        // Intelligence integration — market regime filter
        if (typeof Intelligence !== 'undefined') {
            const ms = Intelligence.getMarketScore();
            if (ms) {
                const direction = result.direction || '';
                // Don't go LONG in extreme fear, don't SHORT in extreme greed (for conservative bots)
                if (bot.temperature === 'conservative') {
                    if (direction === 'LONG' && ms.score < -40) {
                        console.log(`🧪 ${bot.name}: skip — LONG blocked, market fear (${ms.score})`);
                        return false;
                    }
                    if (direction === 'SHORT' && ms.score > 40) {
                        console.log(`🧪 ${bot.name}: skip — SHORT blocked, market greed (${ms.score})`);
                        return false;
                    }
                }
                // Normal bots: only block in extreme conditions
                if (bot.temperature === 'normal') {
                    if (direction === 'LONG' && ms.score < -60) {
                        console.log(`🧪 ${bot.name}: skip — LONG blocked, extreme fear (${ms.score})`);
                        return false;
                    }
                    if (direction === 'SHORT' && ms.score > 60) {
                        console.log(`🧪 ${bot.name}: skip — SHORT blocked, extreme greed (${ms.score})`);
                        return false;
                    }
                }
                // Aggressive bots: trade through anything
            }

            // Correlation check — avoid if underperforming in wrong direction
            const corr = Intelligence.getCorrelation(bot.symbol);
            if (corr && bot.temperature !== 'aggressive') {
                const direction = result.direction || '';
                if (direction === 'LONG' && corr.strengthLabel === 'underperform' && !corr.aligned) {
                    console.log(`🧪 ${bot.name}: skip — ${bot.symbol} underperforming & divergent for LONG`);
                    return false;
                }
                if (direction === 'SHORT' && corr.strengthLabel === 'outperform' && corr.aligned) {
                    console.log(`🧪 ${bot.name}: skip — ${bot.symbol} outperforming for SHORT`);
                    return false;
                }
            }
        }

        // MasterBots integration — use aggregate consensus
        // FIX: Check thesis freshness — stale data (>5min) is unreliable for filtering
        if (typeof MasterBots !== 'undefined') {
            const snapshot = MasterBots.getThesisSnapshot(bot.symbol);
            const thesisAge = snapshot?.timestamp ? Date.now() - new Date(snapshot.timestamp).getTime() : Infinity;
            const MAX_THESIS_AGE = 300000; // 5 minutes

            if (snapshot?.aggregate && thesisAge < MAX_THESIS_AGE) {
                const agg = snapshot.aggregate;
                const direction = result.direction || '';

                // Conservative: require consensus alignment
                if (bot.temperature === 'conservative') {
                    if (direction === 'LONG' && agg.consensus === 'BEARISH') {
                        console.log(`🧪 ${bot.name}: skip — LONG vs BEARISH consensus`);
                        return false;
                    }
                    if (direction === 'SHORT' && agg.consensus === 'BULLISH') {
                        console.log(`🧪 ${bot.name}: skip — SHORT vs BULLISH consensus`);
                        return false;
                    }
                }

                // Normal: only block if strong opposing consensus
                if (bot.temperature === 'normal') {
                    if (direction === 'LONG' && agg.consensus === 'BEARISH' && agg.bearVotes >= 5) {
                        console.log(`🧪 ${bot.name}: skip — LONG vs strong BEARISH (${agg.bearVotes} votes)`);
                        return false;
                    }
                    if (direction === 'SHORT' && agg.consensus === 'BULLISH' && agg.bullVotes >= 5) {
                        console.log(`🧪 ${bot.name}: skip — SHORT vs strong BULLISH (${agg.bullVotes} votes)`);
                        return false;
                    }
                }
            } else if (thesisAge >= MAX_THESIS_AGE) {
                console.log(`🧪 ${bot.name}: MasterBots thesis stale (${Math.round(thesisAge/60000)}min) — skipping consensus filter`);
            }
        }

        return true;
    },

    _botOpenPosition(id, result) {
        let bot = this._getBot(id);
        if (!bot) return;

        const temp = this.TEMPERATURES[bot.temperature] || this.TEMPERATURES.normal;
        const price = result.price || State.prices[bot.symbol]?.price;
        if (!price || price <= 0) return;

        let direction = result.direction;
        if (!direction || !['LONG', 'SHORT'].includes(direction)) {
            const decision = (result.decision || '').toUpperCase();
            if (decision === 'LONG') direction = 'LONG';
            else if (decision === 'SHORT') direction = 'SHORT';
            else return;
        }

        const sniperCfg = typeof Autonomy !== 'undefined' ? Autonomy.getSniperConfig() : null;
        const leverage = sniperCfg ? sniperCfg.leverage : (result.leverage || CONFIG.MODES[bot.mode]?.lev || 10);
        
        // Dynamic position sizing — Sniper overrides RiskManager
        let margin;
        if (sniperCfg) {
            margin = bot.currentBalance * (sniperCfg.marginPct / 100);
        } else if (typeof RiskManager !== 'undefined') {
            margin = RiskManager.calculateOptimalMargin(bot, temp.risk);
        } else {
            margin = bot.currentBalance * (temp.risk / 100);
        }
        if (margin <= 0 || margin > bot.currentBalance * 0.95) return;

        const size = margin * leverage;
        const fee = size * (CONFIG.TRADING?.FEE_RATE || 0.0004);
        const liqPrice = direction === 'LONG'
            ? price * (1 - 0.996 / leverage)
            : price * (1 + 0.996 / leverage);

        // === ATR-BASED TP/SL ===
        // 1. Get ATR from backend result (already calculated per interval)
        const atrPct = result.atr_pct || 0;
        const atrVal = result.atr || 0;

        // 2. Mode-aware ATR multipliers (SL = contain risk, TP = let winners run)
        const atrMults = {
            scalping:  { sl: 1.5, tp: 3.0, maxSlPct: 0.5 },   // Tight SL, 2:1 R:R
            intraday:  { sl: 1.8, tp: 4.0, maxSlPct: 1.5 },
            swing:     { sl: 2.0, tp: 5.0, maxSlPct: 3.0 },
            position:  { sl: 2.5, tp: 6.0, maxSlPct: 5.0 },
        };
        const mults = atrMults[bot.mode] || atrMults.intraday;

        // 3. Check if LearningEngine has a better multiplier for this symbol
        let slMult = mults.sl;
        let tpMult = mults.tp;
        if (typeof LearningEngine !== 'undefined') {
            const optMults = LearningEngine.getOptimalTPSL(bot);
            if (optMults) {
                slMult = optMults.slMult;
                tpMult = optMults.tpMult;
                console.log(`🧠 ${bot.name}: usando TP/SL optimizado → SL ${slMult.toFixed(1)}x ATR, TP ${tpMult.toFixed(1)}x ATR`);
            }
        }

        // 4. Calculate TP/SL distances
        let slDist, tpDist;
        if (atrVal > 0 && atrPct > 0.01) {
            // ATR-based
            slDist = atrVal * slMult;
            tpDist = atrVal * tpMult;

            // Cap SL to maxSlPct of price (safety valve)
            const maxSl = price * (mults.maxSlPct / 100);
            if (slDist > maxSl) slDist = maxSl;
        } else {
            // Fallback: fixed % per mode
            const fallback = { scalping: { tp: 0.004, sl: 0.0015 }, intraday: { tp: 0.02, sl: 0.008 }, swing: { tp: 0.05, sl: 0.02 }, position: { tp: 0.08, sl: 0.035 } };
            const fb = fallback[bot.mode] || fallback.intraday;
            slDist = price * fb.sl;
            tpDist = price * fb.tp;
        }

        // 5. Enforce minimum 2:1 R:R
        if (tpDist < slDist * 2) tpDist = slDist * 2;

        // 6. Volatility gate: if SL > maxSlPct, too volatile for this mode — skip
        const slPct = (slDist / price) * 100;
        if (slPct > mults.maxSlPct) {
            console.log(`🧪 ${bot.name}: skip — volatilidad alta (SL ${slPct.toFixed(2)}% > max ${mults.maxSlPct}%)`);
            return;
        }

        let tp = direction === 'LONG' ? price + tpDist : price - tpDist;
        let sl = direction === 'LONG' ? price - slDist : price + slDist;

        // Save MasterBots thesis snapshot with position
        let thesis = null;
        if (typeof MasterBots !== 'undefined') {
            thesis = MasterBots.getThesisSnapshot(bot.symbol);
        }

        // Capture market regime at entry
        const regime = (typeof Intelligence !== 'undefined' && Intelligence.getMarketScore())
            ? Intelligence.getMarketScore().regime : null;

        const position = {
            id: 'bpos_' + Date.now().toString(36),
            symbol: bot.symbol, direction, entry: price, size, margin, leverage,
            tp, sl, liq: liqPrice, fee,
            confidence: result.confidence || 0,
            mode: bot.mode,
            regime,
            greenBots: result._pipeline?.greenBots || 0,
            totalBots: result._pipeline?.totalBots || 0,
            thesis,
            // ATR data for zone management
            atr: atrVal,
            atrPct: atrPct,
            slMult, tpMult,
            originalTP: tp,
            originalSL: sl,
            // Position management state
            injected: false,         // Was margin added?
            injectionAmount: 0,
            movedToBreakeven: false,
            trailingActive: false,
            partialClosed: false,
            partialAmount: 0,
            maxPnlPct: 0,           // Track highest PnL reached
            zone: 'entry',           // entry → red/neutral/green/golden
            zoneHistory: [],         // Track zone transitions for learning
            sniperTrade: !!(typeof Autonomy !== 'undefined' && Autonomy.getSniperConfig()),
            shadow: !!this._nextTradeShadow, // 👻 Shadow = no real wallet impact
            timestamp: new Date().toISOString()
        };

        // Shadow positions don't touch the wallet
        if (position.shadow) {
            this._updateBot(id, {
                positions: [position],
                // No wallet change — shadow trade
            });
            Utils.showNotification(
                `👻 ${bot.name}: SHADOW ${direction} ${bot.symbol} @ $${Utils.formatPrice(price)} (${result.confidence}%)`,
                'info'
            );
            EventFeed.log('trade', '👻', `SHADOW ${bot.name}: ${direction} ${bot.symbol} @ $${Utils.formatPrice(price)} (${result.confidence}%)`);
        } else {
            this._updateBot(id, {
                positions: [position],
                currentBalance: bot.currentBalance - margin - fee
            });
            Utils.showNotification(
                `🧪 ${bot.name}: ${direction} ${bot.symbol} @ $${Utils.formatPrice(price)} (${result.confidence}%)`,
                'success'
            );
            EventFeed.tradeOpen(bot.name, direction, bot.symbol, price, result.confidence || 0);
        }

        this._nextTradeShadow = false; // Reset flag
    },

 _checkBotPositions(id) {
        let bot = this._getBot(id);
        if (!bot || !bot.positions || bot.positions.length === 0) return;

        const toClose = [];
        const toUpdate = [];

        for (const pos of bot.positions) {
            const price = State.prices[pos.symbol]?.price;
            if (!price) continue;

            // Standard TP/SL/Liq checks first
            if (pos.direction === 'LONG') {
                if (pos.tp && price >= pos.tp) { toClose.push({ pos, reason: 'TP Hit ✅', price }); continue; }
                if (pos.sl && price <= pos.sl) { toClose.push({ pos, reason: 'SL Hit 🛑', price }); continue; }
                if (pos.liq && price <= pos.liq) { toClose.push({ pos, reason: 'Liquidación ⚠️', price }); continue; }
            } else {
                if (pos.tp && price <= pos.tp) { toClose.push({ pos, reason: 'TP Hit ✅', price }); continue; }
                if (pos.sl && price >= pos.sl) { toClose.push({ pos, reason: 'SL Hit 🛑', price }); continue; }
                if (pos.liq && price >= pos.liq) { toClose.push({ pos, reason: 'Liquidación ⚠️', price }); continue; }
            }

            // Smart Engine zone-based evaluation
            if (typeof SmartEngine !== 'undefined') {
                const candles = State.candles || [];
                const actions = SmartEngine.evaluatePosition(pos, price, candles);

                if (actions) {
                    const decision = SmartEngine.applyActions(actions);

                    // Zone + tracking updates
                    if (decision.zone || decision.maxPnlPct !== null) {
                        const updates = {};
                        if (decision.zone && decision.zone !== pos.zone) {
                            updates.zone = decision.zone;
                            updates.zoneHistory = [...(pos.zoneHistory || []), {
                                zone: decision.zone, time: Date.now(), price
                            }];
                        }
                        if (decision.maxPnlPct !== null) updates.maxPnlPct = decision.maxPnlPct;
                        if (decision.markBreakeven) updates.movedToBreakeven = true;
                        if (decision.markTrailing) updates.trailingActive = true;
                        if (Object.keys(updates).length > 0) {
                            toUpdate.push({ pos, updates, newSL: decision.newSL, newTP: decision.newTP, reason: decision.reason });
                        }
                    }

                    // Full close
                    if (decision.close) {
                        toClose.push({ pos, reason: `🧠 ${decision.reason}`, price });
                        continue;
                    }

                    // Partial close (70% close, 30% stays with trailing) — skip shadow
                    if (decision.partialClose && !pos.partialClosed && !pos.shadow) {
                        this._botPartialClose(id, pos.id, price, decision.partialPct, decision.reason);
                        continue;
                    }

                    // Injection evaluation (skip shadow positions — no real wallet)
                    if (decision.inject && !pos.injected && !pos.shadow) {
                        this._botInjectPosition(id, pos.id, price, decision.reason);
                    }

                    // SL update
                    if (decision.newSL && !decision.close) {
                        toUpdate.push({ pos, newSL: decision.newSL, reason: decision.reason });
                    }

                    // TP extension
                    if (decision.newTP) {
                        toUpdate.push({ pos, newTP: decision.newTP, reason: decision.reason });
                    }
                }
            }
        }

        // Apply position updates
        for (const upd of toUpdate) {
            const positions = bot.positions.map(p => {
                if (p.id !== upd.pos.id) return p;
                const updated = { ...p };
                if (upd.newSL) updated.sl = upd.newSL;
                if (upd.newTP) updated.tp = upd.newTP;
                if (upd.updates) Object.assign(updated, upd.updates);
                return updated;
            });
            bot = this._updateBot(id, { positions });
            if (upd.reason) console.log(`🧪 ${bot.name}: ${upd.reason}`);
        }

        // Close positions
        for (const { pos, reason, price } of toClose) {
            this._botClosePosition(id, pos.id, price, reason);
        }
    },

    /** Inject additional margin into a winning position */
    _botInjectPosition(id, posId, currentPrice, reason) {
        let bot = this._getBot(id);
        if (!bot) return;
        const pos = (bot.positions || []).find(p => p.id === posId);
        if (!pos || pos.injected) return;

        // Injection = 50% of original margin
        const injectAmount = pos.margin * 0.5;

        // Check bot has enough balance
        if (bot.currentBalance < injectAmount + 1) {
            console.log(`🧪 ${bot.name}: injection skipped — insufficient balance ($${bot.currentBalance.toFixed(2)})`);
            return;
        }

        // Check Learning Engine approval
        if (typeof LearningEngine !== 'undefined') {
            const injectionOK = LearningEngine.shouldInject(bot);
            if (!injectionOK) {
                console.log(`🧪 ${bot.name}: injection blocked by LearningEngine`);
                return;
            }
        }

        // RiskManager approval
        if (typeof RiskManager !== 'undefined') {
            const check = RiskManager.canTrade(bot);
            if (!check.allowed) {
                console.log(`🧪 ${bot.name}: injection blocked by RiskManager — ${check.reason}`);
                return;
            }
        }

        const fee = injectAmount * pos.leverage * (CONFIG.TRADING?.FEE_RATE || 0.0004);

        // Update position with injection
        const positions = bot.positions.map(p => {
            if (p.id !== posId) return p;
            return {
                ...p,
                injected: true,
                injectionAmount: injectAmount,
                injectionPrice: currentPrice,
                injectionTime: new Date().toISOString(),
                size: p.size + (injectAmount * p.leverage),
                margin: p.margin + injectAmount,
                fee: p.fee + fee,
            };
        });

        this._updateBot(id, {
            positions,
            currentBalance: bot.currentBalance - injectAmount - fee
        });

        console.log(`💉 ${bot.name}: inyección +$${injectAmount.toFixed(2)} en ${pos.symbol} ${pos.direction}`);
        EventFeed.log('trade', '💉', `${bot.name}: inyección +$${injectAmount.toFixed(2)} @ $${Utils.formatPrice(currentPrice)}`);
    },

    /** Partial close — close a % of position, leave rest running */
    _botPartialClose(id, posId, currentPrice, closePct, reason) {
        let bot = this._getBot(id);
        if (!bot) return;
        const pos = (bot.positions || []).find(p => p.id === posId);
        if (!pos || pos.partialClosed) return;

        const closeSize = pos.size * closePct;
        const closeMargin = pos.margin * closePct;
        const closeFee = closeSize * (CONFIG.TRADING?.FEE_RATE || 0.0004);

        const pnl = pos.direction === 'LONG'
            ? ((currentPrice - pos.entry) / pos.entry) * closeSize - closeFee
            : ((pos.entry - currentPrice) / pos.entry) * closeSize - closeFee;

        // Update position: reduce size, mark partial closed
        const positions = bot.positions.map(p => {
            if (p.id !== posId) return p;
            return {
                ...p,
                partialClosed: true,
                partialAmount: pnl,
                partialPrice: currentPrice,
                partialTime: new Date().toISOString(),
                size: p.size - closeSize,
                margin: p.margin - closeMargin,
            };
        });

        // Return partial margin + PnL to wallet
        this._updateBot(id, {
            positions,
            currentBalance: bot.currentBalance + closeMargin + pnl
        });

        console.log(`🏆 ${bot.name}: cierre parcial ${(closePct * 100).toFixed(0)}% → PnL ${Utils.formatPnL(pnl)}`);
        EventFeed.log('trade', '🏆', `${bot.name}: cierre parcial ${(closePct * 100).toFixed(0)}% ${pos.symbol} → ${Utils.formatPnL(pnl)}`);
    },

    _botClosePosition(id, posId, exitPrice, reason) {
        let bot = this._getBot(id);
        if (!bot) return;
        const pos = (bot.positions || []).find(p => p.id === posId);
        if (!pos) return;

        const exitFee = pos.fee; // FIX: solo exit fee (entry ya descontada de wallet)
        const pnl = pos.direction === 'LONG'
            ? ((exitPrice - pos.entry) / pos.entry) * pos.size - exitFee
            : ((pos.entry - exitPrice) / pos.entry) * pos.size - exitFee;

        // Save thesis snapshot at close too
        let closingThesis = null;
        if (typeof MasterBots !== 'undefined') {
            closingThesis = MasterBots.getThesisSnapshot(bot.symbol);
        }

        const trade = {
            ...pos, exitPrice, pnl, reason,
            closedAt: new Date().toISOString(),
            openThesis: pos.thesis || null,
            closeThesis: closingThesis,
            shadow: pos.shadow || false, // 👻 Preserve shadow flag
            // Position management data for learning
            wasInjected: pos.injected || false,
            injectionAmount: pos.injectionAmount || 0,
            wasPartialClosed: pos.partialClosed || false,
            partialAmount: pos.partialAmount || 0,
            finalZone: pos.zone || 'unknown',
            zoneHistory: pos.zoneHistory || [],
            maxPnlPct: pos.maxPnlPct || 0,
            movedToBreakeven: pos.movedToBreakeven || false,
            trailingActive: pos.trailingActive || false,
            // ATR data at entry for TP/SL learning
            entryATR: pos.atr || 0,
            entryATRPct: pos.atrPct || 0,
            slMult: pos.slMult || 0,
            tpMult: pos.tpMult || 0,
            originalTP: pos.originalTP || pos.tp,
            originalSL: pos.originalSL || pos.sl,
            tpPctUsed: pos.tp ? Math.abs(pos.originalTP - pos.entry) / pos.entry * 100 : 0,
            slPctUsed: pos.sl ? Math.abs(pos.originalSL - pos.entry) / pos.entry * 100 : 0,
        };

        const isWin = pnl > 0;
        const stats = { ...(bot.stats || { trades: 0, wins: 0, losses: 0, totalPnl: 0 }) };

        // Shadow trades: track stats but DON'T touch wallet
        if (pos.shadow) {
            stats.trades++;
            if (isWin) stats.wins++; else stats.losses++;
            // Don't add PnL to stats.totalPnl for shadow (keep real PnL separate)
            
            this._updateBot(id, {
                positions: (bot.positions || []).filter(p => p.id !== posId),
                trades: [...(bot.trades || []), trade].slice(-200),
                stats,
                // NO currentBalance change for shadow
            });

            Utils.showNotification(
                `👻 ${bot.name}: ${isWin ? '✅' : '❌'} SHADOW ${reason} | ${Utils.formatPnL(pnl)}`,
                'info'
            );
            EventFeed.log('trade', '👻', `SHADOW ${bot.name}: ${isWin ? 'WIN' : 'LOSS'} ${Utils.formatPnL(pnl)} — ${reason}`);
        } else {
            stats.trades++;
            if (isWin) stats.wins++; else stats.losses++;
            stats.totalPnl += pnl;

            this._updateBot(id, {
                positions: (bot.positions || []).filter(p => p.id !== posId),
                trades: [...(bot.trades || []), trade].slice(-200),
                stats,
                currentBalance: Math.max(0, bot.currentBalance + pos.margin + pnl)
            });

            Utils.showNotification(
                `🧪 ${bot.name}: ${isWin ? '✅' : '❌'} ${reason} | ${Utils.formatPnL(pnl)}`,
                isWin ? 'success' : 'error'
            );
            EventFeed.tradeClose(bot.name, pos.symbol, pnl, reason);
        }

        this._learnFromTrade(id, trade);
        Header.updateLabCount();

        // Post-trade risk check — puede pausar el bot si hay problemas
        if (typeof RiskManager !== 'undefined') {
            const updatedBot = this._getBot(id);
            if (updatedBot) RiskManager.afterTrade(updatedBot);
        }
    },

    // === KNOWLEDGE ===

    _learnFromTrade(botId, trade) {
        const bot = this._getBot(botId);
        if (!bot) return;

        const knowledge = bot.knowledge || [];
        const isWin = trade.pnl > 0;

        // Extract insights from thesis
        let thesisInsight = '';
        let thesisAligned = null; // Did thesis predict correctly?
        if (trade.openThesis?.aggregate) {
            const agg = trade.openThesis.aggregate;
            thesisInsight = ` | Tesis: ${agg.consensus} (${agg.score}/100)`;
            // FIX: Track if thesis consensus aligned with trade outcome
            const wasLong = trade.direction === 'LONG';
            const thesisBullish = agg.consensus === 'BULLISH';
            thesisAligned = (isWin && wasLong === thesisBullish) || (!isWin && wasLong !== thesisBullish);
        }

        const lesson = {
            id: 'k_' + Date.now().toString(36),
            timestamp: new Date().toISOString(),
            type: isWin ? 'success' : 'failure',
            symbol: trade.symbol, direction: trade.direction,
            confidence: trade.confidence || 0, pnl: trade.pnl,
            duration: trade.closedAt && trade.timestamp
                ? Math.round((new Date(trade.closedAt) - new Date(trade.timestamp)) / 60000) : 0,
            reason: trade.reason || 'Unknown',
            hour: new Date(trade.timestamp).getHours(),
            mode: trade.mode || bot.mode,
            regime: trade.regime || null,
            leverage: trade.leverage || 0,
            greenBots: trade.greenBots || 0,
            totalBots: trade.totalBots || 0,
            thesisAligned,
            // Position management data
            wasInjected: trade.wasInjected || false,
            injectionAmount: trade.injectionAmount || 0,
            wasPartialClosed: trade.wasPartialClosed || false,
            finalZone: trade.finalZone || 'unknown',
            maxPnlPct: trade.maxPnlPct || 0,
            movedToBreakeven: trade.movedToBreakeven || false,
            trailingActive: trade.trailingActive || false,
            // ATR/TP/SL data for optimization
            entryATRPct: trade.entryATRPct || 0,
            slMult: trade.slMult || 0,
            tpMult: trade.tpMult || 0,
            tpPctUsed: trade.tpPctUsed || 0,
            slPctUsed: trade.slPctUsed || 0,
            insight: isWin
                ? `${trade.direction} ${trade.symbol} exitoso (${trade.confidence}% conf)${thesisInsight}`
                : `${trade.direction} ${trade.symbol} falló: ${trade.reason}${thesisInsight}`,
            openThesis: trade.openThesis || null,
            closeThesis: trade.closeThesis || null
        };

        knowledge.push(lesson);
        // FIX: Increased from 50 to 200 — need more samples for statistical learning
        if (knowledge.length > 200) knowledge.splice(0, knowledge.length - 200);
        this._updateBot(botId, { knowledge });
    },

    showKnowledge(botId) {
        const bot = this._getBot(botId);
        if (!bot) return;
        const existing = document.getElementById('labKnowledgeModal');
        if (existing) existing.remove();

        const k = bot.knowledge || [];
        const modal = document.createElement('div');
        modal.id = 'labKnowledgeModal';
        modal.className = 'modal-overlay active';

        if (k.length === 0) {
            modal.innerHTML = `<div class="modal" style="width:400px"><div class="modal-header"><h3>📚 ${bot.name}</h3><button class="modal-close" onclick="document.getElementById('labKnowledgeModal').remove()">✕</button></div><div class="modal-body"><div style="text-align:center;padding:30px;color:var(--dim);">📚 Sin conocimiento aún</div></div></div>`;
        } else {
            const wins = k.filter(l => l.type === 'success');
            const losses = k.filter(l => l.type === 'failure');

            // Learning Engine report
            let patternsHTML = '';
            if (typeof LearningEngine !== 'undefined') {
                const report = LearningEngine.getReport(bot);
                if (report.hasData && report.patterns && report.patterns.length > 0) {
                    patternsHTML = `
                        <div style="margin-top:10px; padding:8px 10px; background:rgba(0,212,255,0.08); border:1px solid rgba(0,212,255,0.2); border-radius:6px;">
                            <div style="font-size:10px; color:var(--gold); font-weight:600; margin-bottom:6px;">🧠 PATRONES APRENDIDOS</div>
                            ${report.patterns.map(p => `<div style="font-size:11px; color:var(--text-secondary); padding:2px 0;">• ${p}</div>`).join('')}
                            ${report.optimalConfidence ? `<div style="font-size:10px; color:var(--dim); margin-top:6px;">Conf. óptimo sugerido: ≥${report.optimalConfidence}%</div>` : ''}
                        </div>
                    `;
                } else if (!report.hasData) {
                    patternsHTML = `<div style="margin-top:8px; font-size:10px; color:var(--dim); text-align:center;">${report.message}</div>`;
                }
            }

            modal.innerHTML = `
                <div class="modal" style="width:480px">
                    <div class="modal-header">
                        <h3>📚 ${bot.name} — ${k.length} lecciones</h3>
                        <button class="modal-close" onclick="document.getElementById('labKnowledgeModal').remove()">✕</button>
                    </div>
                    <div class="modal-body">
                        <div class="knowledge-summary">
                            <div class="knowledge-stat-grid">
                                <div class="knowledge-stat"><div class="knowledge-stat-label">Wins</div><div class="knowledge-stat-val" style="color:var(--green)">${wins.length}</div></div>
                                <div class="knowledge-stat"><div class="knowledge-stat-label">Losses</div><div class="knowledge-stat-val" style="color:var(--red)">${losses.length}</div></div>
                                <div class="knowledge-stat"><div class="knowledge-stat-label">Conf. Wins</div><div class="knowledge-stat-val">${wins.length ? (wins.reduce((s,l) => s+l.confidence, 0)/wins.length).toFixed(0) : '--'}%</div></div>
                                <div class="knowledge-stat"><div class="knowledge-stat-label">Conf. Losses</div><div class="knowledge-stat-val">${losses.length ? (losses.reduce((s,l) => s+l.confidence, 0)/losses.length).toFixed(0) : '--'}%</div></div>
                            </div>
                        </div>
                        ${patternsHTML}
                        <div style="margin-top:12px; max-height:300px; overflow-y:auto;">
                            ${k.slice(-10).reverse().map(l => `
                                <div class="knowledge-lesson ${l.type}">
                                    <div class="knowledge-lesson-header">
                                        <span>${l.type === 'success' ? '✅' : '❌'} ${l.direction} ${l.symbol}</span>
                                        <span style="color:${l.pnl >= 0 ? 'var(--green)' : 'var(--red)'}">${Utils.formatPnL(l.pnl)}</span>
                                    </div>
                                    <div class="knowledge-lesson-insight">${l.insight}</div>
                                    <div class="knowledge-lesson-meta">Conf: ${l.confidence}% · ${l.duration}m · ${new Date(l.timestamp).toLocaleDateString('es-AR')}</div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>
            `;
        }
        document.body.appendChild(modal);
    },

    _renderIfOpen() {
        const overlay = document.getElementById('labOverlay');
        if (overlay && overlay.classList.contains('active')) this.render();
    },

    // ═══════════════════════════════════════
    // AUTONOMY BOT INTEGRATION
    // ═══════════════════════════════════════

    toggleAutonomy() {
        if (typeof Autonomy === 'undefined') {
            Utils.showNotification('Autonomy no disponible', 'error');
            return;
        }

        if (Autonomy._running) {
            Autonomy.stop();
        } else {
            Autonomy.start();
        }

        this._updateAutonomyUI();
    },

    setAutonomyMode(mode) {
        if (typeof Autonomy === 'undefined') return;
        Autonomy.setMode(mode);
        this._updateAutonomyUI();
    },

    _updateAutonomyUI() {
        const statusEl = document.getElementById('autonomyStatus');
        const btnEl = document.getElementById('btnAutonomyToggle');
        const statsEl = document.getElementById('autonomyStatsPanel');
        const modeSelect = document.getElementById('autonomyMode');

        if (typeof Autonomy === 'undefined') return;

        const status = Autonomy.getStatus();
        const running = status.running;
        const mode = Autonomy._currentMode || 'moderate';
        const activeBots = this._getBots().filter(b => b.status === 'running').length;

        if (statusEl) {
            statusEl.textContent = running ? 'ACTIVO' : 'INACTIVO';
            statusEl.className = 'autonomy-status ' + (running ? 'active' : 'inactive');
        }

        if (btnEl) {
            btnEl.textContent = running ? '⏹ Detener' : '▶ Iniciar';
            btnEl.className = 'btn-autonomy' + (running ? ' running' : '');
        }

        if (statsEl) {
            statsEl.innerHTML = `
                <div class="autonomy-stat">
                    <span class="autonomy-stat-label">Nivel</span>
                    <span class="autonomy-stat-value">L${status.level}</span>
                </div>
                <div class="autonomy-stat">
                    <span class="autonomy-stat-label">Bots Activos</span>
                    <span class="autonomy-stat-value">${activeBots}</span>
                </div>
                <div class="autonomy-stat">
                    <span class="autonomy-stat-label">Auto Trades</span>
                    <span class="autonomy-stat-value">${status.stats.totalTrades}</span>
                </div>
                <div class="autonomy-stat">
                    <span class="autonomy-stat-label">Win Rate</span>
                    <span class="autonomy-stat-value">${status.stats.winRate.toFixed(0)}%</span>
                </div>
            `;
        }

        if (modeSelect) {
            modeSelect.value = mode;
        }
    },

    // ═══════════════════════════════════════
    // MASTERBOTS RENDERING
    // ═══════════════════════════════════════

    _renderMasterBots() {
        const grid = document.getElementById('labMastersGrid');
        if (!grid) return;

        if (typeof MasterBots === 'undefined' || !MasterBots._masters || MasterBots._masters.length === 0) {
            grid.innerHTML = '<div class="lab-empty" style="padding:20px; text-align:center; color:var(--dim); font-size:11px;">Sin MasterBots aún. Los bots con buen rendimiento se promueven automáticamente.</div>';
            return;
        }

        grid.innerHTML = MasterBots._masters.map(m => `
            <div class="master-card">
                <div class="master-card-header">
                    <span class="master-card-name">🏆 ${m.name || m.id}</span>
                </div>
                <div class="master-card-stats">
                    <div class="master-stat">
                        <span class="master-stat-label">Win Rate</span>
                        <span class="master-stat-value" style="color:var(--green)">${((m.winRate || 0) * 100).toFixed(0)}%</span>
                    </div>
                    <div class="master-stat">
                        <span class="master-stat-label">Trades</span>
                        <span class="master-stat-value">${m.trades || 0}</span>
                    </div>
                    <div class="master-stat">
                        <span class="master-stat-label">PnL</span>
                        <span class="master-stat-value" style="color:${(m.totalPnl || 0) >= 0 ? 'var(--green)' : 'var(--red)'}">
                            ${(m.totalPnl || 0) >= 0 ? '+' : ''}$${(m.totalPnl || 0).toFixed(2)}
                        </span>
                    </div>
                    <div class="master-stat">
                        <span class="master-stat-label">P.Factor</span>
                        <span class="master-stat-value">${(m.profitFactor || 0).toFixed(2)}</span>
                    </div>
                </div>
            </div>
        `).join('');
    },

    // ═══════════════════════════════════════
    // LEARNING & DATA RENDERING
    // ═══════════════════════════════════════

    _renderLearningStats() {
        const container = document.getElementById('labLearningStats');
        if (!container) return;

        const bots = this._getBots();
        let dbStatsHTML = '';
        let effectivenessHTML = '';
        let patternsHTML = '';

        // TradeDB Stats
        if (typeof TradeDB !== 'undefined' && TradeDB._ready) {
            TradeDB.getDBStats().then(stats => {
                const dbEl = document.getElementById('labDbStats');
                if (dbEl && stats) {
                    dbEl.innerHTML = `
                        <div class="learning-stat">
                            <span class="learning-stat-label">Total Trades</span>
                            <span class="learning-stat-value">${stats.totalTrades || 0}</span>
                        </div>
                        <div class="learning-stat">
                            <span class="learning-stat-label">Last 30 Days</span>
                            <span class="learning-stat-value">${stats.last30DaysTrades || 0}</span>
                        </div>
                        <div class="learning-stat">
                            <span class="learning-stat-label">Unique Symbols</span>
                            <span class="learning-stat-value">${stats.uniqueSymbols || 0}</span>
                        </div>
                        <div class="learning-stat">
                            <span class="learning-stat-label">Unique Bots</span>
                            <span class="learning-stat-value">${stats.uniqueBots || 0}</span>
                        </div>
                    `;
                }
            }).catch(() => {});
            dbStatsHTML = '<div class="learning-stats-grid" id="labDbStats"><div style="color:var(--dim)">Loading...</div></div>';
        } else {
            dbStatsHTML = '<div class="learning-stats-grid"><div style="color:var(--dim)">TradeDB not available</div></div>';
        }

        // Learning Effectiveness
        if (typeof LearningEngine !== 'undefined') {
            const effectiveness = LearningEngine.getEffectiveness();
            if (effectiveness) {
                effectivenessHTML = `
                    <div class="learning-effectiveness">
                        <div class="learning-eff-status ${effectiveness.isEffective ? 'effective' : 'neutral'}">
                            ${effectiveness.isEffective ? '✅ Effective' : '⚠️ Neutral'}
                        </div>
                        <div class="learning-eff-grid">
                            <div class="learning-stat">
                                <span class="learning-stat-label">Blocked</span>
                                <span class="learning-stat-value">${effectiveness.blocked} <small>(${effectiveness.blockedAccuracy})</small></span>
                            </div>
                            <div class="learning-stat">
                                <span class="learning-stat-label">Allowed</span>
                                <span class="learning-stat-value">${effectiveness.allowed} <small>(${effectiveness.allowedWinRate})</small></span>
                            </div>
                        </div>
                        <div class="learning-eff-interpretation">${effectiveness.interpretation || ''}</div>
                    </div>
                `;
            } else {
                effectivenessHTML = '<div style="color:var(--dim); font-size:11px; text-align:center; padding:10px;">Collecting data... (need 20+ evaluations)</div>';
            }

            // Patterns from all bots
            const allPatterns = new Set();
            bots.forEach(bot => {
                try {
                    const report = LearningEngine.getReport(bot);
                    if (report.patterns) {
                        report.patterns.forEach(p => allPatterns.add(p));
                    }
                } catch (e) {}
            });

            if (allPatterns.size > 0) {
                patternsHTML = `
                    <div class="learning-patterns">
                        <div class="learning-patterns-title">🔍 Detected Patterns</div>
                        <div class="learning-patterns-list">
                            ${Array.from(allPatterns).slice(0, 10).map(p => `<span class="pattern-tag">${p}</span>`).join('')}
                        </div>
                    </div>
                `;
            }
        } else {
            effectivenessHTML = '<div style="color:var(--dim); text-align:center;">LearningEngine not available</div>';
        }

        container.innerHTML = `
            <div class="learning-section">
                <div class="learning-section-title">📦 TradeDB Storage</div>
                ${dbStatsHTML}
            </div>
            <div class="learning-section">
                <div class="learning-section-title">🎯 Filter Effectiveness</div>
                ${effectivenessHTML}
            </div>
            ${patternsHTML}
        `;
    }
};
