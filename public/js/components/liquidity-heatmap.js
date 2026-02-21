/**
 * LiquidityHeatmap — Visualize order book liquidity zones
 * Shows where buy/sell walls are concentrated
 */
const LiquidityHeatmap = {
    _container: null,
    _updateInterval: null,
    _cache: { symbol: null, data: null, timestamp: 0 },
    _CACHE_TTL: 10000, // 10 seconds

    init() {
        this._container = document.getElementById('liquidityHeatmap');
        if (!this._container) return;

        this.render();
        this._updateInterval = setInterval(() => this.update(), 15000);

        State.subscribe('currentSymbol', () => this.update());

        console.log('LiquidityHeatmap: Initialized');
    },

    async update() {
        const symbol = (State.symbol || 'BTC') + 'USDT';
        const now = Date.now();

        // Use cache if valid
        if (this._cache.symbol === symbol && (now - this._cache.timestamp) < this._CACHE_TTL) {
            this.render(this._cache.data);
            return;
        }

        try {
            const data = await this._fetchOrderBook(symbol);
            this._cache = { symbol, data, timestamp: now };
            this.render(data);
        } catch (e) {
            console.warn('LiquidityHeatmap: Failed to fetch', e);
            this.render(null);
        }
    },

    async _fetchOrderBook(symbol) {
        const url = `https://fapi.binance.com/fapi/v1/depth?symbol=${symbol}&limit=50`;
        const response = await fetch(url);
        if (!response.ok) throw new Error('Failed to fetch order book');

        const data = await response.json();
        return this._processOrderBook(data);
    },

    _processOrderBook(raw) {
        const bids = raw.bids || [];
        const asks = raw.asks || [];

        // Get current price from state
        const currentPrice = State.prices?.[State.symbol]?.price || parseFloat(bids[0]?.[0] || 0);

        // Aggregate into price zones (0.5% bands)
        const zoneSize = currentPrice * 0.005;
        const bidZones = this._aggregateZones(bids, currentPrice, zoneSize, 'bid');
        const askZones = this._aggregateZones(asks, currentPrice, zoneSize, 'ask');

        // Find max volume for normalization
        const allVolumes = [...bidZones, ...askZones].map(z => z.volume);
        const maxVol = Math.max(...allVolumes, 1);

        // Normalize
        bidZones.forEach(z => z.intensity = z.volume / maxVol);
        askZones.forEach(z => z.intensity = z.volume / maxVol);

        // Find significant walls (>30% of max)
        const walls = [];
        bidZones.filter(z => z.intensity > 0.3).forEach(z => {
            walls.push({ type: 'support', price: z.price, volume: z.volume, intensity: z.intensity });
        });
        askZones.filter(z => z.intensity > 0.3).forEach(z => {
            walls.push({ type: 'resistance', price: z.price, volume: z.volume, intensity: z.intensity });
        });

        // Calculate bid/ask imbalance
        const totalBid = bidZones.reduce((s, z) => s + z.volume, 0);
        const totalAsk = askZones.reduce((s, z) => s + z.volume, 0);
        const imbalance = totalBid + totalAsk > 0
            ? (totalBid - totalAsk) / (totalBid + totalAsk)
            : 0;

        return {
            currentPrice,
            bidZones: bidZones.slice(0, 8),
            askZones: askZones.slice(0, 8),
            walls: walls.sort((a, b) => b.intensity - a.intensity).slice(0, 4),
            imbalance,
            totalBid,
            totalAsk
        };
    },

    _aggregateZones(orders, currentPrice, zoneSize, type) {
        const zones = new Map();

        orders.forEach(([price, qty]) => {
            const p = parseFloat(price);
            const q = parseFloat(qty);
            const zoneKey = Math.floor(p / zoneSize) * zoneSize;

            if (!zones.has(zoneKey)) {
                zones.set(zoneKey, { price: zoneKey, volume: 0, orders: 0 });
            }
            const zone = zones.get(zoneKey);
            zone.volume += q * p; // Volume in USDT
            zone.orders++;
        });

        // Sort and return
        const sorted = Array.from(zones.values());
        if (type === 'bid') {
            sorted.sort((a, b) => b.price - a.price); // Descending for bids
        } else {
            sorted.sort((a, b) => a.price - b.price); // Ascending for asks
        }

        return sorted;
    },

    render(data) {
        if (!this._container) return;

        if (!data) {
            this._container.innerHTML = `
                <div class="liq-loading">Cargando liquidez...</div>
            `;
            return;
        }

        const imbalanceClass = data.imbalance > 0.1 ? 'bullish' : data.imbalance < -0.1 ? 'bearish' : 'neutral';
        const imbalanceText = data.imbalance > 0.1 ? 'Compradores dominan' : data.imbalance < -0.1 ? 'Vendedores dominan' : 'Equilibrado';

        this._container.innerHTML = `
            <div class="liq-content">
                <!-- Imbalance Indicator -->
                <div class="liq-imbalance ${imbalanceClass}">
                    <div class="liq-imbalance-bar">
                        <div class="liq-bid-bar" style="width: ${Math.max(5, 50 + data.imbalance * 50)}%"></div>
                        <div class="liq-ask-bar" style="width: ${Math.max(5, 50 - data.imbalance * 50)}%"></div>
                    </div>
                    <div class="liq-imbalance-label">${imbalanceText}</div>
                </div>

                <!-- Key Walls -->
                <div class="liq-walls">
                    ${this._renderWalls(data.walls, data.currentPrice)}
                </div>

                <!-- Mini Heatmap -->
                <div class="liq-heatmap">
                    <div class="liq-asks">
                        ${this._renderZones(data.askZones, 'ask')}
                    </div>
                    <div class="liq-price-line">
                        <span>$${this._formatPrice(data.currentPrice)}</span>
                    </div>
                    <div class="liq-bids">
                        ${this._renderZones(data.bidZones, 'bid')}
                    </div>
                </div>
            </div>
        `;
    },

    _renderWalls(walls, currentPrice) {
        if (!walls || walls.length === 0) {
            return '<div class="liq-no-walls">Sin muros significativos</div>';
        }

        return walls.map(w => {
            const distance = ((w.price - currentPrice) / currentPrice * 100).toFixed(2);
            const distSign = distance > 0 ? '+' : '';
            return `
                <div class="liq-wall ${w.type}">
                    <span class="liq-wall-type">${w.type === 'support' ? '🟢' : '🔴'}</span>
                    <span class="liq-wall-price">$${this._formatPrice(w.price)}</span>
                    <span class="liq-wall-dist">${distSign}${distance}%</span>
                    <span class="liq-wall-vol">${this._formatVolume(w.volume)}</span>
                </div>
            `;
        }).join('');
    },

    _renderZones(zones, type) {
        if (!zones || zones.length === 0) return '';

        return zones.map(z => {
            const hue = type === 'bid' ? 120 : 0; // Green for bids, red for asks
            const alpha = 0.2 + z.intensity * 0.6;
            return `
                <div class="liq-zone ${type}"
                     style="background: hsla(${hue}, 70%, 50%, ${alpha});"
                     title="$${this._formatPrice(z.price)} - ${this._formatVolume(z.volume)}">
                </div>
            `;
        }).join('');
    },

    _formatPrice(price) {
        if (price >= 1000) return price.toFixed(0);
        if (price >= 1) return price.toFixed(2);
        return price.toFixed(4);
    },

    _formatVolume(vol) {
        if (vol >= 1e9) return (vol / 1e9).toFixed(1) + 'B';
        if (vol >= 1e6) return (vol / 1e6).toFixed(1) + 'M';
        if (vol >= 1e3) return (vol / 1e3).toFixed(1) + 'K';
        return vol.toFixed(0);
    },

    destroy() {
        if (this._updateInterval) {
            clearInterval(this._updateInterval);
        }
    },

    /** Get liquidity data for analysis integration */
    async getLiquidityAnalysis() {
        const symbol = (State.symbol || 'BTC') + 'USDT';
        const now = Date.now();

        // Use cache if valid
        if (this._cache.symbol === symbol && (now - this._cache.timestamp) < this._CACHE_TTL && this._cache.data) {
            return this._formatForAnalysis(this._cache.data);
        }

        try {
            const data = await this._fetchOrderBook(symbol);
            this._cache = { symbol, data, timestamp: now };
            return this._formatForAnalysis(data);
        } catch (e) {
            return null;
        }
    },

    _formatForAnalysis(data) {
        if (!data) return null;

        const nearSupports = data.walls.filter(w => w.type === 'support').slice(0, 2);
        const nearResistances = data.walls.filter(w => w.type === 'resistance').slice(0, 2);

        return {
            imbalance: data.imbalance,
            imbalanceSignal: data.imbalance > 0.15 ? 'BULLISH' : data.imbalance < -0.15 ? 'BEARISH' : 'NEUTRAL',
            supports: nearSupports.map(w => w.price),
            resistances: nearResistances.map(w => w.price),
            buyPressure: data.totalBid,
            sellPressure: data.totalAsk
        };
    }
};

// Auto-init
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => LiquidityHeatmap.init());
} else {
    setTimeout(() => LiquidityHeatmap.init(), 200);
}
