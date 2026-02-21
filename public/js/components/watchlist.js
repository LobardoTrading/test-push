/* ========================================
   WATCHLIST v5 — Full Binance Futures Search
   + Favorites + Filters + Big Opportunities
   TheRealShortShady v4.3
   ======================================== */

const Watchlist = {

    _prevPrices: {},
    _allSymbols: [],          // All Binance Futures symbols cached
    _allSymbolsLoaded: false,
    _favorites: [],           // User pinned symbols
    _searchQuery: '',
    _sortBy: 'volume',
    _sortDir: 'desc',
    _filterMode: 'favorites', // favorites | all | gainers | losers | volatile | hot
    _selectTimeout: null,
    _searchTimeout: null,
    _allPricesInterval: null,
    _FAV_KEY: 'trss_watchlist_favs',

    init() {
        this._loadFavorites();
        this.render();
        this.subscribeToState();
        setTimeout(() => this._fetchAllSymbols(), 3000);
        this._allPricesInterval = setInterval(() => this._fetchAllSymbols(), 60000);
    },

    _loadFavorites() {
        try {
            const saved = JSON.parse(localStorage.getItem(this._FAV_KEY));
            if (saved && Array.isArray(saved) && saved.length > 0) {
                this._favorites = saved;
            } else {
                this._favorites = Object.keys(CONFIG.TOKENS);
            }
        } catch (e) {
            this._favorites = Object.keys(CONFIG.TOKENS);
        }
    },

    _saveFavorites() {
        try { localStorage.setItem(this._FAV_KEY, JSON.stringify(this._favorites)); } catch (e) { }
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

    async _fetchAllSymbols() {
        try {
            const resp = await fetch('/api/prices?scope=all');
            if (!resp.ok) return;
            const data = await resp.json();
            if (data && typeof data === 'object' && !data.error) {
                this._allSymbols = Object.entries(data).map(([symbol, info]) => ({
                    symbol, ...info
                }));
                this._allSymbolsLoaded = true;
                if (this._filterMode !== 'favorites' || this._searchQuery) {
                    this.render();
                }
                // Update search placeholder count
                const input = document.getElementById('wlSearch');
                if (input) input.placeholder = `Buscar... (${this._allSymbols.length} pares)`;
            }
        } catch (e) {
            console.warn('Watchlist: fetch all failed', e);
        }
    },

    setFilter(mode) {
        this._filterMode = mode;
        this._searchQuery = '';
        const input = document.getElementById('wlSearch');
        if (input) input.value = '';
        this.render();
    },

    onSearch(query) {
        this._searchQuery = query.toUpperCase().trim();
        if (this._searchTimeout) clearTimeout(this._searchTimeout);
        this._searchTimeout = setTimeout(() => {
            if (this._searchQuery && !this._allSymbolsLoaded) this._fetchAllSymbols();
            this.render();
        }, 150);
    },

    clearSearch() {
        this._searchQuery = '';
        const input = document.getElementById('wlSearch');
        if (input) input.value = '';
        this.render();
    },

    render() {
        const container = document.getElementById('watchlist');
        if (!container) return;

        const symbols = this._getFilteredSymbols();
        const searching = this._searchQuery.length > 0;
        const fm = this._filterMode;

        container.innerHTML = `
            <div class="wl-toolbar">
                <div class="wl-search-wrap">
                    <span class="wl-search-icon">🔍</span>
                    <input type="text" id="wlSearch" class="wl-search"
                           placeholder="Buscar... (${this._allSymbols.length || '...'} pares)"
                           value="${this._searchQuery}"
                           oninput="Watchlist.onSearch(this.value)"
                           autocomplete="off" spellcheck="false">
                    ${this._searchQuery ? '<button class="wl-search-clear" onclick="Watchlist.clearSearch()">✕</button>' : ''}
                </div>
                <div class="wl-filters">
                    <button class="wl-filter ${fm === 'favorites' && !searching ? 'active' : ''}" onclick="Watchlist.setFilter('favorites')">⭐</button>
                    <button class="wl-filter ${fm === 'hot' && !searching ? 'active' : ''}" onclick="Watchlist.setFilter('hot')">🔥</button>
                    <button class="wl-filter ${fm === 'gainers' && !searching ? 'active' : ''}" onclick="Watchlist.setFilter('gainers')">📈</button>
                    <button class="wl-filter ${fm === 'losers' && !searching ? 'active' : ''}" onclick="Watchlist.setFilter('losers')">📉</button>
                    <button class="wl-filter ${fm === 'volatile' && !searching ? 'active' : ''}" onclick="Watchlist.setFilter('volatile')">⚡</button>
                    <button class="wl-filter ${fm === 'all' && !searching ? 'active' : ''}" onclick="Watchlist.setFilter('all')">ALL</button>
                </div>
            </div>
            <div class="wl-list" id="wlList">
                ${symbols.length === 0 ? this._renderEmpty(searching) : symbols.map(s => this._renderItem(s)).join('')}
            </div>
        `;

        if (searching) {
            const input = document.getElementById('wlSearch');
            if (input) { input.focus(); input.selectionStart = input.selectionEnd = input.value.length; }
        }
    },

    _getFilteredSymbols() {
        let list = [];
        const coreKeys = Object.keys(CONFIG.TOKENS);
        const searching = this._searchQuery.length > 0;

        if (searching) {
            const q = this._searchQuery;
            const coreMatches = coreKeys
                .filter(s => s.includes(q) || (CONFIG.TOKENS[s]?.name || '').toUpperCase().includes(q))
                .map(s => this._buildItem(s, State.prices[s], true));

            if (this._allSymbolsLoaded) {
                const allMatches = this._allSymbols
                    .filter(s => s.symbol.includes(q) && !coreKeys.includes(s.symbol))
                    .slice(0, 50)
                    .map(s => this._buildItem(s.symbol, s, false));
                list = [...coreMatches, ...allMatches];
            } else {
                list = coreMatches;
            }
        } else if (this._filterMode === 'favorites') {
            list = this._favorites.map(s => {
                const price = State.prices[s] || this._allSymbols.find(a => a.symbol === s);
                return this._buildItem(s, price, coreKeys.includes(s));
            });
        } else if (this._filterMode === 'all' && this._allSymbolsLoaded) {
            list = this._allSymbols.slice(0, 100).map(s => this._buildItem(s.symbol, s, coreKeys.includes(s.symbol)));
        } else if (this._filterMode === 'gainers' && this._allSymbolsLoaded) {
            list = [...this._allSymbols].sort((a, b) => b.change - a.change).slice(0, 30)
                .map(s => this._buildItem(s.symbol, s, coreKeys.includes(s.symbol)));
        } else if (this._filterMode === 'losers' && this._allSymbolsLoaded) {
            list = [...this._allSymbols].sort((a, b) => a.change - b.change).slice(0, 30)
                .map(s => this._buildItem(s.symbol, s, coreKeys.includes(s.symbol)));
        } else if (this._filterMode === 'volatile' && this._allSymbolsLoaded) {
            list = [...this._allSymbols].sort((a, b) => (b.volatility || 0) - (a.volatility || 0)).slice(0, 30)
                .map(s => this._buildItem(s.symbol, s, coreKeys.includes(s.symbol)));
        } else if (this._filterMode === 'hot' && this._allSymbolsLoaded) {
            list = [...this._allSymbols]
                .map(s => ({ ...s, hotScore: Math.abs(s.change || 0) * Math.log10(Math.max(s.volume || 1, 1)) }))
                .sort((a, b) => b.hotScore - a.hotScore).slice(0, 30)
                .map(s => this._buildItem(s.symbol, s, coreKeys.includes(s.symbol)));
        } else {
            // Fallback
            list = this._favorites.map(s => this._buildItem(s, State.prices[s], coreKeys.includes(s)));
        }

        return list;
    },

    _buildItem(symbol, data, isCore) {
        return {
            symbol,
            price: data?.price || 0,
            change: data?.change || 0,
            volume: data?.volume || 0,
            volatility: data?.volatility || 0,
            isCore,
            isFav: this._favorites.includes(symbol),
        };
    },

    _renderItem(item) {
        const isActive = item.symbol === State.symbol;
        const ch = item.change || 0;
        const isUp = ch >= 0;
        const volStr = this._fmtVol(item.volume);
        const searching = this._searchQuery.length > 0;
        const showingAll = this._filterMode !== 'favorites' || searching;

        return `
            <div class="wl-item ${isActive ? 'active' : ''} ${!item.isCore ? 'wl-dynamic' : ''}"
                 data-symbol="${item.symbol}"
                 onclick="Watchlist.selectSymbol('${item.symbol}')">
                ${showingAll ? `
                    <button class="wl-fav-btn ${item.isFav ? 'active' : ''}"
                            onclick="event.stopPropagation(); Watchlist.toggleFavorite('${item.symbol}')"
                            title="${item.isFav ? 'Quitar' : 'Agregar'} favorito">
                        ${item.isFav ? '★' : '☆'}
                    </button>
                ` : ''}
                <div class="wl-info">
                    <span class="wl-symbol">${item.symbol}</span>
                    <span class="wl-grade ${(item.isCore ? CONFIG.TOKENS[item.symbol]?.grade : 'C').toLowerCase()}">${item.isCore ? CONFIG.TOKENS[item.symbol]?.grade || '?' : 'C'}</span>
                </div>
                <div class="wl-price-info">
                    <div class="wl-price" id="wl-price-${item.symbol}">
                        $${Utils.formatPrice(item.price)}
                    </div>
                    <div class="wl-change ${isUp ? 'up' : 'down'}" id="wl-change-${item.symbol}">
                        ${isUp ? '▲' : '▼'} ${Math.abs(ch).toFixed(2)}%
                    </div>
                </div>
                ${volStr && showingAll ? `<div class="wl-vol">${volStr}</div>` : ''}
            </div>
        `;
    },

    _renderEmpty(searching) {
        if (searching) {
            return `<div class="wl-empty">No se encontró "${this._searchQuery}"${!this._allSymbolsLoaded ? '<br><small style="color:var(--cyan)">Cargando pares...</small>' : ''}</div>`;
        }
        return '<div class="wl-empty">Sin monedas<br><small>Usá 🔍 para buscar</small></div>';
    },

    _fmtVol(v) {
        if (!v || v <= 0) return '';
        if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
        if (v >= 1e6) return `${(v / 1e6).toFixed(0)}M`;
        if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
        return '';
    },

    subscribeToState() {
        State.subscribe('prices', () => this.updatePrices());
        State.subscribe('symbol', () => this.updateActive());
    },

    updatePrices() {
        document.querySelectorAll('.wl-item').forEach(item => {
            const symbol = item.dataset.symbol;
            const price = State.prices[symbol];
            if (!price) return;

            const priceEl = document.getElementById(`wl-price-${symbol}`);
            const changeEl = document.getElementById(`wl-change-${symbol}`);

            if (priceEl) {
                const prev = this._prevPrices[symbol];
                priceEl.textContent = `$${Utils.formatPrice(price.price)}`;
                if (prev !== undefined && prev !== price.price) {
                    const color = price.price > prev ? CONFIG.COLORS.green : CONFIG.COLORS.red;
                    priceEl.style.transition = 'none';
                    priceEl.style.color = color;
                    requestAnimationFrame(() => {
                        priceEl.style.transition = 'color 1.5s ease';
                        priceEl.style.color = '';
                    });
                }
            }
            if (changeEl) {
                const ch = price.change;
                const isUp = ch >= 0;
                changeEl.className = `wl-change ${isUp ? 'up' : 'down'}`;
                changeEl.textContent = `${isUp ? '▲' : '▼'} ${Math.abs(ch).toFixed(2)}%`;
            }
            this._prevPrices[symbol] = price.price;
        });
    },

    updateActive() {
        document.querySelectorAll('.wl-item').forEach(item => {
            item.classList.toggle('active', item.dataset.symbol === State.symbol);
        });
    },

    _selectTimeout: null,

    selectSymbol(symbol) {
        if (symbol === State.symbol) return;
        if (this._selectTimeout) clearTimeout(this._selectTimeout);
        if (typeof API !== 'undefined' && API.clearQueue) API.clearQueue();

        // Dynamic symbol — inject price into State
        if (!CONFIG.TOKENS[symbol]) {
            const allData = this._allSymbols.find(s => s.symbol === symbol);
            if (allData && !State.prices[symbol]) {
                State.prices[symbol] = {
                    price: allData.price, change: allData.change,
                    volume: allData.volume, high24h: allData.high24h || allData.high,
                    low24h: allData.low24h || allData.low,
                };
            }
        }

        State.set('symbol', symbol);
        State.set('analysis', null);

        if (typeof SymbolInfo !== 'undefined' && SymbolInfo.update) SymbolInfo.update();
        if (typeof Analysis !== 'undefined' && Analysis.clear) Analysis.clear();
        if (typeof Trading !== 'undefined' && Trading.disableButtons) Trading.disableButtons();

        this._selectTimeout = setTimeout(() => {
            if (typeof Trading !== 'undefined' && Trading.analyze) Trading.analyze();
        }, 2000);
    },
};
