/* ========================================
   INDICATORS PRO — Enhanced Indicator Bar
   Semaphore colors, zones, contextual tips
   TheRealShortShady v4.2
   ======================================== */

const IndicatorsPro = {

    _lastUpdate: null,

    init() {
        // Subscribe to candle updates
        State.subscribe('candles', () => this._update());
        State.subscribe('prices', () => this._updatePrice());
    },

    _update() {
        const candles = State.candles;
        if (!candles || candles.length < 21) return;

        const closes = candles.map(c => c.c);
        const highs = candles.map(c => c.h);
        const lows = candles.map(c => c.l);
        const volumes = candles.map(c => c.v || 0);
        const last = closes[closes.length - 1];

        // Calculate all indicators
        const ema9 = Indicators.ema(closes, 9);
        const ema21 = Indicators.ema(closes, 21);
        const rsi = Indicators.rsi(closes, 14);

        let macdData = null;
        if (typeof Indicators.macd === 'function') {
            const m = Indicators.macd(closes);
            if (m?.series?.length > 0) macdData = m.series[m.series.length - 1];
        }

        // Stochastic
        let stochK = 50;
        if (closes.length >= 14) {
            const p14 = closes.slice(-14);
            const h14 = Math.max(...p14);
            const l14 = Math.min(...p14);
            stochK = h14 !== l14 ? ((last - l14) / (h14 - l14)) * 100 : 50;
        }

        // BB
        let bbPos = 'MID';
        if (closes.length >= 20) {
            const sl = closes.slice(-20);
            const mean = sl.reduce((a, b) => a + b, 0) / 20;
            const std = Math.sqrt(sl.reduce((s, v) => s + (v - mean) ** 2, 0) / 20);
            const upper = mean + std * 2;
            const lower = mean - std * 2;
            if (last >= upper * 0.98) bbPos = 'HIGH';
            else if (last <= lower * 1.02) bbPos = 'LOW';
        }

        // ATR
        let atr = 0;
        if (candles.length >= 14) {
            let trSum = 0;
            for (let i = candles.length - 14; i < candles.length; i++) {
                const c = candles[i];
                const pc = candles[i - 1]?.c || c.o;
                const tr = Math.max(c.h - c.l, Math.abs(c.h - pc), Math.abs(c.l - pc));
                trSum += tr;
            }
            atr = trSum / 14;
        }

        // Volume ratio
        let volRatio = 1;
        if (volumes.length >= 20) {
            const avgVol = volumes.slice(-20, -1).reduce((s, v) => s + v, 0) / 19;
            volRatio = avgVol > 0 ? volumes[volumes.length - 1] / avgVol : 1;
        }

        // Trend
        const emaStack = ema9 > ema21 ? 'BULL' : 'BEAR';

        // Signal
        let signal = this._generateSignalSummary(emaStack, rsi, macdData, stochK, bbPos, volRatio);

        // Divergence
        let divergence = this._detectDivergence(closes, candles);

        // Update DOM with enhanced styling
        this._setIndicator('indRSI', rsi.toFixed(1), this._rsiStyle(rsi));
        this._setIndicator('indEMA9', this._formatPrice(ema9), { color: ema9 > ema21 ? '#10b981' : '#f43f5e' });
        this._setIndicator('indEMA21', this._formatPrice(ema21), { color: ema21 < ema9 ? '#10b981' : '#f43f5e' });
        this._setIndicator('indATR', this._formatPrice(atr), { color: '#888' });
        this._setIndicator('indMACD', macdData ? macdData.histogram.toFixed(4) : '--', this._macdStyle(macdData));
        this._setIndicator('indStoch', stochK.toFixed(0), this._stochStyle(stochK));
        this._setIndicator('indBB', bbPos, this._bbStyle(bbPos));
        this._setIndicator('indVolRatio', volRatio.toFixed(1) + 'x', this._volStyle(volRatio));
        this._setIndicator('indTrend', emaStack, {
            color: emaStack === 'BULL' ? '#10b981' : '#f43f5e',
            fontWeight: '700'
        });
        this._setIndicator('indSignal', signal.label, signal.style);
        this._setIndicator('indDivergence', divergence.label, divergence.style);

        this._lastUpdate = Date.now();
    },

    _updatePrice() {
        // Lightweight price-only update between full candle updates
    },

    // ==========================================
    //  SIGNAL GENERATION
    // ==========================================

    _generateSignalSummary(trend, rsi, macd, stoch, bb, volRatio) {
        let bullPoints = 0, bearPoints = 0;

        // Trend
        if (trend === 'BULL') bullPoints += 2; else bearPoints += 2;

        // RSI
        if (rsi > 60 && rsi < 80) bullPoints += 1;
        else if (rsi < 40 && rsi > 20) bearPoints += 1;
        else if (rsi >= 80) bearPoints += 1; // Overbought = bearish
        else if (rsi <= 20) bullPoints += 1; // Oversold = bullish (reversal)

        // MACD
        if (macd) {
            if (macd.histogram > 0) bullPoints += 1; else bearPoints += 1;
            if (macd.macd > macd.signal) bullPoints += 1; else bearPoints += 1;
        }

        // Stochastic
        if (stoch > 60) bullPoints += 1;
        else if (stoch < 40) bearPoints += 1;

        // BB position
        if (bb === 'LOW') bullPoints += 1; // Near lower band = potential bounce
        else if (bb === 'HIGH') bearPoints += 1; // Near upper band = potential rejection

        // Volume confirmation
        if (volRatio > 1.5) {
            // High volume confirms the direction
            if (bullPoints > bearPoints) bullPoints += 1;
            else bearPoints += 1;
        }

        const total = bullPoints + bearPoints;
        const bullPct = total > 0 ? (bullPoints / total * 100) : 50;

        if (bullPct >= 70) return { label: 'LONG ✓', style: { color: '#10b981', fontWeight: '700', textShadow: '0 0 6px rgba(34,197,94,0.4)' }};
        if (bullPct >= 55) return { label: 'Long?', style: { color: '#84cc16', fontWeight: '600' }};
        if (bullPct <= 30) return { label: 'SHORT ✓', style: { color: '#f43f5e', fontWeight: '700', textShadow: '0 0 6px rgba(239,68,68,0.4)' }};
        if (bullPct <= 45) return { label: 'Short?', style: { color: '#f97316', fontWeight: '600' }};
        return { label: 'NEUTRAL', style: { color: '#eab308' }};
    },

    _detectDivergence(closes, candles) {
        if (closes.length < 20) return { label: '—', style: { color: '#555' }};

        // Simple RSI divergence: price making new high but RSI not, or vice versa
        const rsiSeries = Indicators.rsiSeries(closes, 14);
        if (rsiSeries.length < 10) return { label: '—', style: { color: '#555' }};

        const recentCloses = closes.slice(-10);
        const recentRSI = rsiSeries.slice(-10);

        const priceHigh = Math.max(...recentCloses);
        const priceHighIdx = recentCloses.lastIndexOf(priceHigh);
        const priceLow = Math.min(...recentCloses);
        const priceLowIdx = recentCloses.lastIndexOf(priceLow);

        // Check last close vs previous high
        const lastClose = recentCloses[recentCloses.length - 1];
        const lastRSI = recentRSI[recentRSI.length - 1];

        // Bearish divergence: price at/near high, RSI declining
        if (lastClose >= priceHigh * 0.998 && lastRSI < Math.max(...recentRSI.slice(0, -2))) {
            return { label: 'Bear ⚠', style: { color: '#f43f5e', fontWeight: '600' }};
        }

        // Bullish divergence: price at/near low, RSI rising
        if (lastClose <= priceLow * 1.002 && lastRSI > Math.min(...recentRSI.slice(0, -2))) {
            return { label: 'Bull ⚡', style: { color: '#10b981', fontWeight: '600' }};
        }

        return { label: 'No', style: { color: '#555' }};
    },

    // ==========================================
    //  STYLES PER INDICATOR
    // ==========================================

    _rsiStyle(rsi) {
        if (rsi >= 80) return { color: '#f43f5e', fontWeight: '700', textShadow: '0 0 6px rgba(239,68,68,0.5)' };
        if (rsi >= 70) return { color: '#f97316', fontWeight: '600' };
        if (rsi <= 20) return { color: '#10b981', fontWeight: '700', textShadow: '0 0 6px rgba(34,197,94,0.5)' };
        if (rsi <= 30) return { color: '#84cc16', fontWeight: '600' };
        if (rsi >= 55 && rsi <= 65) return { color: '#888' };
        return { color: '#ccc' };
    },

    _macdStyle(macd) {
        if (!macd) return { color: '#555' };
        if (macd.histogram > 0 && macd.macd > macd.signal) return { color: '#10b981', fontWeight: '600' };
        if (macd.histogram < 0 && macd.macd < macd.signal) return { color: '#f43f5e', fontWeight: '600' };
        return { color: '#eab308' }; // Transitioning
    },

    _stochStyle(k) {
        if (k >= 80) return { color: '#f43f5e', fontWeight: '600' };
        if (k <= 20) return { color: '#10b981', fontWeight: '600' };
        return { color: '#888' };
    },

    _bbStyle(pos) {
        if (pos === 'HIGH') return { color: '#f43f5e', fontWeight: '600' };
        if (pos === 'LOW') return { color: '#10b981', fontWeight: '600' };
        return { color: '#888' };
    },

    _volStyle(ratio) {
        if (ratio >= 2.5) return { color: '#00d4ff', fontWeight: '700', textShadow: '0 0 6px rgba(0,212,255,0.5)' };
        if (ratio >= 1.5) return { color: '#eab308', fontWeight: '600' };
        if (ratio <= 0.5) return { color: '#555' };
        return { color: '#888' };
    },

    // ==========================================
    //  DOM HELPERS
    // ==========================================

    _setIndicator(id, text, style = {}) {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = text;
        Object.assign(el.style, {
            color: style.color || '#888',
            fontWeight: style.fontWeight || '500',
            textShadow: style.textShadow || 'none',
            transition: 'color 0.3s ease, text-shadow 0.3s ease'
        });
    },

    _formatPrice(price) {
        if (!price) return '--';
        if (price >= 1000) return price.toFixed(2);
        if (price >= 1) return price.toFixed(4);
        return price.toFixed(6);
    }
};
