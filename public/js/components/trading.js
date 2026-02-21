/* ========================================
   TRADING - Trading Logic Module
   Trading Platform PRO v3.0
   ======================================== */

const Trading = {

    tpSlMode: 'auto',
    manualTp: null,
    manualSl: null,

    // Watcher state
    _watcher: null,
    _watcherInterval: null,
    _watcherCycles: 0,
    _watcherMaxCycles: 120,

    // Prediction tracking for learning
    _predictions: {},

    // ═══════════════════════════════════════
    // POSITION CONFIG (Binance Futures style)
    // ═══════════════════════════════════════
    _posConfig: {
        leverage: 20,
        marginType: 'isolated',   // isolated | cross
        marginMode: 'percent',    // percent | fixed
        marginPercent: 2,         // % del balance
        marginFixed: 0,           // USDT fijo
        orderType: 'market',      // market | limit
        limitPrice: 0,
    },

    /** Renderiza panel compacto de config (estilo Binance Futures) */
    renderPositionConfig() {
        const container = document.getElementById('positionConfigPanel');
        if (!container) return;

        const c = this._posConfig;
        const balance = State.balance || 10000;
        const margin = c.marginMode === 'percent' ? balance * (c.marginPercent / 100) : Math.min(c.marginFixed, balance);
        const size = margin * c.leverage;
        const fee = size * (CONFIG.TRADING.FEE_RATE || 0.0004);
        const liqPct = c.leverage > 0 ? (99.6 / c.leverage) : 0;

        container.innerHTML = `
            <div class="pcfg">
                <div class="pcfg-row">
                    <div class="pcfg-group">
                        <button class="pcfg-pill ${c.marginType === 'isolated' ? 'on' : ''}" onclick="Trading.setMarginType('isolated')">Isolated</button>
                        <button class="pcfg-pill ${c.marginType === 'cross' ? 'on' : ''}" onclick="Trading.setMarginType('cross')">Cross</button>
                    </div>
                    <div class="pcfg-sep"></div>
                    <div class="pcfg-group pcfg-lev">
                        <input type="range" class="pcfg-slider" min="1" max="125" value="${c.leverage}"
                            oninput="Trading.setLeverage(this.value)">
                        <span class="pcfg-lev-val">${c.leverage}x</span>
                        ${[5, 10, 20, 50, 100].map(v =>
                            `<button class="pcfg-chip ${c.leverage === v ? 'on' : ''}" onclick="Trading.setLeverage(${v})">${v}x</button>`
                        ).join('')}
                    </div>
                    <div class="pcfg-sep"></div>
                    <div class="pcfg-group">
                        ${[1, 2, 5, 10, 25].map(v =>
                            `<button class="pcfg-chip ${c.marginMode === 'percent' && c.marginPercent === v ? 'on' : ''}" onclick="Trading.setMarginMode('percent');Trading.setMarginPercent(${v})">${v}%</button>`
                        ).join('')}
                        <input type="number" class="pcfg-input" value="${c.marginMode === 'percent' ? c.marginPercent : c.marginFixed}"
                            onchange="Trading._posConfig.marginMode==='percent' ? Trading.setMarginPercent(parseFloat(this.value)) : Trading.setMarginFixed(parseFloat(this.value))"
                            style="width:52px">
                        <span class="pcfg-unit">${c.marginMode === 'percent' ? '%' : 'U'}</span>
                    </div>
                    <div class="pcfg-sep"></div>
                    <div class="pcfg-group">
                        <button class="pcfg-pill ${c.orderType === 'market' ? 'on' : ''}" onclick="Trading.setOrderType('market')">Mkt</button>
                        <button class="pcfg-pill ${c.orderType === 'limit' ? 'on' : ''}" onclick="Trading.setOrderType('limit')">Lmt</button>
                    </div>
                </div>
                <div class="pcfg-preview">
                    <span>Margen <b>${Utils.formatCurrency(margin)}</b></span>
                    <span>Size <b>${Utils.formatCurrency(size)}</b></span>
                    <span>Fee <b>${Utils.formatCurrency(fee)}</b></span>
                    <span>Liq <b>~${liqPct.toFixed(1)}%</b></span>
                </div>
            </div>
        `;
    },

    setLeverage(val) {
        this._posConfig.leverage = Math.max(1, Math.min(125, parseInt(val) || 20));
        this.renderPositionConfig();
    },
    setMarginType(type) {
        this._posConfig.marginType = type;
        this.renderPositionConfig();
    },
    setMarginMode(mode) {
        this._posConfig.marginMode = mode;
        if (mode === 'fixed' && this._posConfig.marginFixed <= 0) {
            this._posConfig.marginFixed = Math.round(State.balance * (this._posConfig.marginPercent / 100));
        }
        this.renderPositionConfig();
    },
    setMarginPercent(val) {
        this._posConfig.marginPercent = Math.max(0.1, Math.min(100, parseFloat(val) || 2));
        this.renderPositionConfig();
    },
    setMarginFixed(val) {
        this._posConfig.marginFixed = Math.max(1, parseFloat(val) || 0);
        this.renderPositionConfig();
    },
    setOrderType(type) {
        this._posConfig.orderType = type;
        if (type === 'limit') {
            this._posConfig.limitPrice = State.getCurrentPrice() || 0;
        }
        this.renderPositionConfig();
    },

    async analyze() {
        if (State.isAnalyzing) return;

        const btn = document.getElementById('btnAnalyze');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner"></span> Analizando...';
        }

        State.set('isAnalyzing', true);

        try {
            if (!State.candles || State.candles.length < 21) {
                Utils.showNotification('Esperando datos de mercado...', 'warning');
                return;
            }

            // Get direction from indicators
            const signal = Indicators.generateSignal(State.candles);
            let direction = signal.direction;

            if (direction === 'NEUTRAL') {
                const closes = State.candles.map(c => c.c);
                const ema9 = Indicators.ema(closes, 9);
                const ema21 = Indicators.ema(closes, 21);
                const rsiVal = Indicators.rsi(closes);

                if (ema9 > ema21 && rsiVal < 65) direction = 'LONG';
                else if (ema9 < ema21 && rsiVal > 35) direction = 'SHORT';
                else direction = 'LONG'; // Default
            }

            const modeConfig = State.getModeConfig();
            let result;

            // Try API first, fallback to client-side analysis
            try {
                result = await API.analyze(
                    State.symbol,
                    direction,
                    modeConfig.lev,
                    State.timeframe
                );
            } catch (apiError) {
                console.warn('API unavailable, using client-side analysis:', apiError.message);

                // Use client-side analyzer
                if (typeof ClientAnalyzer !== 'undefined') {
                    result = ClientAnalyzer.analyze(
                        State.symbol,
                        direction,
                        modeConfig.lev,
                        State.timeframe
                    );
                } else {
                    throw new Error('No analyzer available');
                }
            }

            if (!result) {
                throw new Error('Empty analysis result');
            }

            result.frontendSignal = signal;

            // Apply SmartEngine if available (simplified)
            if (typeof SmartEngine !== 'undefined' && SmartEngine.recordAnalysis) {
                SmartEngine.recordAnalysis(State.symbol, result);
            }

            State.set('analysis', result);

            // Render analysis panel
            if (typeof Analysis !== 'undefined' && Analysis.render) {
                await Analysis.render(result);
            }

            // Setup TP/SL controls
            this.tpSlMode = 'auto';
            this.manualTp = null;
            this.manualSl = null;
            this._renderTpSlControls(result);
            this._renderHypothesisInput(result);

            // Enable/disable buttons based on decision
            if (result.decision === 'ENTER') {
                this.enableButtons();
                Utils.showNotification(
                    `${result.direction === 'LONG' ? '▲' : '▼'} ${result.direction} - ${result.reason || 'Señal de entrada'}`,
                    'success'
                );
            } else if (result.decision === 'WAIT') {
                this.disableButtons();
                Utils.showNotification(result.reason || 'Esperando mejor entrada', 'warning');
            } else {
                this.disableButtons();
                Utils.showNotification(result.reason || 'No entrar', 'error');
            }

            return result;

        } catch (error) {
            console.error('Analysis error:', error);
            Utils.showNotification('Error al analizar: ' + error.message, 'error');
            return null;
        } finally {
            State.set('isAnalyzing', false);
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<span class="btn-icon">⚡</span> Analizar';
            }
        }
    },

    // === WATCHER SYSTEM ===

    toggleWatcher() {
        if (this._watcher) {
            this.stopWatcher();
        } else {
            this.startWatcher();
        }
    },

    startWatcher() {
        if (this._watcher) return;

        const modeConfig = State.getModeConfig();
        const intervalMap = {
            scalping: 10000,
            intraday: 30000,
            swing: 60000,
            position: 120000
        };
        const interval = intervalMap[State.mode] || 30000;

        this._watcherCycles = 0;
        this._watcher = {
            symbol: State.symbol,
            mode: State.mode,
            timeframe: State.timeframe,
            interval: interval,
            startedAt: new Date().toISOString(),
            minConfidence: 70,
            lastCheck: null,
            checksRun: 0
        };

        this._updateWatcherUI();

        Utils.showNotification(
            `👁 Watcher activo en ${State.symbol} (${State.mode}) — Intervalo: ${interval / 1000}s`,
            'success'
        );

        // Run first check immediately
        this._watcherCheck();

        // Set interval
        this._watcherInterval = setInterval(() => this._watcherCheck(), interval);
    },

    stopWatcher(reason) {
        if (this._watcherInterval) {
            clearInterval(this._watcherInterval);
            this._watcherInterval = null;
        }

        const cycles = this._watcher?.checksRun || 0;
        this._watcher = null;
        this._watcherCycles = 0;

        this._updateWatcherUI();

        const msg = reason || `Watcher detenido después de ${cycles} checks`;
        Utils.showNotification(`⏹ ${msg}`, 'warning');
    },

    async _watcherCheck() {
        if (!this._watcher) return;

        // Skip if radar is scanning (prevents API overload)
        if (typeof Lab !== 'undefined' && Lab._scanRunning) return;

        // Safety: stop if symbol changed
        if (this._watcher.symbol !== State.symbol) {
            this.stopWatcher('Watcher detenido: cambió el par');
            return;
        }

        // Safety: max cycles
        this._watcherCycles++;
        this._watcher.checksRun = this._watcherCycles;
        this._watcher.lastCheck = new Date().toISOString();

        if (this._watcherCycles >= this._watcherMaxCycles) {
            this.stopWatcher(`Watcher detenido: máximo ${this._watcherMaxCycles} checks alcanzado`);
            return;
        }

        // Safety: max positions reached
        const maxPos = State.maxPositions || CONFIG.TRADING.MAX_POSITIONS;
        if (State.positions.length >= maxPos) {
            this.stopWatcher('Watcher detenido: máximo de posiciones alcanzado');
            return;
        }

        // Already have position in this symbol
        if (State.positions.find(p => p.symbol === this._watcher.symbol)) {
            this._updateWatcherUI();
            return; // Skip, don't stop — wait for position to close
        }

        this._updateWatcherUI();

        try {
            const result = await this.analyze();
            if (!result) return;

            const isPerfect = this._evaluateEntry(result);

            if (isPerfect) {
                const direction = result.direction;
                Utils.showNotification(
                    `🎯 WATCHER: Entrada perfecta detectada! ${direction} ${this._watcher.symbol}`,
                    'success'
                );

                // Auto-enter
                this.openPosition(direction);
                this.stopWatcher(`Entrada ejecutada: ${direction} ${this._watcher.symbol}`);
            }
        } catch (e) {
            console.error('Watcher check error:', e);
        }
    },

    /** Evaluate if conditions are perfect for entry */
    _evaluateEntry(result) {
        if (!result) return false;

        // Must be ENTER decision
        if (result.decision !== 'ENTER') return false;

        // Confidence must be high
        if ((result.confidence || 0) < this._watcher.minConfidence) return false;

        // Check bot alignment
        if (result.bots && result.bots.length > 0) {
            const greenBots = result.bots.filter(b => SignalPipeline.normalize(b.signal) === 'green').length;
            const totalBots = result.bots.length;
            const criticalBots = result.bots.filter(b => b.critical);
            const criticalGreen = criticalBots.filter(b => SignalPipeline.normalize(b.signal) === 'green').length;

            // All critical bots must be green
            if (criticalBots.length > 0 && criticalGreen < criticalBots.length) return false;

            // At least 70% of bots must be green
            if (totalBots > 0 && (greenBots / totalBots) < 0.7) return false;
        }

        // R:R must be decent
        if (result.rr_ratio && parseFloat(result.rr_ratio) < 1.5) return false;

        // Frontend signal should agree
        if (result.frontendSignal) {
            const fs = result.frontendSignal;
            if (fs.direction !== 'NEUTRAL' && fs.direction !== result.direction) return false;
            if ((fs.strength || 0) < 40) return false;
        }

        return true;
    },

    _updateWatcherUI() {
        const btn = document.getElementById('btnWatcher');
        const textEl = document.getElementById('btnWatcherText');
        if (!btn) return;

        if (this._watcher) {
            btn.classList.add('active');
            const cycles = this._watcher.checksRun || 0;
            textEl.textContent = `👁 ${cycles}/${this._watcherMaxCycles}`;
        } else {
            btn.classList.remove('active');
            textEl.textContent = 'Esperar';
        }
    },

    // === HYPOTHESIS / CONCLUSION SYSTEM ===

    _renderHypothesisInput(result) {
        const analysisPanel = document.getElementById('analysisPanel');
        if (!analysisPanel) return;

        const existing = document.getElementById('hypothesisBox');
        if (existing) existing.remove();

        if (result.decision !== 'ENTER') return;

        const div = document.createElement('div');
        div.id = 'hypothesisBox';
        div.className = 'hypothesis-box';
        div.innerHTML = `
            <div class="hypothesis-title">📝 Hipótesis de entrada</div>
            <textarea id="hypothesisInput" class="hypothesis-input"
                      placeholder="¿Por qué estoy entrando? ¿Qué espero que pase? ¿Qué señales veo?"
                      rows="3"></textarea>
            <div class="hypothesis-hint">Documentá tu razonamiento antes de abrir la posición</div>
        `;
        analysisPanel.appendChild(div);
    },

    _getHypothesis() {
        const input = document.getElementById('hypothesisInput');
        return input ? input.value.trim() : '';
    },

    _showConclusionModal(posId, callback) {
        const existing = document.getElementById('conclusionModal');
        if (existing) existing.remove();

        const pos = State.positions.find(p => p.id === posId);
        if (!pos) { callback(''); return; }

        const price = State.prices[pos.symbol]?.price || pos.entry;
        const pnl = Positions.calculatePnL(pos, price);
        const pnlIcon = pnl >= 0 ? '✅' : '❌';

        const modal = document.createElement('div');
        modal.id = 'conclusionModal';
        modal.className = 'modal-overlay active';
        modal.innerHTML = `
            <div class="modal" style="width:460px">
                <div class="modal-header">
                    <h3>${pnlIcon} Cerrar ${pos.symbol} ${pos.direction}</h3>
                    <button class="modal-close" onclick="Trading._cancelConclusion()">✕</button>
                </div>
                <div class="modal-body">
                    ${pos.hypothesis ? `
                        <div class="conclusion-hypothesis">
                            <div class="conclusion-label">Tu hipótesis al entrar:</div>
                            <div class="conclusion-hypothesis-text">"${pos.hypothesis}"</div>
                        </div>
                    ` : ''}
                    <div class="setting-group">
                        <label class="setting-label">Conclusión / Aprendizaje</label>
                        <textarea id="conclusionInput" class="hypothesis-input"
                                  placeholder="¿Se cumplió la hipótesis? ¿Qué salió bien/mal? ¿Qué haría diferente?"
                                  rows="4"></textarea>
                    </div>
                    <div class="setting-group">
                        <label class="setting-label">Razón de cierre</label>
                        <div class="conclusion-reasons">
                            <button class="conclusion-reason-btn active" data-reason="Manual">Manual</button>
                            <button class="conclusion-reason-btn" data-reason="TP Hit">TP Hit</button>
                            <button class="conclusion-reason-btn" data-reason="SL Hit">SL Hit</button>
                            <button class="conclusion-reason-btn" data-reason="Cambio de idea">Cambio idea</button>
                            <button class="conclusion-reason-btn" data-reason="Riesgo alto">Riesgo alto</button>
                        </div>
                    </div>
                    <div class="setting-actions">
                        <button class="btn btn-analyze" onclick="Trading._confirmConclusion('${posId}')">Cerrar posición</button>
                        <button class="btn btn-short" onclick="Trading._cancelConclusion()" style="flex:none; width:auto; padding:11px 20px;">Cancelar</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        modal.querySelectorAll('.conclusion-reason-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                modal.querySelectorAll('.conclusion-reason-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });

        this._conclusionCallback = callback;
    },

    _confirmConclusion(posId) {
        const conclusion = document.getElementById('conclusionInput')?.value.trim() || '';
        const reasonBtn = document.querySelector('.conclusion-reason-btn.active');
        const reason = reasonBtn ? reasonBtn.dataset.reason : 'Manual';

        const modal = document.getElementById('conclusionModal');
        if (modal) modal.remove();

        if (this._conclusionCallback) {
            this._conclusionCallback(reason, conclusion);
            this._conclusionCallback = null;
        }
    },

    _cancelConclusion() {
        const modal = document.getElementById('conclusionModal');
        if (modal) modal.remove();
        this._conclusionCallback = null;
    },

    // === TP/SL CONTROLS ===

    _renderTpSlControls(result) {
        const container = document.getElementById('tpSlControls');
        if (!container) {
            const analysisPanel = document.getElementById('analysisPanel');
            if (!analysisPanel) return;

            const div = document.createElement('div');
            div.id = 'tpSlControls';
            div.className = 'tpsl-controls';
            analysisPanel.appendChild(div);
            this._renderTpSlControls(result);
            return;
        }

        const tp = result.tp;
        const sl = result.sl;
        const price = result.price;
        const dir = result.direction;

        container.innerHTML = `
            <div class="tpsl-header">
                <span class="tpsl-title">TP / SL</span>
                <div class="tpsl-toggle">
                    <button class="tpsl-mode-btn ${this.tpSlMode === 'auto' ? 'active' : ''}"
                            onclick="Trading.setTpSlMode('auto')">Auto</button>
                    <button class="tpsl-mode-btn ${this.tpSlMode === 'manual' ? 'active' : ''}"
                            onclick="Trading.setTpSlMode('manual')">Manual</button>
                </div>
            </div>
            <div class="tpsl-inputs">
                <div class="tpsl-field">
                    <label class="tpsl-label tp">TP</label>
                    <input type="number" id="inputTp" class="tpsl-input tp"
                           value="${tp}" step="any"
                           ${this.tpSlMode === 'auto' ? 'disabled' : ''}
                           onchange="Trading.onTpSlChange()">
                    <span class="tpsl-pct" id="tpPct">${this._calcPct(price, tp, dir, 'tp')}</span>
                </div>
                <div class="tpsl-field">
                    <label class="tpsl-label sl">SL</label>
                    <input type="number" id="inputSl" class="tpsl-input sl"
                           value="${sl}" step="any"
                           ${this.tpSlMode === 'auto' ? 'disabled' : ''}
                           onchange="Trading.onTpSlChange()">
                    <span class="tpsl-pct" id="slPct">${this._calcPct(price, sl, dir, 'sl')}</span>
                </div>
                <div class="tpsl-rr" id="tpslRr">R:R ${result.rr_ratio || '—'}</div>
            </div>
        `;
    },

    _calcPct(entry, target, direction, type) {
        if (!entry || !target) return '';
        const pct = ((target - entry) / entry * 100).toFixed(2);
        const sign = parseFloat(pct) >= 0 ? '+' : '';
        return `${sign}${pct}%`;
    },

    setTpSlMode(mode) {
        this.tpSlMode = mode;
        const tpInput = document.getElementById('inputTp');
        const slInput = document.getElementById('inputSl');

        if (mode === 'auto' && State.analysis) {
            if (tpInput) { tpInput.value = State.analysis.tp; tpInput.disabled = true; }
            if (slInput) { slInput.value = State.analysis.sl; slInput.disabled = true; }
            this.manualTp = null;
            this.manualSl = null;
        } else {
            if (tpInput) tpInput.disabled = false;
            if (slInput) slInput.disabled = false;
        }

        document.querySelectorAll('.tpsl-mode-btn').forEach(btn => {
            btn.classList.toggle('active', btn.textContent.toLowerCase() === mode);
        });

        this.onTpSlChange();
    },

    onTpSlChange() {
        const tpInput = document.getElementById('inputTp');
        const slInput = document.getElementById('inputSl');
        if (!tpInput || !slInput || !State.analysis) return;

        const tp = parseFloat(tpInput.value);
        const sl = parseFloat(slInput.value);
        const price = State.analysis.price;
        const dir = State.analysis.direction;

        if (this.tpSlMode === 'manual') {
            this.manualTp = tp;
            this.manualSl = sl;
        }

        const tpPct = document.getElementById('tpPct');
        const slPct = document.getElementById('slPct');
        const rrEl = document.getElementById('tpslRr');

        if (tpPct) tpPct.textContent = this._calcPct(price, tp, dir, 'tp');
        if (slPct) slPct.textContent = this._calcPct(price, sl, dir, 'sl');

        if (rrEl) {
            const tpDist = Math.abs(tp - price);
            const slDist = Math.abs(sl - price);
            const rr = slDist > 0 ? (tpDist / slDist).toFixed(2) : '∞';
            rrEl.textContent = `R:R ${rr}`;

            if (parseFloat(rr) < 1.5 && rr !== '∞') {
                rrEl.style.color = CONFIG.COLORS.red;
            } else {
                rrEl.style.color = CONFIG.COLORS.green;
            }
        }

        let valid = true;
        if (dir === 'LONG') {
            if (tp <= price) { tpInput.style.borderColor = CONFIG.COLORS.red; valid = false; }
            else { tpInput.style.borderColor = ''; }
            if (sl >= price) { slInput.style.borderColor = CONFIG.COLORS.red; valid = false; }
            else { slInput.style.borderColor = ''; }
        } else {
            if (tp >= price) { tpInput.style.borderColor = CONFIG.COLORS.red; valid = false; }
            else { tpInput.style.borderColor = ''; }
            if (sl <= price) { slInput.style.borderColor = CONFIG.COLORS.red; valid = false; }
            else { slInput.style.borderColor = ''; }
        }

        return valid;
    },

    getEffectiveTpSl() {
        if (this.tpSlMode === 'manual' && this.manualTp && this.manualSl) {
            return { tp: this.manualTp, sl: this.manualSl };
        }
        if (State.analysis) {
            return { tp: State.analysis.tp, sl: State.analysis.sl };
        }
        return { tp: 0, sl: 0 };
    },

    // === OPEN POSITION ===

    openPosition(direction) {
        if (!State.analysis) {
            Utils.showNotification(' Primero analizá el par', 'warning');
            return;
        }

        const maxPos = State.maxPositions || CONFIG.TRADING.MAX_POSITIONS;
        if (State.positions.length >= maxPos) {
            Utils.showNotification(`Máximo ${maxPos} posiciones simultáneas`, 'warning');
            return;
        }

        const price = State.getCurrentPrice();
        if (!price || price <= 0) {
            Utils.showNotification(' Precio no disponible', 'error');
            return;
        }

        if (this.tpSlMode === 'manual' && !this.onTpSlChange()) {
            Utils.showNotification('TP/SL manual inválido — revisá los valores', 'error');
            return;
        }

        // Use position config panel values
        const c = this._posConfig;
        const leverage = c.leverage;
        let margin;
        if (c.marginMode === 'percent') {
            margin = State.balance * (c.marginPercent / 100);
        } else {
            margin = Math.min(c.marginFixed, State.balance);
        }

        const size = margin * leverage;
        const fee = size * CONFIG.TRADING.FEE_RATE;

        // FIX: Validar que margin + fee no exceda el balance disponible
        if (margin <= 0 || (margin + fee) > State.balance) {
            Utils.showNotification(' Balance insuficiente (incluye fee)', 'error');
            return;
        }

        if (fee >= margin * 0.5) {
            Utils.showNotification(' Fee demasiado alto para este tamaño de posición', 'warning');
            return;
        }

        let liqPrice;
        if (direction === 'LONG') {
            liqPrice = price * (1 - 0.996 / leverage);
        } else {
            liqPrice = price * (1 + 0.996 / leverage);
        }

        const { tp, sl } = this.getEffectiveTpSl();
        const tpDistance = Math.abs(tp - price);
        const slDistance = Math.abs(sl - price);
        const rrRatio = slDistance > 0 ? (tpDistance / slDistance).toFixed(2) : '∞';

        const hypothesis = this._getHypothesis();
        const botSummary = State.analysis.bots ?
            State.analysis.bots.map(b => `${b.name}:${b.signal}`).join(', ') : '';

        const isWatcherEntry = this._watcher !== null;

        const position = {
            id: Utils.generateId(),
            symbol: State.symbol,
            direction: direction,
            mode: State.mode,
            entry: price,
            size: size,
            margin: margin,
            leverage: leverage,
            tp: tp,
            sl: sl,
            tpSlMode: this.tpSlMode,
            liq: liqPrice,
            fee: fee,
            rrRatio: parseFloat(rrRatio) || 0,
            confidence: State.analysis.confidence || 0,
            hypothesis: isWatcherEntry ? `[AUTO-WATCHER] Confianza: ${State.analysis.confidence}% | Checks: ${this._watcherCycles}` : hypothesis,
            botSummary: botSummary,
            timeframe: State.timeframe,
            source: isWatcherEntry ? 'watcher' : 'manual',
            timestamp: new Date().toISOString()
        };

        State.updateBalance(-(margin + fee));
        State.addPosition(position);

        Utils.showNotification(
            `${direction === 'LONG' ? '▲' : '▼'} ${direction} ${State.symbol} | ` +
            `Entry: $${Utils.formatPrice(price)} | TP: $${Utils.formatPrice(tp)} | ` +
            `SL: $${Utils.formatPrice(sl)} | R:R ${rrRatio}` +
            `${isWatcherEntry ? ' (Auto-Watcher)' : ''}` +
            `${this.tpSlMode === 'manual' ? ' (Manual TP/SL)' : ''}`,
            'success'
        );

        this.disableButtons();
    },

    // === CLOSE POSITION ===

    closePosition(id, reason = 'Manual') {
        const pos = State.positions.find(p => p.id === id);
        if (!pos) return;

        if (reason === 'TP Hit' || reason === 'SL Hit' || reason === 'Liquidated') {
            this._executeClose(id, reason, '');
            return;
        }

        this._showConclusionModal(id, (finalReason, conclusion) => {
            this._executeClose(id, finalReason, conclusion);
        });
    },

    _executeClose(id, reason, conclusion) {
        const pos = State.positions.find(p => p.id === id);
        if (!pos) return;

        const price = State.prices[pos.symbol]?.price || pos.entry;

        // FIX: Solo restamos exit fee (la entry fee ya se descontó del balance al abrir)
        const exitFee = pos.fee;
        let pnl;
        if (pos.direction === 'LONG') {
            pnl = ((price - pos.entry) / pos.entry) * pos.size - exitFee;
        } else {
            pnl = ((pos.entry - price) / pos.entry) * pos.size - exitFee;
        }

        const pnlPercent = pos.margin > 0 ? ((pnl / pos.margin) * 100).toFixed(1) : '0';
        const duration = this._calcDuration(pos.timestamp);

        this._logTrade({
            ...pos,
            exitPrice: price,
            pnl: pnl,
            pnlPercent: parseFloat(pnlPercent),
            reason: reason,
            conclusion: conclusion,
            duration: duration,
            closedAt: new Date().toISOString()
        });

        State.updateBalance(pos.margin + pnl);
        State.removePosition(id);

        const emoji = pnl >= 0 ? '' : '';
        const type = pnl >= 0 ? 'success' : 'error';
        Utils.showNotification(
            `${emoji} ${pos.symbol} ${pos.direction} cerrada | ` +
            `PnL: ${Utils.formatPnL(pnl)} (${pnlPercent}%) | ` +
            `${reason} | ${duration}`,
            type
        );
    },

    enableButtons() {
        const longBtn = document.getElementById('btnLong');
        const shortBtn = document.getElementById('btnShort');
        if (longBtn) longBtn.disabled = false;
        if (shortBtn) shortBtn.disabled = false;
    },

    disableButtons() {
        const longBtn = document.getElementById('btnLong');
        const shortBtn = document.getElementById('btnShort');
        if (longBtn) longBtn.disabled = true;
        if (shortBtn) shortBtn.disabled = true;
    },

    // === HELPERS ===

    _calcDuration(openTimestamp) {
        const ms = Date.now() - new Date(openTimestamp).getTime();
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        if (days > 0) return `${days}d ${hours % 24}h`;
        if (hours > 0) return `${hours}h ${minutes % 60}m`;
        if (minutes > 0) return `${minutes}m`;
        return `${seconds}s`;
    },

    _logTrade(trade) {
        try {
            const key = CONFIG.STORAGE.HISTORY || 'tp_history';
            const history = JSON.parse(localStorage.getItem(key) || '[]');
            history.push(trade);
            if (history.length > 500) history.splice(0, history.length - 500);
            localStorage.setItem(key, JSON.stringify(history));
            State._notify('tradeHistory', history);

            // Verify prediction accuracy for learning
            const predictionResult = this._verifyPrediction(trade);
            if (predictionResult) {
                console.log('📊 Prediction verified:', predictionResult.success ? '✅ Correct' : '❌ Wrong',
                    `Accuracy: ${predictionResult.moveAccuracy.toFixed(1)}%`);
            }

            // Save to IndexedDB for persistent learning
            if (typeof TradeDB !== 'undefined') {
                TradeDB.saveTrade({
                    id: trade.id,
                    symbol: trade.symbol,
                    direction: trade.direction,
                    entry: trade.entry,
                    exit: trade.exitPrice,
                    size: trade.size,
                    margin: trade.margin,
                    leverage: trade.leverage,
                    pnl: trade.pnl,
                    pnlPercent: trade.pnlPercent,
                    fee: trade.fee,
                    openedAt: trade.timestamp,
                    closedAt: trade.closedAt,
                    duration: trade.duration,
                    reason: trade.reason,
                    botId: trade.botId || 'manual',
                    botName: trade.botName || 'Manual Trade',
                    confidence: trade.confidence,
                    thesis: trade.thesis,
                }).catch(e => console.warn('TradeDB save error:', e));
            }
        } catch (e) {
            console.error('Error guardando historial:', e);
        }
    },

    getHistory() {
        try {
            const key = CONFIG.STORAGE.HISTORY || 'tp_history';
            return JSON.parse(localStorage.getItem(key) || '[]');
        } catch (e) {
            return [];
        }
    },

    getStats() {
        const history = this.getHistory();
        if (history.length === 0) {
            return { trades: 0, wins: 0, losses: 0, winRate: 0, totalPnl: 0, avgPnl: 0, bestTrade: 0, worstTrade: 0, profitFactor: 0 };
        }
        const wins = history.filter(t => t.pnl > 0);
        const losses = history.filter(t => t.pnl <= 0);
        const totalProfit = wins.reduce((sum, t) => sum + t.pnl, 0);
        const totalLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));
        return {
            trades: history.length,
            wins: wins.length,
            losses: losses.length,
            winRate: ((wins.length / history.length) * 100).toFixed(1),
            totalPnl: history.reduce((sum, t) => sum + t.pnl, 0),
            avgPnl: history.reduce((sum, t) => sum + t.pnl, 0) / history.length,
            bestTrade: Math.max(...history.map(t => t.pnl), 0),
            worstTrade: Math.min(...history.map(t => t.pnl), 0),
            profitFactor: totalLoss > 0 ? (totalProfit / totalLoss).toFixed(2) : '∞'
        };
    },

    // ═══════════════════════════════════════
    // PREDICTION TRACKING FOR LEARNING
    // ═══════════════════════════════════════

    _savePrediction(result) {
        if (!result || result.decision !== 'ENTER') return;

        const prediction = {
            id: Utils.generateId(),
            symbol: State.symbol,
            timeframe: State.timeframe,
            mode: State.mode,
            direction: result.direction,
            entryPrice: result.price,
            tp: result.tp,
            sl: result.sl,
            confidence: result.confidence || 0,
            rrRatio: result.rr_ratio || 0,
            bots: result.bots?.map(b => ({ name: b.name, signal: b.signal, score: b.score })) || [],
            indicators: this._captureIndicators(),
            timestamp: new Date().toISOString(),
            verified: false
        };

        // Store prediction keyed by symbol
        this._predictions[State.symbol] = prediction;

        // Also persist to localStorage
        try {
            const allPredictions = JSON.parse(localStorage.getItem('tp_predictions') || '[]');
            allPredictions.push(prediction);
            // Keep last 200 predictions
            if (allPredictions.length > 200) allPredictions.splice(0, allPredictions.length - 200);
            localStorage.setItem('tp_predictions', JSON.stringify(allPredictions));
        } catch (e) {
            console.warn('Error saving prediction:', e);
        }
    },

    _captureIndicators() {
        const candles = State.candles;
        if (!candles || candles.length < 21) return {};

        const closes = candles.map(c => c.c);
        const result = {};

        try {
            if (typeof Indicators !== 'undefined') {
                const ema9s = Indicators.emaSeries(closes, 9);
                const ema21s = Indicators.emaSeries(closes, 21);
                const rsiS = Indicators.rsiSeries(closes, 14);

                result.ema9 = ema9s.length > 0 ? ema9s[ema9s.length - 1] : null;
                result.ema21 = ema21s.length > 0 ? ema21s[ema21s.length - 1] : null;
                result.rsi = rsiS.length > 0 ? rsiS[rsiS.length - 1] : null;
                result.price = closes[closes.length - 1];
                result.emaSpread = result.ema9 && result.ema21 ?
                    ((result.ema9 - result.ema21) / result.ema21 * 100).toFixed(3) : null;

                // Calculate recent volatility
                const atr = this._calculateATR(candles.slice(-14));
                result.atr = atr;
                result.atrPercent = atr && result.price ? ((atr / result.price) * 100).toFixed(2) : null;

                // Volume analysis
                const volumes = candles.slice(-20).map(c => c.v);
                const avgVol = volumes.reduce((a, b) => a + b, 0) / volumes.length;
                result.volumeRatio = candles[candles.length - 1].v / avgVol;
            }
        } catch (e) {
            console.warn('Error capturing indicators:', e);
        }

        return result;
    },

    _calculateATR(candles) {
        if (!candles || candles.length < 2) return 0;
        let sum = 0;
        for (let i = 1; i < candles.length; i++) {
            const tr = Math.max(
                candles[i].h - candles[i].l,
                Math.abs(candles[i].h - candles[i - 1].c),
                Math.abs(candles[i].l - candles[i - 1].c)
            );
            sum += tr;
        }
        return sum / (candles.length - 1);
    },

    _verifyPrediction(trade) {
        // Find matching prediction
        const predictions = JSON.parse(localStorage.getItem('tp_predictions') || '[]');
        const prediction = predictions.find(p =>
            p.symbol === trade.symbol &&
            !p.verified &&
            Math.abs(new Date(p.timestamp) - new Date(trade.timestamp)) < 60000 // Within 1 minute
        );

        if (!prediction) return null;

        // Calculate prediction accuracy
        const actualMove = trade.direction === 'LONG' ?
            (trade.exitPrice - trade.entry) / trade.entry * 100 :
            (trade.entry - trade.exitPrice) / trade.entry * 100;

        const predictedTpMove = trade.direction === 'LONG' ?
            (prediction.tp - prediction.entryPrice) / prediction.entryPrice * 100 :
            (prediction.entryPrice - prediction.tp) / prediction.entryPrice * 100;

        const accuracy = {
            predictionId: prediction.id,
            symbol: prediction.symbol,
            direction: prediction.direction,
            predictedConfidence: prediction.confidence,
            predictedTpMove: predictedTpMove,
            actualMove: actualMove,
            hitTp: trade.reason === 'TP Hit',
            hitSl: trade.reason === 'SL Hit',
            pnl: trade.pnl,
            success: trade.pnl > 0,
            moveAccuracy: Math.max(0, 100 - Math.abs(predictedTpMove - actualMove) * 10),
            indicators: prediction.indicators,
            verifiedAt: new Date().toISOString()
        };

        // Mark prediction as verified
        prediction.verified = true;
        prediction.result = accuracy;
        localStorage.setItem('tp_predictions', JSON.stringify(predictions));

        // Feed back to LearningEngine
        if (typeof LearningEngine !== 'undefined' && LearningEngine.recordPrediction) {
            LearningEngine.recordPrediction(accuracy);
        }

        // Store prediction accuracy stats
        this._updatePredictionStats(accuracy);

        return accuracy;
    },

    _updatePredictionStats(accuracy) {
        try {
            const stats = JSON.parse(localStorage.getItem('tp_prediction_stats') || '{"total":0,"correct":0,"avgAccuracy":0}');
            stats.total++;
            if (accuracy.success) stats.correct++;
            stats.avgAccuracy = ((stats.avgAccuracy * (stats.total - 1)) + accuracy.moveAccuracy) / stats.total;
            stats.lastUpdate = new Date().toISOString();
            localStorage.setItem('tp_prediction_stats', JSON.stringify(stats));
        } catch (e) {
            console.warn('Error updating prediction stats:', e);
        }
    },

    getPredictionStats() {
        try {
            return JSON.parse(localStorage.getItem('tp_prediction_stats') || '{"total":0,"correct":0,"avgAccuracy":0}');
        } catch (e) {
            return { total: 0, correct: 0, avgAccuracy: 0 };
        }
    }
};
