/* ========================================
   STATE - Global Application State
   Trading Platform PRO v2.0
   ======================================== */

const State = {

    // ==========================================
    //  CURRENT SELECTIONS
    // ==========================================
    symbol: 'BTC',
    mode: 'intraday',
    timeframe: '15m',

    // ==========================================
    //  MARKET DATA
    // ==========================================
    prices: {},
    candles: [],

    // ==========================================
    //  TRADING STATE
    // ==========================================
    analysis: null,
    positions: [],
    balance: CONFIG.TRADING.DEFAULT_BALANCE,
    maxPositions: CONFIG.TRADING.MAX_POSITIONS,

    // ==========================================
    //  UI STATE
    // ==========================================
    isConnected: false,
    isAnalyzing: false,
    lastUpdate: null,

    // ==========================================
    //  INTERNALS
    // ==========================================
    _listeners: {},
    _saveTimeout: null,
    _positionCheckInterval: null,
    _storageAvailable: null,

    // ==========================================
    //  INITIALIZATION
    // ==========================================

    /** Inicializar state desde localStorage */
    init() {
        // Verificar disponibilidad de localStorage una sola vez
        this._storageAvailable = this._checkStorage();

        if (!this._storageAvailable) {
            console.warn('localStorage no disponible - datos no persistirán');
        }

        // Cargar balance
        const savedBalance = this._load(CONFIG.STORAGE.BALANCE);
        if (savedBalance !== null) {
            const parsed = parseFloat(savedBalance);
            if (!isNaN(parsed) && parsed >= 0 && parsed <= 1e9) {
                this.balance = parsed;
            }
        }

        // Cargar posiciones
        const savedPositions = this._load(CONFIG.STORAGE.POSITIONS);
        if (savedPositions !== null) {
            const parsed = Utils.safeJsonParse(savedPositions, []);
            if (Array.isArray(parsed)) {
                // Validar cada posición
                this.positions = parsed.filter(p => this._validatePosition(p));
            }
        }

        // Cargar último símbolo y modo seleccionado
        const savedSymbol = this._load('tp_symbol');
        if (savedSymbol && CONFIG.TOKENS[savedSymbol]) {
            this.symbol = savedSymbol;
        }

        const savedMode = this._load('tp_mode');
        if (savedMode && CONFIG.MODES[savedMode]) {
            this.mode = savedMode;
        }

        const savedTimeframe = this._load('tp_timeframe');
        if (savedTimeframe) {
            this.timeframe = savedTimeframe;
        }

        const savedMaxPos = this._load('tp_maxPositions');
        if (savedMaxPos) {
            const parsed = parseInt(savedMaxPos);
            if (!isNaN(parsed) && parsed >= 1 && parsed <= 10) {
                this.maxPositions = parsed;
            }
        }

        // Iniciar monitoreo de posiciones (TP/SL check)
        this._startPositionMonitor();
    },

    // ==========================================
    //  STORAGE (safe localStorage wrapper)
    // ==========================================

    /** Verificar si localStorage está disponible */
    _checkStorage() {
        try {
            const test = '__storage_test__';
            localStorage.setItem(test, '1');
            localStorage.removeItem(test);
            return true;
        } catch (e) {
            return false;
        }
    },

    /** Leer de localStorage con protección */
    _load(key) {
        if (!this._storageAvailable) return null;
        try {
            return localStorage.getItem(key);
        } catch (e) {
            console.error(`Error leyendo ${key}:`, e);
            return null;
        }
    },

    /** Escribir a localStorage con protección */
    _store(key, value) {
        if (!this._storageAvailable) return false;
        try {
            localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
            return true;
        } catch (e) {
            // localStorage lleno o no disponible
            if (e.name === 'QuotaExceededError') {
                console.error('localStorage lleno - limpiando historial antiguo');
                this._cleanupStorage();
                try {
                    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
                    return true;
                } catch (e2) {
                    return false;
                }
            }
            console.error(`Error guardando ${key}:`, e);
            return false;
        }
    },

    /** Limpiar datos antiguos si localStorage está lleno */
    _cleanupStorage() {
        try {
            const historyKey = CONFIG.STORAGE.HISTORY || 'tp_history';
            const history = Utils.safeJsonParse(localStorage.getItem(historyKey), []);
            if (history.length > 100) {
                localStorage.setItem(historyKey, JSON.stringify(history.slice(-100)));
            }
        } catch (e) {
            // No hay nada más que hacer
        }
    },

    // ==========================================
    //  PERSISTENCE
    // ==========================================

    /** Guardar estado crítico (debounced) */
    save() {
        // Debounce para no escribir en cada tick
        if (this._saveTimeout) clearTimeout(this._saveTimeout);
        this._saveTimeout = setTimeout(() => {
            this._store(CONFIG.STORAGE.BALANCE, this.balance.toString());
            this._store(CONFIG.STORAGE.POSITIONS, JSON.stringify(this.positions));
            this._store('tp_symbol', this.symbol);
            this._store('tp_mode', this.mode);
            this._store('tp_timeframe', this.timeframe);
        }, 300);
    },

    /** Forzar guardado inmediato (para antes de cerrar pestaña) */
    saveImmediate() {
        if (this._saveTimeout) clearTimeout(this._saveTimeout);
        this._store(CONFIG.STORAGE.BALANCE, this.balance.toString());
        this._store(CONFIG.STORAGE.POSITIONS, JSON.stringify(this.positions));
    },

    // ==========================================
    //  STATE MANAGEMENT
    // ==========================================

    /** Set state y notificar listeners */
    set(key, value) {
        const oldValue = this[key];
        this[key] = value;
        this._notify(key, value, oldValue);

        // Auto-save en cambios de selección
        if (['symbol', 'mode', 'timeframe'].includes(key)) {
            this.save();
        }
    },

    /** Subscribe a cambios de state */
    subscribe(key, callback) {
        if (!this._listeners[key]) {
            this._listeners[key] = [];
        }
        this._listeners[key].push(callback);
        // Return unsubscribe function
        return () => {
            this._listeners[key] = this._listeners[key].filter(cb => cb !== callback);
        };
    },

    /** Notificar listeners */
    _notify(key, newValue, oldValue) {
        const listeners = this._listeners[key];
        if (!listeners || listeners.length === 0) return;
        for (const callback of listeners) {
            try {
                callback(newValue, oldValue);
            } catch (e) {
                console.error(`State listener error [${key}]:`, e);
            }
        }
    },

    // ==========================================
    //  GETTERS
    // ==========================================

    /** Config del modo actual */
    getModeConfig() {
        return CONFIG.MODES[this.mode] || CONFIG.MODES.intraday;
    },

    /** Info del token */
    getTokenInfo(symbol = null) {
        const s = symbol || this.symbol;
        return CONFIG.TOKENS[s] || { name: s, grade: 'B', sector: 'Unknown', maxLev: 50 };
    },

    /** Precio actual del símbolo seleccionado */
    getCurrentPrice() {
        return this.prices[this.symbol]?.price || 0;
    },

    /** Cambio 24h del símbolo seleccionado */
    getChange() {
        return this.prices[this.symbol]?.change || 0;
    },

    /** Volumen 24h */
    getVolume() {
        return this.prices[this.symbol]?.volume || 0;
    },

    /** High/Low 24h */
    get24hRange() {
        const data = this.prices[this.symbol];
        return {
            high: data?.high24h || 0,
            low: data?.low24h || 0
        };
    },

    /** PnL total de posiciones abiertas */
    getOpenPnL() {
        return this.positions.reduce((total, pos) => {
            const price = this.prices[pos.symbol]?.price || pos.entry;
            // FIX: Solo restamos exit fee estimada (entry fee ya descontada del balance)
            const exitFee = pos.fee;
            if (pos.direction === 'LONG') {
                return total + ((price - pos.entry) / pos.entry) * pos.size - exitFee;
            } else {
                return total + ((pos.entry - price) / pos.entry) * pos.size - exitFee;
            }
        }, 0);
    },

    /** Equity = Balance + PnL abierto */
    getEquity() {
        return this.balance + this.getOpenPnL();
    },

    /** Margin usado */
    getUsedMargin() {
        return this.positions.reduce((total, pos) => total + pos.margin, 0);
    },

    /** Margin disponible */
    getAvailableMargin() {
        return Math.max(0, this.balance - this.getUsedMargin());
    },

    // ==========================================
    //  MARKET DATA UPDATES
    // ==========================================

    /** Actualizar precios */
    updatePrices(prices) {
        this.prices = prices;
        this.lastUpdate = new Date();
        this.set('isConnected', true);
        this._notify('prices', prices);
        // Chequear TP/SL en cada update de precios
        this._checkPositionLimits();
    },

    /** Actualizar velas */
    updateCandles(candles) {
        if (!Array.isArray(candles) || candles.length === 0) return;
        this.candles = candles;
        this._notify('candles', candles);
    },

    // ==========================================
    //  POSITION MANAGEMENT
    // ==========================================

    /** Agregar posición con validación */
    addPosition(position) {
        if (!this._validatePosition(position)) {
            console.error('Posición inválida:', position);
            return false;
        }
        this.positions.push(position);
        this.save();
        this._notify('positions', this.positions);
        return true;
    },

    /** Remover posición */
    removePosition(id) {
        const before = this.positions.length;
        this.positions = this.positions.filter(p => p.id !== id);
        if (this.positions.length !== before) {
            this.save();
            this._notify('positions', this.positions);
            return true;
        }
        return false;
    },

    /** Validar estructura de posición */
    _validatePosition(pos) {
        if (!pos || typeof pos !== 'object') return false;
        if (!pos.id || typeof pos.id !== 'string') return false;
        if (!pos.symbol || typeof pos.symbol !== 'string') return false;
        if (!['LONG', 'SHORT'].includes(pos.direction)) return false;
        if (typeof pos.entry !== 'number' || pos.entry <= 0) return false;
        if (typeof pos.size !== 'number' || pos.size <= 0) return false;
        if (typeof pos.margin !== 'number' || pos.margin <= 0) return false;
        if (typeof pos.leverage !== 'number' || pos.leverage < 1) return false;
        return true;
    },

    // ==========================================
    //  TP/SL AUTO-MONITORING
    // ==========================================

    /** Iniciar monitoreo de posiciones */
    _startPositionMonitor() {
        // Chequear cada 2 segundos
        if (this._positionCheckInterval) clearInterval(this._positionCheckInterval);
        this._positionCheckInterval = setInterval(() => {
            this._checkPositionLimits();
        }, 2000);
    },

    /** Chequear si alguna posición tocó TP, SL o Liquidación */
    _checkPositionLimits() {
        if (this.positions.length === 0) return;

        // Copiar array para iterar seguro
        const toClose = [];

        for (const pos of this.positions) {
            const price = this.prices[pos.symbol]?.price;
            if (!price) continue;

            if (pos.direction === 'LONG') {
                if (pos.tp && price >= pos.tp) {
                    toClose.push({ id: pos.id, reason: 'Take Profit ✅' });
                } else if (pos.sl && price <= pos.sl) {
                    toClose.push({ id: pos.id, reason: 'Stop Loss 🛑' });
                } else if (pos.liq && price <= pos.liq) {
                    toClose.push({ id: pos.id, reason: 'Liquidación ⚠️' });
                }
            } else {
                if (pos.tp && price <= pos.tp) {
                    toClose.push({ id: pos.id, reason: 'Take Profit ✅' });
                } else if (pos.sl && price >= pos.sl) {
                    toClose.push({ id: pos.id, reason: 'Stop Loss 🛑' });
                } else if (pos.liq && price >= pos.liq) {
                    toClose.push({ id: pos.id, reason: 'Liquidación ⚠️' });
                }
            }
        }

        // Cerrar posiciones que tocaron límite
        for (const { id, reason } of toClose) {
            if (typeof Trading !== 'undefined' && Trading.closePosition) {
                Trading.closePosition(id, reason);
            }
        }
    },

    // ==========================================
    //  BALANCE MANAGEMENT
    // ==========================================

    /** Actualizar balance con protección */
    updateBalance(amount) {
        if (isNaN(amount)) return;
        this.balance += amount;
        // Protección: balance nunca negativo
        if (this.balance < 0) this.balance = 0;
        this.save();
        this._notify('balance', this.balance);
    },

    /** Set balance absoluto */
    setBalance(balance) {
        if (isNaN(balance) || balance < 0) return;
        this.balance = balance;
        this.save();
        this._notify('balance', this.balance);
    },

    // ==========================================
    //  RESET
    // ==========================================

    /** Reset completo */
    reset() {
        this.balance = CONFIG.TRADING.DEFAULT_BALANCE;
        this.positions = [];
        this.analysis = null;
        this.save();
        this._notify('balance', this.balance);
        this._notify('positions', this.positions);
        this._notify('analysis', null);
        Utils.showNotification(' Estado reseteado', 'info');
    },

    /** Export state para debug/backup */
    exportState() {
        return {
            balance: this.balance,
            positions: this.positions,
            symbol: this.symbol,
            mode: this.mode,
            timeframe: this.timeframe,
            history: Trading?.getHistory?.() || [],
            exportedAt: new Date().toISOString()
        };
    },

    /** Import state desde backup */
    importState(data) {
        if (!data || typeof data !== 'object') return false;
        if (typeof data.balance === 'number' && data.balance >= 0) {
            this.balance = data.balance;
        }
        if (Array.isArray(data.positions)) {
            this.positions = data.positions.filter(p => this._validatePosition(p));
        }
        if (data.symbol && CONFIG.TOKENS[data.symbol]) {
            this.symbol = data.symbol;
        }
        if (data.mode && CONFIG.MODES[data.mode]) {
            this.mode = data.mode;
        }
        this.save();
        this._notify('balance', this.balance);
        this._notify('positions', this.positions);
        Utils.showNotification(' Estado importado correctamente', 'success');
        return true;
    }
};

// Inicializar state
State.init();

// Guardar antes de cerrar pestaña
window.addEventListener('beforeunload', () => State.saveImmediate());
