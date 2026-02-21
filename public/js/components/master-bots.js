/* ========================================
   MASTER BOTS — Expert Analyst System
   Real data from Fear&Greed, CoinGecko + Binance
   TheRealShortShady v4.0
   ======================================== */

const MasterBots = {

    _reports: {},
    _sentimentData: null,
    _sentimentLastFetch: 0,
    _running: false,
    _STORAGE_KEY: 'tp_master_bots_reports',

    // FIX: Persistir reports en localStorage para no perderlos al recargar
    init() {
        try {
            const saved = localStorage.getItem(this._STORAGE_KEY);
            if (saved) {
                const data = JSON.parse(saved);
                // Solo restaurar reports de la última hora
                if (data._savedAt && Date.now() - data._savedAt < 3600000) {
                    this._reports = data.reports || {};
                    console.log('📊 MasterBots: reports restaurados', Object.keys(this._reports).length, 'symbols');
                }
            }
        } catch (e) {}
    },

    _saveReports() {
        try {
            localStorage.setItem(this._STORAGE_KEY, JSON.stringify({
                reports: this._reports,
                _savedAt: Date.now()
            }));
        } catch (e) {}
    },

    BOTS: {
        tech:        { id: 'tech',        name: 'TechBot',        emoji: '📊', specialty: 'Análisis Técnico',           weight: 0.22 },
        macro:       { id: 'macro',       name: 'MacroBot',       emoji: '🌍', specialty: 'Macro & Régimen',            weight: 0.18 },
        momentum:    { id: 'momentum',    name: 'MomentumBot',    emoji: '📈', specialty: 'Momentum & Fuerza',          weight: 0.18 },
        whale:       { id: 'whale',       name: 'WhaleBot',       emoji: '🐋', specialty: 'Volumen & Institucional',    weight: 0.15 },
        correlation: { id: 'correlation', name: 'CorrelationBot', emoji: '🔗', specialty: 'Correlaciones & Flujos',     weight: 0.10 },
        sentiment:   { id: 'sentiment',   name: 'SentimentBot',   emoji: '🔥', specialty: 'Sentimiento Real (F&G)',     weight: 0.10 },
        timing:      { id: 'timing',      name: 'TimingBot',      emoji: '⏱',  specialty: 'Timing & Sesiones',          weight: 0.07 }
    },

    // === FETCH REAL SENTIMENT DATA ===

    async _fetchSentiment() {
        // Cache for 2 minutes
        if (this._sentimentData && Date.now() - this._sentimentLastFetch < 120000) {
            return this._sentimentData;
        }

        try {
            const resp = await fetch('/api/sentiment');
            if (!resp.ok) throw new Error(`Sentiment API ${resp.status}`);
            this._sentimentData = await resp.json();
            this._sentimentLastFetch = Date.now();
            console.log('🌍 Sentiment data loaded:', this._sentimentData?.fearGreed?.label, this._sentimentData?.global?.btcDominance?.toFixed(1) + '%');
        } catch (e) {
            console.error('Failed to fetch sentiment:', e);
        }

        return this._sentimentData;
    },

    // === RUN ALL BOTS ===

    async analyzeAll(symbol, candles, indicators) {
        if (this._running) return this._reports[symbol];
        this._running = true;

        // Fetch real external data
        await this._fetchSentiment();

        const reports = {};
        const prices = State.prices || {};
        const allSymbols = Object.keys(CONFIG.TOKENS || {});

        try {
            reports.tech = this._runTechBot(symbol, candles, indicators);
            reports.macro = this._runMacroBot(symbol, prices, allSymbols);
            reports.momentum = this._runMomentumBot(symbol, candles, indicators);
            reports.whale = this._runWhaleBot(symbol, candles);
            reports.correlation = this._runCorrelationBot(symbol, prices, allSymbols);
            reports.sentiment = this._runSentimentBot(symbol, prices);
            reports.timing = this._runTimingBot(symbol);
        } catch (e) {
            console.error('MasterBots error:', e);
        }

        reports._aggregate = this._aggregate(reports);
        reports._timestamp = new Date().toISOString();
        this._reports[symbol] = reports;
        this._running = false;

        // FIX: Persistir para no perder al recargar
        this._saveReports();

        return reports;
    },

    // === TECHBOT — Estructura de mercado, patrones, niveles ===

    _runTechBot(symbol, candles, indicators) {
        const r = { bot: 'tech', signal: 'neutral', score: 50, reasons: [], direction: null };
        if (!candles || candles.length < 20) { r.reasons.push('Datos insuficientes'); return r; }

        const closes = candles.map(c => c.close);
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const last = closes[closes.length - 1];
        let bull = 0, bear = 0;

        // 1. EMA Structure
        if (indicators?.ema9 && indicators?.ema21) {
            if (indicators.ema9 > indicators.ema21) {
                bull += 12;
                if (last > indicators.ema9) { bull += 8; r.reasons.push('Precio sobre EMA9 > EMA21 — tendencia alcista'); }
                else { r.reasons.push('EMA alcista pero precio bajo EMA9 — pullback'); bull += 3; }
            } else {
                bear += 12;
                if (last < indicators.ema9) { bear += 8; r.reasons.push('Precio bajo EMA9 < EMA21 — tendencia bajista'); }
                else { r.reasons.push('EMA bajista pero precio sobre EMA9 — rebote'); bear += 3; }
            }
        }

        // 2. RSI zones with nuance
        if (indicators?.rsi) {
            const rsi = indicators.rsi;
            if (rsi > 80) { bear += 12; r.reasons.push(`RSI extremo ${rsi.toFixed(0)} — sobrecompra severa`); }
            else if (rsi > 70) { bear += 6; r.reasons.push(`RSI ${rsi.toFixed(0)} — sobrecompra`); }
            else if (rsi > 55) { bull += 6; }
            else if (rsi > 45) { /* neutral */ }
            else if (rsi > 30) { bear += 6; r.reasons.push(`RSI ${rsi.toFixed(0)} — debilidad`); }
            else if (rsi > 20) { bull += 6; r.reasons.push(`RSI ${rsi.toFixed(0)} — sobreventa`); }
            else { bull += 12; r.reasons.push(`RSI extremo ${rsi.toFixed(0)} — sobreventa severa`); }
        }

        // 3. Bollinger Bands
        if (indicators?.bbUpper && indicators?.bbLower) {
            const bbMid = (indicators.bbUpper + indicators.bbLower) / 2;
            const bbWidth = ((indicators.bbUpper - indicators.bbLower) / bbMid * 100);
            if (last >= indicators.bbUpper * 0.998) { bear += 8; r.reasons.push('Tocando banda superior BB'); }
            else if (last <= indicators.bbLower * 1.002) { bull += 8; r.reasons.push('Tocando banda inferior BB'); }
            if (bbWidth < 3) { r.reasons.push('BB comprimidas — breakout inminente'); }
        }

        // 4. Candle patterns
        const len = candles.length;
        if (len >= 3) {
            const c1 = candles[len - 1], c2 = candles[len - 2], c3 = candles[len - 3];

            // Engulfing
            if (c1.close > c1.open && c2.close < c2.open && c1.close > c2.open && c1.open < c2.close) {
                bull += 12; r.reasons.push('🕯 Envolvente alcista');
            }
            if (c1.close < c1.open && c2.close > c2.open && c1.close < c2.open && c1.open > c2.close) {
                bear += 12; r.reasons.push('🕯 Envolvente bajista');
            }

            // Three soldiers/crows
            if (c1.close > c1.open && c2.close > c2.open && c3.close > c3.open) {
                bull += 8; r.reasons.push('3 velas verdes consecutivas');
            }
            if (c1.close < c1.open && c2.close < c2.open && c3.close < c3.open) {
                bear += 8; r.reasons.push('3 velas rojas consecutivas');
            }

            // Hammer / Shooting star
            const body = Math.abs(c1.close - c1.open);
            const upperWick = c1.high - Math.max(c1.open, c1.close);
            const lowerWick = Math.min(c1.open, c1.close) - c1.low;
            if (lowerWick > body * 2.5 && upperWick < body * 0.3 && c2.close < c2.open) {
                bull += 10; r.reasons.push('🔨 Martillo tras vela bajista');
            }
            if (upperWick > body * 2.5 && lowerWick < body * 0.3 && c2.close > c2.open) {
                bear += 10; r.reasons.push('⭐ Estrella fugaz tras vela alcista');
            }

            // Doji
            if (body / (c1.high - c1.low + 0.0001) < 0.05) {
                r.reasons.push('✚ Doji — indecisión total');
            }
        }

        // 5. S/R levels
        const resistance = Math.max(...highs.slice(-20));
        const support = Math.min(...lows.slice(-20));
        const distToRes = ((resistance - last) / last * 100).toFixed(2);
        const distToSup = ((last - support) / last * 100).toFixed(2);

        if (parseFloat(distToRes) < 0.5) { r.reasons.push(`⚠️ En resistencia $${Utils.formatPrice(resistance)}`); bear += 5; }
        if (parseFloat(distToSup) < 0.5) { r.reasons.push(`💪 En soporte $${Utils.formatPrice(support)}`); bull += 5; }

        r.resistance = resistance;
        r.support = support;

        this._calcScore(r, bull, bear);
        return r;
    },

    // === MACROBOT — Régimen de mercado con data REAL ===

    _runMacroBot(symbol, prices, allSymbols) {
        const r = { bot: 'macro', signal: 'neutral', score: 50, reasons: [] };
        let bull = 0, bear = 0;

        const changes = [];
        for (const s of allSymbols) {
            if (prices[s]?.change !== undefined) changes.push({ symbol: s, change: prices[s].change });
        }

        // REAL DATA: CoinGecko Global
        const global = this._sentimentData?.global;
        if (global) {
            // BTC Dominance
            r.btcDominance = global.btcDominance;
            if (global.btcDominance > 55) {
                r.reasons.push(`BTC Dominance alta: ${global.btcDominance.toFixed(1)}% — capital en BTC`);
                if (symbol === 'BTC') bull += 10; else bear += 8;
            } else if (global.btcDominance < 45) {
                r.reasons.push(`BTC Dominance baja: ${global.btcDominance.toFixed(1)}% — Alt Season`);
                if (symbol !== 'BTC') bull += 10; else bear += 5;
            } else {
                r.reasons.push(`BTC Dominance: ${global.btcDominance.toFixed(1)}%`);
            }

            // Total Market Cap change
            if (global.marketCapChange24h > 2) {
                bull += 12; r.reasons.push(`Market Cap +${global.marketCapChange24h.toFixed(1)}% — flujo de capital entrante`);
            } else if (global.marketCapChange24h > 0) {
                bull += 5;
            } else if (global.marketCapChange24h < -2) {
                bear += 12; r.reasons.push(`Market Cap ${global.marketCapChange24h.toFixed(1)}% — capital saliendo`);
            } else {
                bear += 5;
            }

            // Total Volume
            const volB = (global.totalVolume24h / 1e9).toFixed(0);
            r.reasons.push(`Volumen global: $${volB}B`);
        }

        // REAL DATA: Fear & Greed influence on macro
        const fng = this._sentimentData?.fearGreed;
        if (fng) {
            if (fng.value >= 75) {
                r.reasons.push(`⚠️ F&G: ${fng.value} (${fng.label}) — mercado eufórico`);
                bear += 5; // Contrarian caution
            } else if (fng.value >= 55) {
                bull += 5;
            } else if (fng.value <= 25) {
                r.reasons.push(`💀 F&G: ${fng.value} (${fng.label}) — pánico, posible oportunidad`);
                bull += 5;
            } else if (fng.value <= 45) {
                bear += 5;
            }
        }

        // Breadth from Binance data
        if (changes.length >= 3) {
            const bullishCount = changes.filter(c => c.change > 0.5).length;
            const breadth = bullishCount / changes.length;
            if (breadth > 0.7) { bull += 10; r.reasons.push(`Breadth: ${(breadth * 100).toFixed(0)}% alcista`); }
            else if (breadth < 0.3) { bear += 10; r.reasons.push(`Breadth: ${(breadth * 100).toFixed(0)}% — mayoría cae`); }

            // Alt season check
            const btcChange = prices['BTC']?.change || 0;
            const alts = changes.filter(c => c.symbol !== 'BTC');
            const altAvg = alts.length > 0 ? alts.reduce((s, c) => s + c.change, 0) / alts.length : 0;
            if (altAvg > btcChange + 2) {
                r.reasons.push('🔥 Alts superando BTC — rotación activa');
                if (symbol !== 'BTC') bull += 8;
            }
        }

        this._calcScore(r, bull, bear);
        return r;
    },

    // === MOMENTUMBOT — Fuerza y divergencias ===

    _runMomentumBot(symbol, candles, indicators) {
        const r = { bot: 'momentum', signal: 'neutral', score: 50, reasons: [] };
        if (!candles || candles.length < 15) { r.reasons.push('Datos insuficientes'); return r; }

        let bull = 0, bear = 0;
        const closes = candles.map(c => c.close);
        const last = closes[closes.length - 1];

        // ROC
        const roc5 = ((last - closes[closes.length - 6]) / closes[closes.length - 6]) * 100;
        const roc10 = closes.length >= 11 ? ((last - closes[closes.length - 11]) / closes[closes.length - 11]) * 100 : 0;

        if (roc5 > 3) { bull += 15; r.reasons.push(`Momentum 5v muy fuerte: +${roc5.toFixed(1)}%`); }
        else if (roc5 > 1) { bull += 8; r.reasons.push(`Momentum positivo: +${roc5.toFixed(1)}%`); }
        else if (roc5 < -3) { bear += 15; r.reasons.push(`Momentum 5v muy débil: ${roc5.toFixed(1)}%`); }
        else if (roc5 < -1) { bear += 8; r.reasons.push(`Momentum negativo: ${roc5.toFixed(1)}%`); }

        // Acceleration
        if (roc5 > 0 && roc5 > roc10 && roc10 > 0) { bull += 8; r.reasons.push('Momentum acelerando ↗↗'); }
        else if (roc5 < 0 && roc5 < roc10 && roc10 < 0) { bear += 8; r.reasons.push('Caída acelerando ↘↘'); }
        else if (roc5 > 0 && roc5 < roc10 * 0.5) { r.reasons.push('⚠️ Momentum frenando'); bear += 5; }

        // MACD
        if (indicators?.macd !== undefined && indicators?.macdSignal !== undefined) {
            const hist = indicators.macd - indicators.macdSignal;
            if (hist > 0) { bull += 8; r.reasons.push('MACD histograma positivo'); }
            else { bear += 8; r.reasons.push('MACD histograma negativo'); }
        }

        // RSI momentum zones
        if (indicators?.rsi) {
            if (indicators.rsi > 60 && indicators.rsi < 75) { bull += 6; r.reasons.push('RSI en zona de fuerza alcista'); }
            else if (indicators.rsi < 40 && indicators.rsi > 25) { bear += 6; r.reasons.push('RSI en zona de debilidad'); }
        }

        // Structure: HH/HL or LH/LL
        if (closes.length >= 10) {
            const r5 = closes.slice(-5);
            const p5 = closes.slice(-10, -5);
            if (Math.max(...r5) > Math.max(...p5) && Math.min(...r5) > Math.min(...p5)) {
                bull += 10; r.reasons.push('📐 HH + HL — estructura alcista');
            } else if (Math.max(...r5) < Math.max(...p5) && Math.min(...r5) < Math.min(...p5)) {
                bear += 10; r.reasons.push('📐 LH + LL — estructura bajista');
            }
        }

        // Divergence check: price vs RSI
        if (indicators?.rsi && closes.length >= 10) {
            const priceTrend = last > closes[closes.length - 10];
            const rsiTrend = indicators.rsi > 50;
            if (priceTrend && !rsiTrend) { bear += 8; r.reasons.push('⚠️ Divergencia bajista: precio sube, RSI cae'); }
            if (!priceTrend && rsiTrend) { bull += 8; r.reasons.push('💡 Divergencia alcista: precio baja, RSI sube'); }
        }

        r.roc5 = roc5;
        this._calcScore(r, bull, bear);
        return r;
    },

    // === WHALEBOT — Volumen, acumulación, liquidaciones ===

    _runWhaleBot(symbol, candles) {
        const r = { bot: 'whale', signal: 'neutral', score: 50, reasons: [] };
        if (!candles || candles.length < 20) { r.reasons.push('Datos insuficientes'); return r; }

        const volumes = candles.map(c => c.volume || 0);
        const closes = candles.map(c => c.close);
        let bull = 0, bear = 0;

        // Volume analysis
        const avgVol = volumes.slice(0, -1).reduce((s, v) => s + v, 0) / (volumes.length - 1);
        const lastVol = volumes[volumes.length - 1];
        const volRatio = avgVol > 0 ? lastVol / avgVol : 1;

        if (volRatio > 3) {
            const lastC = candles[candles.length - 1];
            if (lastC.close > lastC.open) { bull += 20; r.reasons.push(`🐋 Mega spike volumen ${volRatio.toFixed(1)}x con compra`); }
            else { bear += 20; r.reasons.push(`🐋 Mega spike volumen ${volRatio.toFixed(1)}x con venta`); }
        } else if (volRatio > 1.8) {
            const lastC = candles[candles.length - 1];
            if (lastC.close > lastC.open) { bull += 12; r.reasons.push(`Volumen alto ${volRatio.toFixed(1)}x — interés comprador`); }
            else { bear += 12; r.reasons.push(`Volumen alto ${volRatio.toFixed(1)}x — presión vendedora`); }
        } else if (volRatio < 0.4) {
            r.reasons.push('📉 Volumen muy bajo — sin interés institucional');
            bear += 3;
        }

        // A/D Line
        let adl = 0;
        for (let i = Math.max(0, candles.length - 10); i < candles.length; i++) {
            const c = candles[i];
            const range = c.high - c.low;
            if (range > 0) adl += ((c.close - c.low) - (c.high - c.close)) / range * (c.volume || 0);
        }
        if (adl > 0) { bull += 8; r.reasons.push('A/D positiva — acumulación neta'); }
        else { bear += 8; r.reasons.push('A/D negativa — distribución neta'); }

        // Volume trend
        const midIdx = Math.floor(volumes.length / 2);
        const vol1 = volumes.slice(0, midIdx).reduce((s, v) => s + v, 0) / midIdx;
        const vol2 = volumes.slice(midIdx).reduce((s, v) => s + v, 0) / (volumes.length - midIdx);
        if (vol2 > vol1 * 1.5) { r.reasons.push('Volumen creciente — interés aumentando'); bull += 5; }
        else if (vol2 < vol1 * 0.6) { r.reasons.push('Volumen secándose'); bear += 5; }

        // Climax
        if (volRatio > 3 && closes.length >= 2) {
            const change = Math.abs((closes[closes.length - 1] - closes[closes.length - 2]) / closes[closes.length - 2] * 100);
            if (change > 3) r.reasons.push('⚠️ Posible clímax — cuidado con reversión');
        }

        r.volRatio = volRatio;
        this._calcScore(r, bull, bear);
        return r;
    },

    // === CORRELATIONBOT — Relaciones entre pares ===

    _runCorrelationBot(symbol, prices, allSymbols) {
        const r = { bot: 'correlation', signal: 'neutral', score: 50, reasons: [] };
        let bull = 0, bear = 0;

        const btc = prices['BTC'], sym = prices[symbol];
        if (!btc || !sym) { r.reasons.push('Sin datos'); return r; }

        const btcChg = btc.change || 0, symChg = sym.change || 0;
        const rs = symChg - btcChg;

        if (rs > 3) { bull += 18; r.reasons.push(`🚀 Outperforming BTC +${rs.toFixed(1)}%`); }
        else if (rs > 1) { bull += 8; r.reasons.push(`Outperforming BTC +${rs.toFixed(1)}%`); }
        else if (rs < -3) { bear += 18; r.reasons.push(`💀 Underperforming BTC ${rs.toFixed(1)}%`); }
        else if (rs < -1) { bear += 8; r.reasons.push(`Underperforming BTC ${rs.toFixed(1)}%`); }

        // Alignment
        const aligned = (symChg > 0 && btcChg > 0) || (symChg < 0 && btcChg < 0);
        if (!aligned && Math.abs(symChg) > 1) {
            r.reasons.push('⚠️ Divergente de BTC'); bear += 5;
        }

        // Sector
        const token = CONFIG.TOKENS[symbol];
        const sector = token?.sector || token?.category;
        if (sector) {
            const sectorPairs = allSymbols.filter(s => {
                const t = CONFIG.TOKENS[s];
                return (t?.sector === sector || t?.category === sector) && s !== symbol;
            });
            if (sectorPairs.length > 0) {
                const sectorAvg = sectorPairs.map(s => prices[s]?.change || 0).reduce((a, b) => a + b, 0) / sectorPairs.length;
                const vsSector = symChg - sectorAvg;
                if (vsSector > 2) { bull += 8; r.reasons.push(`Líder sector ${sector} (+${vsSector.toFixed(1)}%)`); }
                else if (vsSector < -2) { bear += 8; r.reasons.push(`Rezagado en sector ${sector}`); }
            }
        }

        // REAL DATA: Trending on CoinGecko
        const trending = this._sentimentData?.trending;
        if (trending) {
            const isTrending = trending.some(t => t.symbol === symbol);
            if (isTrending) {
                bull += 8;
                r.reasons.push(`📈 ${symbol} es trending en CoinGecko`);
            }
        }

        r.relStrength = rs;
        this._calcScore(r, bull, bear);
        return r;
    },

    // === SENTIMENTBOT — REAL Fear & Greed + Social Data ===

    _runSentimentBot(symbol, prices) {
        const r = { bot: 'sentiment', signal: 'neutral', score: 50, reasons: [] };
        let bull = 0, bear = 0;

        // REAL DATA: Fear & Greed Index
        const fng = this._sentimentData?.fearGreed;
        if (fng) {
            r.fearGreedValue = fng.value;
            r.fearGreedLabel = fng.label;

            // Score based on F&G value
            if (fng.value >= 80) {
                bear += 15;
                r.reasons.push(`🔴 Extreme Greed: ${fng.value} — FOMO máximo, riesgo de corrección`);
            } else if (fng.value >= 65) {
                bull += 5; bear += 5;
                r.reasons.push(`🟡 Greed: ${fng.value} — optimismo pero cuidado`);
            } else if (fng.value >= 45) {
                r.reasons.push(`🟡 Neutral: ${fng.value} — mercado indeciso`);
            } else if (fng.value >= 25) {
                bull += 8;
                r.reasons.push(`🟢 Fear: ${fng.value} — oportunidad de compra`);
            } else {
                bull += 15;
                r.reasons.push(`🟢 Extreme Fear: ${fng.value} — "be greedy when others are fearful"`);
            }

            // Trend
            if (fng.trend1d > 5) r.reasons.push(`Sentimiento mejorando: +${fng.trend1d} vs ayer`);
            else if (fng.trend1d < -5) r.reasons.push(`Sentimiento empeorando: ${fng.trend1d} vs ayer`);

            if (fng.trend7d > 15) { bull += 5; r.reasons.push(`Tendencia semanal positiva: +${fng.trend7d}`); }
            else if (fng.trend7d < -15) { bear += 5; r.reasons.push(`Tendencia semanal negativa: ${fng.trend7d}`); }
        } else {
            r.reasons.push('F&G no disponible — usando proxy');
            // Fallback: proxy from prices
            const allChanges = Object.values(prices).map(p => p.change || 0);
            const avg = allChanges.reduce((a, b) => a + b, 0) / (allChanges.length || 1);
            if (avg > 2) { bull += 5; r.reasons.push('Proxy: mercado positivo'); }
            else if (avg < -2) { bear += 5; r.reasons.push('Proxy: mercado negativo'); }
        }

        // REAL DATA: CoinGecko trending
        const trending = this._sentimentData?.trending;
        if (trending && trending.length > 0) {
            const isTrending = trending.some(t => t.symbol === symbol);
            if (isTrending) {
                bull += 10;
                r.reasons.push(`🔥 ${symbol} es TRENDING en CoinGecko — alto interés social`);
            }

            // List trending for context
            const trendNames = trending.slice(0, 3).map(t => t.symbol).join(', ');
            r.reasons.push(`Trending: ${trendNames}`);
            r.trending = trending;
        }

        // REAL DATA: Market cap change
        const global = this._sentimentData?.global;
        if (global) {
            if (global.marketCapChange24h > 3) {
                bull += 5; r.reasons.push(`Capital entrando al mercado: +${global.marketCapChange24h.toFixed(1)}%`);
            } else if (global.marketCapChange24h < -3) {
                bear += 5; r.reasons.push(`Capital saliendo del mercado: ${global.marketCapChange24h.toFixed(1)}%`);
            }
        }

        // Hype vs average
        const symChg = prices[symbol]?.change || 0;
        const allChgs = Object.values(prices).map(p => p.change || 0);
        const avgChg = allChgs.reduce((a, b) => a + b, 0) / (allChgs.length || 1);
        const hype = symChg - avgChg;
        if (hype > 5) { r.reasons.push(`⚡ Alto hype en ${symbol} (+${hype.toFixed(1)}% vs mercado) — posible FOMO`); }
        else if (hype > 2) { r.reasons.push(`Interés en ${symbol} (+${hype.toFixed(1)}%)`); bull += 3; }

        this._calcScore(r, bull, bear);
        return r;
    },

    // === TIMINGBOT — Sesiones y horarios ===

    _runTimingBot(symbol) {
        const r = { bot: 'timing', signal: 'neutral', score: 50, reasons: [] };
        let bull = 0, bear = 0;

        const now = new Date();
        let bsAsHour;
        try {
            bsAsHour = parseInt(now.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires', hour: 'numeric', hour12: false }));
        } catch (e) { bsAsHour = (now.getUTCHours() - 3 + 24) % 24; }

        const utcHour = now.getUTCHours();
        const day = now.getDay();

        // Session
        let session;
        if (utcHour >= 0 && utcHour < 8) session = '🏯 Asia';
        else if (utcHour >= 8 && utcHour < 13) session = '🇪🇺 Europa';
        else if (utcHour >= 13 && utcHour < 21) session = '🇺🇸 US';
        else session = '🌙 Pre-Asia';

        r.reasons.push(`${session} — ${bsAsHour}:00 BsAs`);

        if (utcHour >= 13 && utcHour <= 16) { bull += 12; r.reasons.push('Overlap US-Europa — máxima liquidez y movimiento'); }
        else if (utcHour >= 8 && utcHour <= 10) { bull += 6; r.reasons.push('Open Europa — buena actividad'); }
        else if (utcHour >= 1 && utcHour <= 5) { bear += 8; r.reasons.push('Asia profunda — liquidez reducida, cuidado'); }

        if (day === 0 || day === 6) { bear += 10; r.reasons.push('Fin de semana — spreads amplios, manipulación'); }
        if (utcHour === 0 || utcHour === 8 || utcHour === 16) { r.reasons.push('⏰ Hora de funding rate'); }

        r.session = session;
        this._calcScore(r, bull, bear);
        return r;
    },

    // === HELPERS ===

    _calcScore(r, bull, bear) {
        const total = bull + bear;
        if (total === 0) { r.score = 50; r.signal = 'neutral'; return; }
        if (bull > bear) {
            r.score = Math.min(95, 50 + Math.round((bull / total) * 50));
            r.signal = r.score >= 70 ? 'bullish' : 'lean_bull';
            r.direction = 'LONG';
        } else {
            r.score = Math.max(5, 50 - Math.round((bear / total) * 50));
            r.signal = r.score <= 30 ? 'bearish' : 'lean_bear';
            r.direction = 'SHORT';
        }
    },

    // === AGGREGATE ===

    _aggregate(reports) {
        let weightedScore = 0, totalWeight = 0;
        const allReasons = [];
        let bullV = 0, bearV = 0, neutralV = 0;

        for (const [key, bot] of Object.entries(this.BOTS)) {
            const rpt = reports[key];
            if (!rpt) continue;
            weightedScore += rpt.score * bot.weight;
            totalWeight += bot.weight;

            if (rpt.signal.includes('bull') || rpt.signal === 'good_timing') bullV++;
            else if (rpt.signal.includes('bear') || rpt.signal === 'bad_timing') bearV++;
            else neutralV++;

            if (rpt.reasons.length > 0) allReasons.push(`${bot.emoji} ${rpt.reasons[0]}`);
        }

        const score = totalWeight > 0 ? Math.round(weightedScore / totalWeight) : 50;
        let consensus, consensusColor;
        if (bullV > bearV + 1) { consensus = 'BULLISH'; consensusColor = '#10b981'; }
        else if (bearV > bullV + 1) { consensus = 'BEARISH'; consensusColor = '#f43f5e'; }
        else { consensus = 'MIXED'; consensusColor = '#00d4ff'; }

        return {
            score, consensus, consensusColor,
            bullVotes: bullV, bearVotes: bearV, neutralVotes: neutralV,
            totalBots: bullV + bearV + neutralV,
            topReasons: allReasons.slice(0, 7),
            direction: consensus === 'BULLISH' ? 'LONG' : consensus === 'BEARISH' ? 'SHORT' : null
        };
    },

    // === THESIS SNAPSHOT ===

    getThesisSnapshot(symbol) {
        const rpts = this._reports[symbol];
        if (!rpts) return null;

        const snap = { timestamp: rpts._timestamp, aggregate: rpts._aggregate, bots: {} };
        for (const [key, bot] of Object.entries(this.BOTS)) {
            const rr = rpts[key];
            if (rr) snap.bots[key] = { name: bot.name, emoji: bot.emoji, signal: rr.signal, score: rr.score, reasons: rr.reasons?.slice(0, 3) || [] };
        }

        // Include real data snapshot
        snap.fearGreed = this._sentimentData?.fearGreed || null;
        snap.btcDominance = this._sentimentData?.global?.btcDominance || null;
        snap.trending = this._sentimentData?.trending?.map(t => t.symbol) || [];

        return snap;
    },

    // === RENDER ===

    renderForAnalysis(symbol) {
        const rpts = this._reports[symbol];
        if (!rpts || !rpts._aggregate) return '';

        const agg = rpts._aggregate;
        const fng = this._sentimentData?.fearGreed;
        const global = this._sentimentData?.global;

        let html = `
            <div class="bots-title" style="margin-top:14px;">🧠 Master Bots (${agg.totalBots} analistas)</div>

            ${fng ? `
            <div class="master-fng">
                <div class="master-fng-header">
                    <span>Fear & Greed Index</span>
                    <span class="master-fng-value" style="color:${fng.value >= 65 ? 'var(--green)' : fng.value <= 35 ? 'var(--red)' : 'var(--yellow)'}">${fng.value}</span>
                </div>
                <div class="master-fng-label">${fng.label}</div>
                <div class="master-fng-bar">
                    <div class="master-fng-fill" style="width:${fng.value}%; background:${
                        fng.value >= 75 ? '#10b981' : fng.value >= 55 ? '#86efac' : fng.value >= 45 ? '#00d4ff' : fng.value >= 25 ? '#fca5a5' : '#f43f5e'
                    }"></div>
                </div>
                <div class="master-fng-trend">
                    1d: ${fng.trend1d > 0 ? '+' : ''}${fng.trend1d} · 7d: ${fng.trend7d > 0 ? '+' : ''}${fng.trend7d}
                    ${global ? ` · BTC Dom: ${global.btcDominance.toFixed(1)}%` : ''}
                </div>
            </div>
            ` : ''}

            <div class="master-consensus">
                <div class="master-consensus-header">
                    <span class="master-consensus-label" style="color:${agg.consensusColor}">${agg.consensus}</span>
                    <span class="master-consensus-score">${agg.score}/100</span>
                    <span class="master-consensus-votes">🟢${agg.bullVotes} · 🔴${agg.bearVotes} · 🟡${agg.neutralVotes}</span>
                </div>
                <div class="master-consensus-bar">
                    <div class="master-bar-bull" style="width:${(agg.bullVotes / Math.max(1, agg.totalBots) * 100).toFixed(0)}%"></div>
                    <div class="master-bar-bear" style="width:${(agg.bearVotes / Math.max(1, agg.totalBots) * 100).toFixed(0)}%"></div>
                </div>
            </div>
        `;

        for (const [key, bot] of Object.entries(this.BOTS)) {
            const rr = rpts[key];
            if (!rr) continue;
            const sigColor = rr.signal.includes('bull') || rr.signal === 'good_timing' ? '#10b981' :
                             rr.signal.includes('bear') || rr.signal === 'bad_timing' ? '#f43f5e' : '#00d4ff';
            html += `
                <div class="master-bot-report">
                    <div class="master-bot-header">
                        <span class="master-bot-name">${bot.emoji} ${bot.name}</span>
                        <span class="master-bot-score" style="color:${sigColor}">${rr.score}</span>
                    </div>
                    <div class="master-bot-reasons">${rr.reasons.slice(0, 2).join(' · ')}</div>
                </div>
            `;
        }

        if (agg.topReasons.length > 0) {
            html += `<div class="master-top-reasons"><div class="intel-section-title">Tesis</div>
                ${agg.topReasons.map(rr => `<div class="master-reason-item">${rr}</div>`).join('')}
            </div>`;
        }

        return html;
    }
};
