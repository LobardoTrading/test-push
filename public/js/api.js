/* ========================================
   API - API Client Module
   Trading Platform PRO v3.0
   ======================================== */

const API = {

    // Global concurrency limiter — prevents browser connection saturation
    _queue: [],
    _activeRequests: 0,
    _MAX_CONCURRENT: 2, // Browser allows ~6, but we reserve 4 for prices/candles/UI

    async _enqueue(fn) {
        if (this._activeRequests < this._MAX_CONCURRENT) {
            this._activeRequests++;
            try { return await fn(); }
            finally { this._activeRequests--; this._processQueue(); }
        }
        // Queue the request
        return new Promise((resolve, reject) => {
            this._queue.push({ fn, resolve, reject });
        });
    },

    _processQueue() {
        while (this._queue.length > 0 && this._activeRequests < this._MAX_CONCURRENT) {
            const { fn, resolve, reject } = this._queue.shift();
            this._activeRequests++;
            fn().then(resolve).catch(reject).finally(() => {
                this._activeRequests--;
                this._processQueue();
            });
        }
    },

    /** Flush pending queued requests (e.g. on symbol change) */
    clearQueue() {
        const pending = this._queue.length;
        this._queue.forEach(({ reject }) => reject(new Error('Queue cleared')));
        this._queue = [];
        if (pending > 0) console.log(`🔄 API queue cleared: ${pending} stale requests dropped`);
    },

    /** Fetch con timeout y retry */
    async _fetch(url, options = {}, retries = 2) {
        const timeout = options.timeout || 8000;

        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), timeout);

                const response = await fetch(url, {
                    ...options,
                    signal: controller.signal
                });
                clearTimeout(timer);

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(errorData.error || `HTTP ${response.status}`);
                }

                return await response.json();

            } catch (error) {
                const isLast = attempt === retries;
                const isAbort = error.name === 'AbortError';

                if (isLast) {
                    throw new Error(isAbort ? 'Timeout - Binance no responde' : error.message);
                }

                const delay = Math.min(1000 * Math.pow(2, attempt), 4000);
                await new Promise(r => setTimeout(r, delay));
            }
        }
    },

    /** Fetch prices */
    async getPrices() {
        return this._fetch(CONFIG.API.PRICES);
    },

    /** Fetch candles */
    async getKlines(symbol, interval = '15m', limit = 100) {
        const url = `${CONFIG.API.KLINES}?symbol=${symbol}&interval=${interval}&limit=${limit}`;
        return this._fetch(url);
    },

    /** Run analysis */
    async analyze(symbol, direction, leverage, interval) {
        return this._enqueue(() => this._fetch(CONFIG.API.ANALYZE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ symbol, direction, leverage, interval }),
            timeout: 12000
        }, 0)); // No retries for analyze — faster failure, radar will retry next cycle
    }
};


/* ========================================
   DATA SERVICE - Polling & Sync
   ======================================== */

const DataService = {

    _priceInterval: null,
    _candleInterval: null,
    _running: false,
    _failCount: 0,
    _maxFails: 5,
    _fetchingPrices: false,
    _fetchingCandles: false,
    _priceRate: CONFIG.INTERVALS.PRICES,
    _candleRate: CONFIG.INTERVALS.CANDLES,

    /** Iniciar polling */
    start() {
        if (this._running) {
            console.warn('DataService ya está corriendo');
            return;
        }
        this._running = true;
        this._failCount = 0;

        // Cargar refresh rate guardado
        this._loadSavedRate();

        // Fetch inmediato
        this.fetchPrices();
        this.fetchCandles();

        // Intervals con rate configurable
        this._priceInterval = setInterval(() => this.fetchPrices(), this._priceRate);
        this._candleInterval = setInterval(() => this.fetchCandles(), this._candleRate);

        console.log(`DataService iniciado (prices: ${this._priceRate}ms, candles: ${this._candleRate}ms)`);
    },

    /** Detener polling */
    stop() {
        this._running = false;
        if (this._priceInterval) {
            clearInterval(this._priceInterval);
            this._priceInterval = null;
        }
        if (this._candleInterval) {
            clearInterval(this._candleInterval);
            this._candleInterval = null;
        }
        console.log('DataService detenido');
    },

    /** Reiniciar (útil al cambiar de símbolo/timeframe) */
    _restartTimer: null,
    
    restart() {
        // Debounce rapid restarts (e.g. clicking symbols quickly)
        if (this._restartTimer) clearTimeout(this._restartTimer);
        this.stop();
        this._restartTimer = setTimeout(() => this.start(), 400);
    },

    /** Cambiar refresh rate en caliente */
    setRefreshRate(priceMs, candleMs) {
        this._priceRate = priceMs;
        this._candleRate = candleMs;
        // Reiniciar con los nuevos intervalos
        if (this._running) {
            this.restart();
        }
        console.log(`Refresh rate: prices ${priceMs}ms, candles ${candleMs}ms`);
    },

    /** Cargar refresh rate guardado de localStorage */
    _loadSavedRate() {
        try {
            const saved = localStorage.getItem(CONFIG.STORAGE.REFRESH);
            if (saved) {
                const option = CONFIG.REFRESH_OPTIONS.find(o => o.label === saved);
                if (option) {
                    this._priceRate = option.prices;
                    this._candleRate = option.candles;
                }
            }
        } catch (e) {
            // Usar defaults
        }
    },

    /** Fetch y actualizar precios (con dedup) */
    async fetchPrices() {
        if (this._fetchingPrices) return;
        this._fetchingPrices = true;

        try {
            const data = await API.getPrices();
            // Soportar nuevo formato {data, source} y formato legacy
            const prices = data.data || data;
            State.updatePrices(prices);
            this._failCount = 0;
        } catch (error) {
            this._failCount++;
            State.set('isConnected', false);

            if (this._failCount === 1) {
                Utils.showNotification('📡 Error de conexión - Reintentando...', 'warning');
            } else if (this._failCount >= this._maxFails) {
                Utils.showNotification('📡 Conexión perdida - Verificá tu internet', 'error');
                this.stop();
                setTimeout(() => {
                    this._failCount = 0;
                    this.start();
                }, 15000);
            }
        } finally {
            this._fetchingPrices = false;
        }
    },

    /** Fetch y actualizar velas (con dedup) */
    async fetchCandles() {
        if (this._fetchingCandles) return;
        this._fetchingCandles = true;

        try {
            const candles = await API.getKlines(State.symbol, State.timeframe);
            State.updateCandles(candles);
        } catch (error) {
            console.error('Candle fetch error:', error.message);
        } finally {
            this._fetchingCandles = false;
        }
    }
};
