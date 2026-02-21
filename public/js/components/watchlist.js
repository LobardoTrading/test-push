/* ========================================
   WATCHLIST v6 — All Binance Futures Symbols
   TheRealShortShady v6.0
   ======================================== */

const Watchlist = {
    _allSymbols: [],
    _tickers: {},
    _favorites: [],
    _searchQuery: '',
    _filterMode: 'favorites',
    _loaded: false,
    _FAV_KEY: 'trss_watchlist_favs',

    init() {
        this._loadFavorites();
        this._bindSearch();
        this._fetchAllData();

        // Refresh every 30 seconds
        setInterval(() => this._fetchTickers(), 30000);

        // Subscribe to state changes
        State.subscribe('symbol', () => this._updateActive());
    },

    _loadFavorites() {
        try {
            const saved = JSON.parse(localStorage.getItem(this._FAV_KEY));
            if (saved && Array.isArray(saved) && saved.length > 0) {
                this._favorites = saved;
            } else {
                this._favorites = Object.keys(CONFIG.TOKENS).slice(0, 20);
            }
        } catch (e) {
            this._favorites = Object.keys(CONFIG.TOKENS).slice(0, 20);
        }
    },

    _saveFavorites() {
        try {
            localStorage.setItem(this._FAV_KEY, JSON.stringify(this._favorites));
        } catch (e) {}
    },

    _bindSearch() {
        const input = document.getElementById('marketSearch');
        if (input) {
            input.addEventListener('input', (e) => {
                this._searchQuery = e.target.value.toUpperCase().trim();
                this.render();
            });
        }
    },

    async _fetchAllData() {
        await Promise.all([
            this._fetchSymbols(),
            this._fetchTickers()
        ]);
        this._loaded = true;
        this.render();
    },

    async _fetchSymbols() {
        try {
            const response = await fetch('https://fapi.binance.com/fapi/v1/exchangeInfo');
            const data = await response.json();

            this._allSymbols = data.symbols
                .filter(s => s.status === 'TRADING' && s.quoteAsset === 'USDT')
                .map(s => s.baseAsset);

            console.log(`📋 Watchlist: Loaded ${this._allSymbols.length} symbols`);
        } catch (e) {
            console.error('Watchlist: Failed to fetch symbols', e);
            this._allSymbols = Object.keys(CONFIG.TOKENS);
        }
    },

    async _fetchTickers() {
        try {
            const response = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr');
            const data = await response.json();

            data.forEach(t => {
                if (t.symbol.endsWith('USDT')) {
                    const base = t.symbol.replace('USDT', '');
                    this._tickers[base] = {
                        price: parseFloat(t.lastPrice),
                        change: parseFloat(t.priceChangePercent),
                        volume: parseFloat(t.quoteVolume),
                        high: parseFloat(t.highPrice),
                        low: parseFloat(t.lowPrice)
                    };
                }
            });

            // Update State.prices for compatibility
            Object.entries(this._tickers).forEach(([symbol, data]) => {
                if (!State.prices[symbol]) {
                    State.prices[symbol] = data;
                }
            });

            if (this._loaded) this.render();
        } catch (e) {
            console.error('Watchlist: Failed to fetch tickers', e);
        }
    },

    setFilter(mode) {
        this._filterMode = mode;
        this.render();
    },

    toggleFavorite(symbol) {
        const idx = this._favorites.indexOf(symbol);
        if (idx >= 0) {
            this._favorites.splice(idx, 1);
        } else {
            this._favorites.push(symbol);
        }
        this._saveFavorites();
        this.render();
    },

    selectSymbol(symbol) {
        State.set('symbol', symbol);
        State.set('analysis', null);

        if (typeof SymbolInfo !== 'undefined') SymbolInfo.update();
        if (typeof Analysis !== 'undefined') Analysis.clear();

        // Auto analyze after delay
        setTimeout(() => {
            if (typeof Trading !== 'undefined') Trading.analyze();
        }, 1500);
    },

    render() {
        const container = document.getElementById('watchlist');
        if (!container) return;

        const symbols = this._getFilteredSymbols();
        const searching = this._searchQuery.length > 0;

        container.innerHTML = `
            <div class="wl-filters">
                <button class="wl-filter ${this._filterMode === 'favorites' ? 'active' : ''}" onclick="Watchlist.setFilter('favorites')">★ Favoritos</button>
                <button class="wl-filter ${this._filterMode === 'gainers' ? 'active' : ''}" onclick="Watchlist.setFilter('gainers')">📈 Top</button>
                <button class="wl-filter ${this._filterMode === 'losers' ? 'active' : ''}" onclick="Watchlist.setFilter('losers')">📉 Bottom</button>
                <button class="wl-filter ${this._filterMode === 'all' ? 'active' : ''}" onclick="Watchlist.setFilter('all')">All</button>
            </div>
            <div class="wl-count">${symbols.length} ${searching ? 'resultados' : 'pares'}</div>
            <div class="wl-list">
                ${symbols.length === 0 ? this._renderEmpty() : symbols.map(s => this._renderItem(s)).join('')}
            </div>
        `;
    },

    _getFilteredSymbols() {
        let list = [];
        const searching = this._searchQuery.length > 0;

        if (searching) {
            list = this._allSymbols.filter(s => s.includes(this._searchQuery));
        } else if (this._filterMode === 'favorites') {
            list = this._favorites;
        } else if (this._filterMode === 'all') {
            list = this._allSymbols.slice(0, 100);
        } else if (this._filterMode === 'gainers') {
            list = Object.entries(this._tickers)
                .sort((a, b) => b[1].change - a[1].change)
                .slice(0, 30)
                .map(([s]) => s);
        } else if (this._filterMode === 'losers') {
            list = Object.entries(this._tickers)
                .sort((a, b) => a[1].change - b[1].change)
                .slice(0, 30)
                .map(([s]) => s);
        }

        return list;
    },

    _renderItem(symbol) {
        const ticker = this._tickers[symbol] || State.prices[symbol] || {};
        const isActive = symbol === State.symbol;
        const isFav = this._favorites.includes(symbol);
        const change = ticker.change || 0;
        const isUp = change >= 0;

        return `
            <div class="wl-item ${isActive ? 'active' : ''}" onclick="Watchlist.selectSymbol('${symbol}')">
                <button class="wl-fav ${isFav ? 'active' : ''}"
                        onclick="event.stopPropagation(); Watchlist.toggleFavorite('${symbol}')">
                    ${isFav ? '★' : '☆'}
                </button>
                <div class="wl-symbol">${symbol}</div>
                <div class="wl-data">
                    <div class="wl-price">$${Utils.formatPrice(ticker.price || 0)}</div>
                    <div class="wl-change ${isUp ? 'up' : 'down'}">
                        ${isUp ? '+' : ''}${change.toFixed(2)}%
                    </div>
                </div>
            </div>
        `;
    },

    _renderEmpty() {
        if (this._searchQuery) {
            return `<div class="wl-empty">No se encontró "${this._searchQuery}"</div>`;
        }
        return `<div class="wl-empty">${this._loaded ? 'Sin monedas' : 'Cargando...'}</div>`;
    },

    _updateActive() {
        document.querySelectorAll('.wl-item').forEach(item => {
            const symbol = item.querySelector('.wl-symbol')?.textContent;
            item.classList.toggle('active', symbol === State.symbol);
        });
    },

    // Share data with other components
    getAllSymbols() {
        return this._allSymbols;
    },

    getTicker(symbol) {
        return this._tickers[symbol];
    }
};
