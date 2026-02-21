/* ========================================
   INDICATORS - Technical Analysis Engine
   Trading Platform PRO v2.0
   ======================================== */

const Indicators = {

    // ==========================================
    //  MOVING AVERAGES
    // ==========================================

    /** EMA - Exponential Moving Average */
    ema(data, period) {
        if (!data.length || data.length < period) return data[data.length - 1] || 0;
        const k = 2 / (period + 1);
        let val = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
        for (let i = period; i < data.length; i++) {
            val = data[i] * k + val * (1 - k);
        }
        return val;
    },

    /** EMA Series - Devuelve array completo de EMAs (útil para MACD y charts) */
    emaSeries(data, period) {
        if (!data.length || data.length < period) return [];
        const k = 2 / (period + 1);
        const result = [];
        let val = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
        result.push(val);
        for (let i = period; i < data.length; i++) {
            val = data[i] * k + val * (1 - k);
            result.push(val);
        }
        return result;
    },

    /** SMA - Simple Moving Average */
    sma(data, period) {
        if (data.length < period) return data[data.length - 1] || 0;
        return data.slice(-period).reduce((a, b) => a + b, 0) / period;
    },

    /** SMA Series - Array completo */
    smaSeries(data, period) {
        if (data.length < period) return [];
        const result = [];
        for (let i = period - 1; i < data.length; i++) {
            const slice = data.slice(i - period + 1, i + 1);
            result.push(slice.reduce((a, b) => a + b, 0) / period);
        }
        return result;
    },

    /** WMA - Weighted Moving Average */
    wma(data, period) {
        if (data.length < period) return data[data.length - 1] || 0;
        const slice = data.slice(-period);
        const weights = Array.from({ length: period }, (_, i) => i + 1);
        const weightSum = weights.reduce((a, b) => a + b, 0);
        return slice.reduce((sum, val, i) => sum + val * weights[i], 0) / weightSum;
    },

    // ==========================================
    //  OSCILLATORS
    // ==========================================

    /** RSI - Relative Strength Index (método Wilder correcto) */
    rsi(closes, period = 14) {
        if (closes.length < period + 1) return 50;
        let avgGain = 0;
        let avgLoss = 0;
        // Primer cálculo: promedio simple
        for (let i = 1; i <= period; i++) {
            const change = closes[i] - closes[i - 1];
            if (change > 0) avgGain += change;
            else avgLoss -= change;
        }
        avgGain /= period;
        avgLoss /= period;
        // Suavizado Wilder para el resto de datos
        for (let i = period + 1; i < closes.length; i++) {
            const change = closes[i] - closes[i - 1];
            if (change > 0) {
                avgGain = (avgGain * (period - 1) + change) / period;
                avgLoss = (avgLoss * (period - 1)) / period;
            } else {
                avgGain = (avgGain * (period - 1)) / period;
                avgLoss = (avgLoss * (period - 1) - change) / period;
            }
        }
        if (avgLoss === 0) return 100;
        const rs = avgGain / avgLoss;
        return 100 - (100 / (1 + rs));
    },

    /** RSI Series - Array completo para divergencias */
    rsiSeries(closes, period = 14) {
        if (closes.length < period + 1) return [];
        const result = [];
        let avgGain = 0;
        let avgLoss = 0;
        for (let i = 1; i <= period; i++) {
            const change = closes[i] - closes[i - 1];
            if (change > 0) avgGain += change;
            else avgLoss -= change;
        }
        avgGain /= period;
        avgLoss /= period;
        result.push(avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss)));
        for (let i = period + 1; i < closes.length; i++) {
            const change = closes[i] - closes[i - 1];
            if (change > 0) {
                avgGain = (avgGain * (period - 1) + change) / period;
                avgLoss = (avgLoss * (period - 1)) / period;
            } else {
                avgGain = (avgGain * (period - 1)) / period;
                avgLoss = (avgLoss * (period - 1) - change) / period;
            }
            result.push(avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss)));
        }
        return result;
    },

    /** MACD - Moving Average Convergence Divergence (CORRECTO) */
    macd(closes, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
        if (closes.length < slowPeriod + signalPeriod) {
            return { macd: 0, signal: 0, histogram: 0, series: [] };
        }
        // Calcular series completas de EMA fast y slow
        const emaFastSeries = this.emaSeries(closes, fastPeriod);
        const emaSlowSeries = this.emaSeries(closes, slowPeriod);
        // MACD line = EMA fast - EMA slow (alinear por el final)
        const offset = emaFastSeries.length - emaSlowSeries.length;
        const macdSeries = emaSlowSeries.map((slow, i) => emaFastSeries[i + offset] - slow);
        // Signal line = EMA de 9 períodos del MACD line
        const signalSeries = this.emaSeries(macdSeries, signalPeriod);
        // Histogram = MACD - Signal
        const sigOffset = macdSeries.length - signalSeries.length;
        const histogramSeries = signalSeries.map((sig, i) => macdSeries[i + sigOffset] - sig);

        const macdVal = macdSeries[macdSeries.length - 1];
        const signalVal = signalSeries[signalSeries.length - 1];
        return {
            macd: macdVal,
            signal: signalVal,
            histogram: macdVal - signalVal,
            // Últimos N valores para el chart
            series: histogramSeries.slice(-50).map((h, i) => ({
                macd: macdSeries[sigOffset + i + (histogramSeries.length - Math.min(50, histogramSeries.length))],
                signal: signalSeries[i + (histogramSeries.length - Math.min(50, histogramSeries.length))],
                histogram: h
            }))
        };
    },

    /** Stochastic Oscillator (CORRECTO - %K con SMA para %D) */
    stochastic(candles, kPeriod = 14, dPeriod = 3) {
        if (candles.length < kPeriod + dPeriod) return { k: 50, d: 50 };
        // Calcular serie de %K
        const kSeries = [];
        for (let i = kPeriod - 1; i < candles.length; i++) {
            const slice = candles.slice(i - kPeriod + 1, i + 1);
            const highestHigh = Math.max(...slice.map(c => c.h));
            const lowestLow = Math.min(...slice.map(c => c.l));
            const range = highestHigh - lowestLow;
            kSeries.push(range === 0 ? 50 : ((candles[i].c - lowestLow) / range) * 100);
        }
        // %D = SMA de dPeriod sobre %K
        const dSeries = [];
        for (let i = dPeriod - 1; i < kSeries.length; i++) {
            const slice = kSeries.slice(i - dPeriod + 1, i + 1);
            dSeries.push(slice.reduce((a, b) => a + b, 0) / dPeriod);
        }
        return {
            k: kSeries[kSeries.length - 1],
            d: dSeries[dSeries.length - 1]
        };
    },

    /** CCI - Commodity Channel Index */
    cci(candles, period = 20) {
        if (candles.length < period) return 0;
        const slice = candles.slice(-period);
        const typicalPrices = slice.map(c => (c.h + c.l + c.c) / 3);
        const mean = typicalPrices.reduce((a, b) => a + b, 0) / period;
        const meanDev = typicalPrices.reduce((sum, tp) => sum + Math.abs(tp - mean), 0) / period;
        if (meanDev === 0) return 0;
        return (typicalPrices[typicalPrices.length - 1] - mean) / (0.015 * meanDev);
    },

    /** Williams %R */
    williamsR(candles, period = 14) {
        if (candles.length < period) return -50;
        const slice = candles.slice(-period);
        const highestHigh = Math.max(...slice.map(c => c.h));
        const lowestLow = Math.min(...slice.map(c => c.l));
        const range = highestHigh - lowestLow;
        if (range === 0) return -50;
        return ((highestHigh - candles[candles.length - 1].c) / range) * -100;
    },

    // ==========================================
    //  VOLATILITY
    // ==========================================

    /** ATR - Average True Range */
    atr(candles, period = 14) {
        if (candles.length < period + 1) return 0;
        const trs = [];
        for (let i = 1; i < candles.length; i++) {
            trs.push(Math.max(
                candles[i].h - candles[i].l,
                Math.abs(candles[i].h - candles[i - 1].c),
                Math.abs(candles[i].l - candles[i - 1].c)
            ));
        }
        // ATR con suavizado Wilder
        let atrVal = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
        for (let i = period; i < trs.length; i++) {
            atrVal = (atrVal * (period - 1) + trs[i]) / period;
        }
        return atrVal;
    },

    /** Bollinger Bands */
    bollingerBands(closes, period = 20, stdDev = 2) {
        if (closes.length < period) {
            const p = closes[closes.length - 1] || 0;
            return { upper: p, middle: p, lower: p, width: 0, percentB: 0.5 };
        }
        const slice = closes.slice(-period);
        const middle = slice.reduce((a, b) => a + b, 0) / period;
        const variance = slice.reduce((sum, x) => sum + Math.pow(x - middle, 2), 0) / period;
        const std = Math.sqrt(variance);
        const upper = middle + std * stdDev;
        const lower = middle - std * stdDev;
        const price = closes[closes.length - 1];
        const bandWidth = upper - lower;
        return {
            upper,
            middle,
            lower,
            width: middle > 0 ? (bandWidth / middle) * 100 : 0,
            // %B: posición del precio dentro de las bandas (0 = lower, 1 = upper)
            percentB: bandWidth > 0 ? (price - lower) / bandWidth : 0.5
        };
    },

    /** Keltner Channels */
    keltnerChannels(candles, emaPeriod = 20, atrPeriod = 14, multiplier = 2) {
        if (candles.length < Math.max(emaPeriod, atrPeriod + 1)) {
            const p = candles[candles.length - 1]?.c || 0;
            return { upper: p, middle: p, lower: p };
        }
        const closes = candles.map(c => c.c);
        const middle = this.ema(closes, emaPeriod);
        const atrVal = this.atr(candles, atrPeriod);
        return {
            upper: middle + atrVal * multiplier,
            middle,
            lower: middle - atrVal * multiplier
        };
    },

    // ==========================================
    //  VOLUME
    // ==========================================

    /** Volume Analysis */
    volumeAnalysis(candles, period = 20) {
        if (candles.length < period) return { average: 0, current: 0, ratio: 1, trend: 'normal' };
        const vols = candles.slice(-period).map(c => c.v);
        const average = vols.reduce((a, b) => a + b, 0) / period;
        const current = vols[vols.length - 1];
        const ratio = average > 0 ? current / average : 1;
        let trend = 'normal';
        if (ratio > 3) trend = 'spike';
        else if (ratio > 1.5) trend = 'high';
        else if (ratio < 0.5) trend = 'low';
        return { average, current, ratio, trend };
    },

    /** OBV - On Balance Volume */
    obv(candles) {
        if (candles.length < 2) return { value: 0, trend: 'neutral' };
        let obvVal = 0;
        const obvSeries = [0];
        for (let i = 1; i < candles.length; i++) {
            if (candles[i].c > candles[i - 1].c) obvVal += candles[i].v;
            else if (candles[i].c < candles[i - 1].c) obvVal -= candles[i].v;
            obvSeries.push(obvVal);
        }
        // Tendencia OBV: comparar EMA corta vs larga del OBV
        const obvEma5 = this.ema(obvSeries, Math.min(5, obvSeries.length));
        const obvEma13 = this.ema(obvSeries, Math.min(13, obvSeries.length));
        let trend = 'neutral';
        if (obvEma5 > obvEma13) trend = 'bullish';
        else if (obvEma5 < obvEma13) trend = 'bearish';
        return { value: obvVal, trend };
    },

    /** VWAP - Volume Weighted Average Price (intraday) */
    vwap(candles) {
        if (candles.length < 1) return 0;
        let cumVolume = 0;
        let cumVwap = 0;
        for (const c of candles) {
            const tp = (c.h + c.l + c.c) / 3;
            cumVolume += c.v;
            cumVwap += tp * c.v;
        }
        return cumVolume > 0 ? cumVwap / cumVolume : candles[candles.length - 1].c;
    },

    // ==========================================
    //  TREND
    // ==========================================

    /** ADX - Average Directional Index (fuerza de tendencia) */
    adx(candles, period = 14) {
        if (candles.length < period * 2 + 1) return { adx: 25, plusDI: 0, minusDI: 0, strength: 'weak' };
        const plusDM = [];
        const minusDM = [];
        const tr = [];
        for (let i = 1; i < candles.length; i++) {
            const high = candles[i].h;
            const low = candles[i].l;
            const prevHigh = candles[i - 1].h;
            const prevLow = candles[i - 1].l;
            const prevClose = candles[i - 1].c;
            const upMove = high - prevHigh;
            const downMove = prevLow - low;
            plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
            minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
            tr.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
        }
        // Suavizado Wilder
        let smoothPlusDM = plusDM.slice(0, period).reduce((a, b) => a + b, 0);
        let smoothMinusDM = minusDM.slice(0, period).reduce((a, b) => a + b, 0);
        let smoothTR = tr.slice(0, period).reduce((a, b) => a + b, 0);
        const dxSeries = [];
        for (let i = period; i < plusDM.length; i++) {
            smoothPlusDM = smoothPlusDM - smoothPlusDM / period + plusDM[i];
            smoothMinusDM = smoothMinusDM - smoothMinusDM / period + minusDM[i];
            smoothTR = smoothTR - smoothTR / period + tr[i];
            const plusDI = smoothTR > 0 ? (smoothPlusDM / smoothTR) * 100 : 0;
            const minusDI = smoothTR > 0 ? (smoothMinusDM / smoothTR) * 100 : 0;
            const diSum = plusDI + minusDI;
            dxSeries.push(diSum > 0 ? Math.abs(plusDI - minusDI) / diSum * 100 : 0);
        }
        if (dxSeries.length < period) return { adx: 25, plusDI: 0, minusDI: 0, strength: 'weak' };
        let adxVal = dxSeries.slice(0, period).reduce((a, b) => a + b, 0) / period;
        for (let i = period; i < dxSeries.length; i++) {
            adxVal = (adxVal * (period - 1) + dxSeries[i]) / period;
        }
        const lastPlusDI = smoothTR > 0 ? (smoothPlusDM / smoothTR) * 100 : 0;
        const lastMinusDI = smoothTR > 0 ? (smoothMinusDM / smoothTR) * 100 : 0;
        let strength = 'weak';
        if (adxVal >= 50) strength = 'extreme';
        else if (adxVal >= 25) strength = 'strong';
        return { adx: adxVal, plusDI: lastPlusDI, minusDI: lastMinusDI, strength };
    },

    /** Ichimoku Cloud (simplificado) */
    ichimoku(candles, tenkan = 9, kijun = 26, senkou = 52) {
        if (candles.length < senkou) {
            return { tenkanSen: 0, kijunSen: 0, signal: 'neutral' };
        }
        const periodHL = (slice) => {
            const highs = slice.map(c => c.h);
            const lows = slice.map(c => c.l);
            return (Math.max(...highs) + Math.min(...lows)) / 2;
        };
        const tenkanSen = periodHL(candles.slice(-tenkan));
        const kijunSen = periodHL(candles.slice(-kijun));
        const senkouA = (tenkanSen + kijunSen) / 2;
        const senkouB = periodHL(candles.slice(-senkou));
        const price = candles[candles.length - 1].c;
        let signal = 'neutral';
        if (price > senkouA && price > senkouB && tenkanSen > kijunSen) signal = 'strong_bullish';
        else if (price > senkouA || price > senkouB) signal = 'bullish';
        else if (price < senkouA && price < senkouB && tenkanSen < kijunSen) signal = 'strong_bearish';
        else if (price < senkouA || price < senkouB) signal = 'bearish';
        return { tenkanSen, kijunSen, senkouA, senkouB, signal };
    },

    // ==========================================
    //  SUPPORT / RESISTANCE
    // ==========================================

    /** Support and Resistance con pivot points */
    supportResistance(candles, lookback = 20) {
        if (candles.length < lookback) return { support: 0, resistance: 0, pivots: [] };
        const slice = candles.slice(-lookback);
        const support = Math.min(...slice.map(c => c.l));
        const resistance = Math.max(...slice.map(c => c.h));
        // Pivot Point clásico
        const last = candles[candles.length - 1];
        const pivot = (last.h + last.l + last.c) / 3;
        const r1 = 2 * pivot - last.l;
        const s1 = 2 * pivot - last.h;
        const r2 = pivot + (last.h - last.l);
        const s2 = pivot - (last.h - last.l);
        return { support, resistance, pivot, r1, r2, s1, s2 };
    },

    /** Fibonacci Retracement Levels */
    fibonacci(candles, lookback = 50) {
        if (candles.length < lookback) return null;
        const slice = candles.slice(-lookback);
        const high = Math.max(...slice.map(c => c.h));
        const low = Math.min(...slice.map(c => c.l));
        const diff = high - low;
        return {
            level_0: high,
            level_236: high - diff * 0.236,
            level_382: high - diff * 0.382,
            level_500: high - diff * 0.5,
            level_618: high - diff * 0.618,
            level_786: high - diff * 0.786,
            level_100: low,
            high,
            low
        };
    },

    // ==========================================
    //  PATTERN DETECTION
    // ==========================================

    /** Detectar divergencia RSI vs Precio */
    detectDivergence(candles, lookback = 20) {
        if (candles.length < lookback + 14) return { type: 'none', description: '' };
        const closes = candles.map(c => c.c);
        const rsiValues = this.rsiSeries(closes);
        if (rsiValues.length < lookback) return { type: 'none', description: '' };

        const recentCloses = closes.slice(-lookback);
        const recentRSI = rsiValues.slice(-lookback);

        // Buscar mínimos/máximos locales
        const half = Math.floor(lookback / 2);
        const priceFirst = Math.min(...recentCloses.slice(0, half));
        const priceLast = Math.min(...recentCloses.slice(half));
        const rsiFirst = Math.min(...recentRSI.slice(0, half));
        const rsiLast = Math.min(...recentRSI.slice(half));

        // Divergencia alcista: precio hace lower low pero RSI hace higher low
        if (priceLast < priceFirst && rsiLast > rsiFirst) {
            return { type: 'bullish', description: 'Divergencia alcista RSI - Posible reversión al alza' };
        }

        const priceHighFirst = Math.max(...recentCloses.slice(0, half));
        const priceHighLast = Math.max(...recentCloses.slice(half));
        const rsiHighFirst = Math.max(...recentRSI.slice(0, half));
        const rsiHighLast = Math.max(...recentRSI.slice(half));

        // Divergencia bajista: precio hace higher high pero RSI hace lower high
        if (priceHighLast > priceHighFirst && rsiHighLast < rsiHighFirst) {
            return { type: 'bearish', description: 'Divergencia bajista RSI - Posible reversión a la baja' };
        }

        return { type: 'none', description: '' };
    },

    /** Trend Detection mejorado */
    detectTrend(candles) {
        if (candles.length < 50) {
            if (candles.length < 21) return { trend: 'neutral', strength: 0 };
            const closes = candles.map(c => c.c);
            const ema9 = this.ema(closes, 9);
            const ema21 = this.ema(closes, 21);
            const price = closes[closes.length - 1];
            if (ema9 > ema21 && price > ema9) return { trend: 'bullish', strength: 60 };
            if (ema9 < ema21 && price < ema9) return { trend: 'bearish', strength: 60 };
            return { trend: 'neutral', strength: 30 };
        }
        const closes = candles.map(c => c.c);
        const price = closes[closes.length - 1];
        const ema9 = this.ema(closes, 9);
        const ema21 = this.ema(closes, 21);
        const ema50 = this.ema(closes, 50);
        let bullScore = 0;
        let bearScore = 0;
        // EMA alignment
        if (ema9 > ema21) bullScore += 25; else bearScore += 25;
        if (ema21 > ema50) bullScore += 25; else bearScore += 25;
        if (price > ema9) bullScore += 15; else bearScore += 15;
        if (price > ema50) bullScore += 15; else bearScore += 15;
        // ADX para fuerza
        const adxData = this.adx(candles);
        if (adxData.adx > 25) {
            if (adxData.plusDI > adxData.minusDI) bullScore += 20;
            else bearScore += 20;
        }
        if (bullScore > bearScore + 20) return { trend: 'bullish', strength: bullScore };
        if (bearScore > bullScore + 20) return { trend: 'bearish', strength: bearScore };
        return { trend: 'neutral', strength: Math.max(bullScore, bearScore) };
    },

    // ==========================================
    //  SCORING & SIGNALS
    // ==========================================

    /** Generar señal de trading basada en todos los indicadores */
    generateSignal(candles) {
        if (!candles || candles.length < 30) return { direction: 'NEUTRAL', score: 0, reasons: [] };

        const closes = candles.map(c => c.c);
        const price = closes[closes.length - 1];
        let bullPoints = 0;
        let bearPoints = 0;
        const reasons = [];

        // 1. Trend
        const trend = this.detectTrend(candles);
        if (trend.trend === 'bullish') { bullPoints += 20; reasons.push('Tendencia alcista'); }
        else if (trend.trend === 'bearish') { bearPoints += 20; reasons.push('Tendencia bajista'); }

        // 2. RSI
        const rsiVal = this.rsi(closes);
        if (rsiVal < 30) { bullPoints += 15; reasons.push(`RSI sobreventa (${rsiVal.toFixed(0)})`); }
        else if (rsiVal < 45) { bullPoints += 5; }
        else if (rsiVal > 70) { bearPoints += 15; reasons.push(`RSI sobrecompra (${rsiVal.toFixed(0)})`); }
        else if (rsiVal > 55) { bearPoints += 5; }

        // 3. MACD
        const macdData = this.macd(closes);
        if (macdData.histogram > 0 && macdData.macd > macdData.signal) {
            bullPoints += 15; reasons.push('MACD alcista');
        } else if (macdData.histogram < 0 && macdData.macd < macdData.signal) {
            bearPoints += 15; reasons.push('MACD bajista');
        }

        // 4. Bollinger Bands
        const bb = this.bollingerBands(closes);
        if (bb.percentB < 0.1) { bullPoints += 10; reasons.push('Precio en BB inferior'); }
        else if (bb.percentB > 0.9) { bearPoints += 10; reasons.push('Precio en BB superior'); }

        // 5. Stochastic
        const stoch = this.stochastic(candles);
        if (stoch.k < 20 && stoch.d < 20) { bullPoints += 10; reasons.push('Stoch sobreventa'); }
        else if (stoch.k > 80 && stoch.d > 80) { bearPoints += 10; reasons.push('Stoch sobrecompra'); }

        // 6. OBV
        const obvData = this.obv(candles);
        if (obvData.trend === 'bullish') { bullPoints += 10; reasons.push('OBV alcista'); }
        else if (obvData.trend === 'bearish') { bearPoints += 10; reasons.push('OBV bajista'); }

        // 7. Divergencia
        const div = this.detectDivergence(candles);
        if (div.type === 'bullish') { bullPoints += 15; reasons.push(div.description); }
        else if (div.type === 'bearish') { bearPoints += 15; reasons.push(div.description); }

        // Resultado
        const total = bullPoints + bearPoints;
        if (bullPoints > bearPoints + 15) {
            return { direction: 'LONG', score: Math.round((bullPoints / Math.max(total, 1)) * 100), reasons };
        }
        if (bearPoints > bullPoints + 15) {
            return { direction: 'SHORT', score: Math.round((bearPoints / Math.max(total, 1)) * 100), reasons };
        }
        return { direction: 'NEUTRAL', score: Math.round(50 - Math.abs(bullPoints - bearPoints)), reasons };
    },

    // ==========================================
    //  CALCULATE ALL (para UI)
    // ==========================================

    /** Calcula todos los indicadores principales de una vez */
    calculateAll(candles) {
        if (!candles || candles.length < 21) {
            return {
                rsi: 50, ema9: 0, ema21: 0, ema50: 0, atr: 0,
                macd: { macd: 0, signal: 0, histogram: 0, series: [] },
                bb: { upper: 0, middle: 0, lower: 0, width: 0, percentB: 0.5 },
                stochastic: { k: 50, d: 50 },
                volume: { average: 0, current: 0, ratio: 1, trend: 'normal' },
                obv: { value: 0, trend: 'neutral' },
                vwap: 0,
                trend: { trend: 'neutral', strength: 0 },
                divergence: { type: 'none', description: '' },
                sr: { support: 0, resistance: 0 },
                signal: { direction: 'NEUTRAL', score: 0, reasons: [] }
            };
        }
        const closes = candles.map(c => c.c);
        return {
            rsi: this.rsi(closes),
            ema9: this.ema(closes, 9),
            ema21: this.ema(closes, 21),
            ema50: candles.length >= 50 ? this.ema(closes, 50) : 0,
            atr: this.atr(candles),
            macd: this.macd(closes),
            bb: this.bollingerBands(closes),
            stochastic: this.stochastic(candles),
            volume: this.volumeAnalysis(candles),
            obv: this.obv(candles),
            vwap: this.vwap(candles),
            trend: this.detectTrend(candles),
            divergence: this.detectDivergence(candles),
            sr: this.supportResistance(candles),
            signal: this.generateSignal(candles)
        };
    }
};
