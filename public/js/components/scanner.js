/**
 * Scanner — Volatility & New Pairs Scanner
 * Fetches all Binance Futures pairs and identifies opportunities
 */
const Scanner = {
    _allSymbols: [],
    _volatilityData: [],
    _newPairs: [],
    _lastScan: 0,
    _SCAN_INTERVAL: 60000, // 1 minute
    _initialized: false,

    async init() {
        if (this._initialized) return;
        this._initialized = true;

        console.log('🔍 Scanner: Initializing...');

        // Fetch all Binance Futures symbols
        await this._fetchAllSymbols();

        // Initial scan
        await this.refresh();

        // Auto-refresh
        setInterval(() => this.refresh(), this._SCAN_INTERVAL);

        // Bind sidebar tabs
        this._bindSidebarTabs();

        console.log(`🔍 Scanner: Initialized with ${this._allSymbols.length} symbols`);
    },

    async _fetchAllSymbols() {
        try {
            const response = await fetch('https://fapi.binance.com/fapi/v1/exchangeInfo');
            const data = await response.json();

            this._allSymbols = data.symbols
                .filter(s => s.status === 'TRADING' && s.quoteAsset === 'USDT')
                .map(s => ({
                    symbol: s.symbol,
                    baseAsset: s.baseAsset,
                    onboardDate: s.onboardDate || 0,
                    pricePrecision: s.pricePrecision,
                    quantityPrecision: s.quantityPrecision
                }));

            // Update CONFIG.TOKENS dynamically
            this._updateConfigTokens();

        } catch (e) {
            console.error('Scanner: Failed to fetch symbols', e);
        }
    },

    _updateConfigTokens() {
        // Add new symbols to CONFIG.TOKENS if not present
        this._allSymbols.forEach(s => {
            const base = s.baseAsset;
            if (!CONFIG.TOKENS[base]) {
                CONFIG.TOKENS[base] = {
                    name: base,
                    grade: 'C',
                    sector: 'Unknown',
                    maxLev: 20
                };
            }
        });
    },

    async refresh() {
        const now = Date.now();
        if (now - this._lastScan < 10000) return; // Throttle
        this._lastScan = now;

        await Promise.all([
            this._scanVolatility(),
            this._scanNewPairs()
        ]);

        this.render();
    },

    async _scanVolatility() {
        try {
            // Get 24h ticker for all symbols
            const response = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr');
            const tickers = await response.json();

            // Calculate volatility score
            this._volatilityData = tickers
                .filter(t => t.symbol.endsWith('USDT'))
                .map(t => ({
                    symbol: t.symbol,
                    price: parseFloat(t.lastPrice),
                    change: parseFloat(t.priceChangePercent),
                    volume: parseFloat(t.quoteVolume),
                    high: parseFloat(t.highPrice),
                    low: parseFloat(t.lowPrice),
                    volatility: this._calcVolatility(t)
                }))
                .filter(t => t.volume > 1000000) // Min $1M volume
                .sort((a, b) => b.volatility - a.volatility)
                .slice(0, 20);

        } catch (e) {
            console.error('Scanner: Volatility scan failed', e);
        }
    },

    _calcVolatility(ticker) {
        const high = parseFloat(ticker.highPrice);
        const low = parseFloat(ticker.lowPrice);
        const price = parseFloat(ticker.lastPrice);
        const change = Math.abs(parseFloat(ticker.priceChangePercent));

        // Volatility = (High-Low range) + absolute change
        const range = ((high - low) / price) * 100;
        return range + change;
    },

    async _scanNewPairs() {
        const now = Date.now();
        const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);

        // Find pairs listed in last 30 days
        this._newPairs = this._allSymbols
            .filter(s => s.onboardDate > thirtyDaysAgo)
            .sort((a, b) => b.onboardDate - a.onboardDate)
            .slice(0, 10);

        // Get prices for new pairs
        if (this._newPairs.length > 0) {
            try {
                const symbols = this._newPairs.map(p => p.symbol);
                const response = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr');
                const tickers = await response.json();

                this._newPairs = this._newPairs.map(p => {
                    const ticker = tickers.find(t => t.symbol === p.symbol);
                    return {
                        ...p,
                        price: ticker ? parseFloat(ticker.lastPrice) : 0,
                        change: ticker ? parseFloat(ticker.priceChangePercent) : 0,
                        volume: ticker ? parseFloat(ticker.quoteVolume) : 0
                    };
                });
            } catch (e) {
                console.error('Scanner: New pairs price fetch failed', e);
            }
        }
    },

    render() {
        this._renderVolatility();
        this._renderNewPairs();
    },

    _renderVolatility() {
        const container = document.getElementById('scannerVolatility');
        if (!container) return;

        if (this._volatilityData.length === 0) {
            container.innerHTML = '<div class="scanner-empty">Escaneando...</div>';
            return;
        }

        container.innerHTML = this._volatilityData.slice(0, 10).map(item => `
            <div class="scanner-item" onclick="Scanner.selectSymbol('${item.symbol}')">
                <div>
                    <div class="scanner-item-symbol">${item.symbol.replace('USDT', '')}</div>
                    <div class="scanner-item-vol">Vol: $${this._formatVolume(item.volume)}</div>
                </div>
                <div>
                    <div class="scanner-item-change ${item.change >= 0 ? 'up' : 'down'}">
                        ${item.change >= 0 ? '+' : ''}${item.change.toFixed(2)}%
                    </div>
                    <div class="scanner-item-vol">Rango: ${item.volatility.toFixed(1)}%</div>
                </div>
            </div>
        `).join('');
    },

    _renderNewPairs() {
        const container = document.getElementById('scannerNew');
        if (!container) return;

        if (this._newPairs.length === 0) {
            container.innerHTML = '<div class="scanner-empty">Sin pares nuevos</div>';
            return;
        }

        container.innerHTML = this._newPairs.map(item => {
            const daysAgo = Math.floor((Date.now() - item.onboardDate) / (24 * 60 * 60 * 1000));
            return `
                <div class="scanner-item" onclick="Scanner.selectSymbol('${item.symbol}')">
                    <div>
                        <div class="scanner-item-symbol">${item.baseAsset}</div>
                        <div class="scanner-item-vol">Hace ${daysAgo}d</div>
                    </div>
                    <div>
                        <div class="scanner-item-change ${item.change >= 0 ? 'up' : 'down'}">
                            ${item.change >= 0 ? '+' : ''}${item.change.toFixed(2)}%
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    },

    selectSymbol(symbol) {
        const base = symbol.replace('USDT', '');
        State.set('symbol', base);
        Utils.showNotification(`Seleccionado: ${symbol}`, 'info', 2000);
    },

    _formatVolume(vol) {
        if (vol >= 1e9) return (vol / 1e9).toFixed(1) + 'B';
        if (vol >= 1e6) return (vol / 1e6).toFixed(1) + 'M';
        if (vol >= 1e3) return (vol / 1e3).toFixed(1) + 'K';
        return vol.toFixed(0);
    },

    _bindSidebarTabs() {
        // Only bind to left sidebar tabs
        const leftSidebar = document.querySelector('.sidebar-left');
        if (!leftSidebar) return;

        leftSidebar.querySelectorAll('.sidebar-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const tabName = tab.dataset.tab;

                // Update tabs
                leftSidebar.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                // Update content
                leftSidebar.querySelectorAll('.sidebar-content').forEach(c => c.classList.remove('active'));
                const content = document.getElementById(`sidebar-${tabName}`);
                if (content) content.classList.add('active');

                // Refresh scanner when switching to it
                if (tabName === 'scanner') {
                    this.refresh();
                }
            });
        });
    },

    // Get high volatility opportunities for LAB
    getOpportunities(minVolatility = 10) {
        return this._volatilityData.filter(v => v.volatility >= minVolatility);
    },

    // Get all tradeable symbols
    getAllSymbols() {
        return this._allSymbols;
    }
};

// Initialized by App.init()
