/* ========================================
   SYMBOL INFO - Symbol Info Component
   Trading Platform PRO v2.0
   ======================================== */

const SymbolInfo = {

    init() {
        this.render();
        this.bindEvents();
        this.subscribeToState();
    },

    render() {
        const info = State.getTokenInfo();

        const symbolName = document.getElementById('symbolName');
        const symbolSector = document.getElementById('symbolSector');

        if (symbolName) symbolName.textContent = `${State.symbol}USDT`;
        if (symbolSector) {
            symbolSector.textContent = `${info.name} · ${info.sector} · Grado ${info.grade}`;
        }

        this.updatePrice();
    },

    bindEvents() {
        const tfSelect = document.getElementById('tfSelect');
        if (tfSelect) {
            // Poblar timeframes si está vacío
            if (tfSelect.options.length <= 1) {
                tfSelect.innerHTML = CONFIG.TIMEFRAMES.map(tf =>
                    `<option value="${tf}" ${tf === State.timeframe ? 'selected' : ''}>${tf}</option>`
                ).join('');
            }

            tfSelect.addEventListener('change', (e) => {
                State.set('timeframe', e.target.value);
            });
        }
    },

    subscribeToState() {
        State.subscribe('prices', () => this.updatePrice());
        State.subscribe('candles', () => this.updateIndicators());
    },

    /** Llamado al cambiar de símbolo */
    update() {
        this.render();
    },

    /** Actualizar precio y cambio 24h */
    updatePrice() {
        const price = State.getCurrentPrice();
        const change = State.getChange();
        const range = State.get24hRange();
        const volume = State.getVolume();

        const priceEl = document.getElementById('currentPrice');
        const changeEl = document.getElementById('priceChange');
        const volumeEl = document.getElementById('symbolVolume');
        const rangeEl = document.getElementById('symbolRange');

        if (priceEl) {
            priceEl.textContent = `$${Utils.formatPrice(price)}`;
        }

        if (changeEl) {
            changeEl.className = `price-change ${change >= 0 ? 'up' : 'down'}`;
            changeEl.textContent = `${change >= 0 ? '▲' : '▼'} ${Math.abs(change).toFixed(2)}%`;
        }

        // Estos elementos son opcionales (necesitan existir en el HTML)
        if (volumeEl) {
            volumeEl.textContent = `Vol: $${Utils.formatVolume(volume)}`;
        }

        if (rangeEl && range.high > 0) {
            rangeEl.textContent = `L: $${Utils.formatPrice(range.low)} · H: $${Utils.formatPrice(range.high)}`;
        }
    },

    /** Actualizar indicadores técnicos */
    updateIndicators() {
        if (!State.candles || State.candles.length < 21) return;

        const ind = Indicators.calculateAll(State.candles);

        // RSI
        const rsiEl = document.getElementById('indRSI');
        if (rsiEl) {
            const rsi = ind.rsi;
            rsiEl.textContent = rsi.toFixed(1);
            rsiEl.style.color = rsi > 70 ? CONFIG.COLORS.red :
                                rsi < 30 ? CONFIG.COLORS.green : CONFIG.COLORS.text;
        }

        // EMAs
        const ema9El = document.getElementById('indEMA9');
        const ema21El = document.getElementById('indEMA21');
        if (ema9El) ema9El.textContent = `$${Utils.formatPrice(ind.ema9)}`;
        if (ema21El) ema21El.textContent = `$${Utils.formatPrice(ind.ema21)}`;

        // ATR
        const atrEl = document.getElementById('indATR');
        if (atrEl) atrEl.textContent = `$${Utils.formatPrice(ind.atr)}`;

        // MACD
        const macdEl = document.getElementById('indMACD');
        if (macdEl) {
            const macd = ind.macd;
            const label = macd.histogram > 0 ? '▲' : '▼';
            macdEl.textContent = `${label} ${macd.histogram.toFixed(2)}`;
            macdEl.style.color = macd.histogram > 0 ? CONFIG.COLORS.green : CONFIG.COLORS.red;
        }

        // Stochastic
        const stochEl = document.getElementById('indStoch');
        if (stochEl) {
            const stoch = ind.stochastic;
            stochEl.textContent = `K:${stoch.k.toFixed(0)} D:${stoch.d.toFixed(0)}`;
            stochEl.style.color = stoch.k > 80 ? CONFIG.COLORS.red :
                                  stoch.k < 20 ? CONFIG.COLORS.green : CONFIG.COLORS.text;
        }

        // Bollinger Band width
        const bbEl = document.getElementById('indBB');
        if (bbEl) {
            bbEl.textContent = `W:${ind.bb.width.toFixed(1)}%`;
        }

        // Trend badge
        const trendEl = document.getElementById('indTrend');
        if (trendEl) {
            const t = ind.trend;
            if (t.trend === 'bullish') {
                trendEl.textContent = '▲ ALCISTA';
                trendEl.style.color = CONFIG.COLORS.green;
            } else if (t.trend === 'bearish') {
                trendEl.textContent = '▼ BAJISTA';
                trendEl.style.color = CONFIG.COLORS.red;
            } else {
                trendEl.textContent = '🟡 NEUTRAL';
                trendEl.style.color = CONFIG.COLORS.yellow;
            }
        }

        // Señal del frontend
        const signalEl = document.getElementById('indSignal');
        if (signalEl) {
            const sig = ind.signal;
            if (sig.direction === 'LONG') {
                signalEl.textContent = `▲ LONG (${sig.score}%)`;
                signalEl.style.color = CONFIG.COLORS.green;
            } else if (sig.direction === 'SHORT') {
                signalEl.textContent = `▼ SHORT (${sig.score}%)`;
                signalEl.style.color = CONFIG.COLORS.red;
            } else {
                signalEl.textContent = `⚪ NEUTRAL`;
                signalEl.style.color = CONFIG.COLORS.muted;
            }
        }

        // Volume ratio
        const volRatioEl = document.getElementById('indVolRatio');
        if (volRatioEl) {
            const vol = ind.volume;
            volRatioEl.textContent = `${vol.ratio.toFixed(1)}x`;
            volRatioEl.style.color = vol.ratio > 2 ? CONFIG.COLORS.yellow :
                                     vol.ratio < 0.5 ? CONFIG.COLORS.muted : CONFIG.COLORS.text;
        }

        // Divergencia
        const divEl = document.getElementById('indDivergence');
        if (divEl) {
            const div = ind.divergence;
            if (div.type === 'bullish') {
                divEl.textContent = '⬆️ Alcista';
                divEl.style.color = CONFIG.COLORS.green;
            } else if (div.type === 'bearish') {
                divEl.textContent = '⬇️ Bajista';
                divEl.style.color = CONFIG.COLORS.red;
            } else {
                divEl.textContent = 'Ninguna';
                divEl.style.color = CONFIG.COLORS.muted;
            }
        }
    }
};
