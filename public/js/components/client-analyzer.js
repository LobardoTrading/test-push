/* ========================================
   CLIENT-SIDE ANALYZER
   Fallback analysis when API is unavailable
   TheRealShortShady v7.0
   ======================================== */

const ClientAnalyzer = {

    // ATR multipliers for TP/SL calculation
    _atrMultipliers: {
        '1m':  { tp: 2.0, sl: 0.8 },
        '3m':  { tp: 2.2, sl: 0.9 },
        '5m':  { tp: 2.5, sl: 1.0 },
        '15m': { tp: 2.8, sl: 1.2 },
        '30m': { tp: 3.0, sl: 1.4 },
        '1h':  { tp: 3.2, sl: 1.6 },
        '4h':  { tp: 3.8, sl: 2.0 },
        '1d':  { tp: 4.0, sl: 2.2 },
    },

    // Fallback percentages when ATR is zero
    _fallbackPct: {
        '1m':  { tp: 0.004, sl: 0.0015 },
        '3m':  { tp: 0.006, sl: 0.0025 },
        '5m':  { tp: 0.009, sl: 0.004 },
        '15m': { tp: 0.015, sl: 0.007 },
        '30m': { tp: 0.022, sl: 0.010 },
        '1h':  { tp: 0.030, sl: 0.015 },
        '4h':  { tp: 0.055, sl: 0.028 },
        '1d':  { tp: 0.080, sl: 0.045 },
    },

    /**
     * Main analyze function - works entirely client-side
     */
    analyze(symbol, direction, leverage, timeframe) {
        const candles = State.candles;
        if (!candles || candles.length < 21) {
            return this._createResult('WAIT', 'NEUTRAL', 30, 'Datos insuficientes');
        }

        const closes = candles.map(c => c.c);
        const highs = candles.map(c => c.h);
        const lows = candles.map(c => c.l);
        const volumes = candles.map(c => c.v);
        const price = closes[closes.length - 1];

        // Calculate all indicators
        const indicators = this._calculateIndicators(closes, highs, lows, volumes);

        // Score the setup
        const { score, reasons, suggestedDirection } = this._scoreSetup(indicators, direction);

        // Determine decision
        let decision = 'WAIT';
        let finalDirection = direction || suggestedDirection;

        if (score >= 70) {
            decision = 'ENTER';
        } else if (score >= 55) {
            decision = 'WAIT';
        } else {
            decision = 'CANCEL';
        }

        // If direction doesn't match indicators, reduce confidence
        if (direction && direction !== suggestedDirection && suggestedDirection !== 'NEUTRAL') {
            decision = 'WAIT';
        }

        // Calculate TP/SL based on ATR
        const { tp, sl, liq, atr } = this._calculateLevels(
            price, finalDirection, leverage, timeframe, highs, lows
        );

        // Build reason string
        const topReasons = reasons.slice(0, 3).map(r => r.text).join(' | ');

        // Calculate R:R
        const tpDist = Math.abs(tp - price);
        const slDist = Math.abs(sl - price);
        const rr = slDist > 0 ? (tpDist / slDist).toFixed(1) : '?';

        return {
            symbol: symbol,
            direction: finalDirection,
            decision: decision,
            confidence: Math.min(95, Math.max(20, score)),
            price: price,
            tp: tp,
            sl: sl,
            liq: liq,
            leverage: leverage,
            timeframe: timeframe,
            rr_ratio: rr,
            reason: topReasons || 'Análisis técnico automático',
            summary: `${finalDirection} con ${score}% confianza`,
            indicators: indicators,
            _reasons: reasons,
            _atr: atr,
            _clientSide: true
        };
    },

    _calculateIndicators(closes, highs, lows, volumes) {
        const len = closes.length;
        const price = closes[len - 1];

        // EMAs
        const ema9 = Indicators.ema(closes, 9);
        const ema21 = Indicators.ema(closes, 21);
        const ema50 = Indicators.ema(closes, 50);

        // RSI
        const rsi = Indicators.rsi(closes, 14);

        // MACD
        const macdData = Indicators.macd(closes);
        const macd = macdData.macd;
        const signal = macdData.signal;
        const histogram = macdData.histogram;

        // Bollinger Bands
        const bb = Indicators.bollingerBands(closes, 20, 2);

        // ATR
        const atr = this._calculateATR(highs, lows, closes, 14);

        // Volume analysis
        const avgVolume = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
        const currentVolume = volumes[len - 1];
        const volumeRatio = avgVolume > 0 ? currentVolume / avgVolume : 1;

        // Trend
        const trend = ema9 > ema21 ? 'UP' : ema9 < ema21 ? 'DOWN' : 'FLAT';

        return {
            price,
            ema9,
            ema21,
            ema50,
            rsi,
            macd,
            signal,
            histogram,
            bb,
            atr,
            volumeRatio,
            trend
        };
    },

    _calculateATR(highs, lows, closes, period = 14) {
        if (highs.length < period + 1) return 0;

        let atr = 0;
        for (let i = 1; i <= period; i++) {
            const tr = Math.max(
                highs[i] - lows[i],
                Math.abs(highs[i] - closes[i - 1]),
                Math.abs(lows[i] - closes[i - 1])
            );
            atr += tr;
        }
        atr /= period;

        for (let i = period + 1; i < closes.length; i++) {
            const tr = Math.max(
                highs[i] - lows[i],
                Math.abs(highs[i] - closes[i - 1]),
                Math.abs(lows[i] - closes[i - 1])
            );
            atr = (atr * (period - 1) + tr) / period;
        }

        return atr;
    },

    _scoreSetup(ind, requestedDirection) {
        let bullScore = 0;
        let bearScore = 0;
        const reasons = [];

        // 1. EMA Structure (25 points max)
        if (ind.ema9 > ind.ema21) {
            bullScore += 15;
            if (ind.price > ind.ema9) {
                bullScore += 10;
                reasons.push({ type: 'bull', weight: 10, text: 'Precio sobre EMAs alcistas' });
            }
        } else if (ind.ema9 < ind.ema21) {
            bearScore += 15;
            if (ind.price < ind.ema9) {
                bearScore += 10;
                reasons.push({ type: 'bear', weight: 10, text: 'Precio bajo EMAs bajistas' });
            }
        }

        // 2. RSI (20 points max)
        if (ind.rsi < 30) {
            bullScore += 15;
            reasons.push({ type: 'bull', weight: 15, text: `RSI sobreventa (${ind.rsi.toFixed(0)})` });
        } else if (ind.rsi < 40) {
            bullScore += 8;
        } else if (ind.rsi > 70) {
            bearScore += 15;
            reasons.push({ type: 'bear', weight: 15, text: `RSI sobrecompra (${ind.rsi.toFixed(0)})` });
        } else if (ind.rsi > 60) {
            bearScore += 8;
        } else if (ind.rsi >= 45 && ind.rsi <= 55) {
            // Neutral RSI
        }

        // 3. MACD (20 points max)
        if (ind.histogram > 0 && ind.macd > ind.signal) {
            bullScore += 15;
            reasons.push({ type: 'bull', weight: 15, text: 'MACD alcista con histograma positivo' });
        } else if (ind.histogram < 0 && ind.macd < ind.signal) {
            bearScore += 15;
            reasons.push({ type: 'bear', weight: 15, text: 'MACD bajista con histograma negativo' });
        }

        // 4. Bollinger Bands (15 points max)
        if (ind.bb) {
            const bbWidth = (ind.bb.upper - ind.bb.lower) / ind.bb.middle;
            if (ind.price <= ind.bb.lower * 1.005) {
                bullScore += 12;
                reasons.push({ type: 'bull', weight: 12, text: 'Tocando banda inferior BB' });
            } else if (ind.price >= ind.bb.upper * 0.995) {
                bearScore += 12;
                reasons.push({ type: 'bear', weight: 12, text: 'Tocando banda superior BB' });
            }
            if (bbWidth < 0.03) {
                reasons.push({ type: 'neutral', weight: 5, text: 'BB comprimidas - breakout inminente' });
            }
        }

        // 5. Volume (10 points max)
        if (ind.volumeRatio > 1.5) {
            if (ind.trend === 'UP') bullScore += 8;
            else if (ind.trend === 'DOWN') bearScore += 8;
            reasons.push({ type: 'neutral', weight: 8, text: `Volumen alto (${ind.volumeRatio.toFixed(1)}x)` });
        }

        // 6. Trend alignment (10 points max)
        if (ind.trend === 'UP' && ind.ema21 > ind.ema50) {
            bullScore += 10;
        } else if (ind.trend === 'DOWN' && ind.ema21 < ind.ema50) {
            bearScore += 10;
        }

        // Determine direction
        let suggestedDirection = 'NEUTRAL';
        let score = 50;

        if (bullScore > bearScore + 10) {
            suggestedDirection = 'LONG';
            score = Math.min(95, 50 + bullScore - bearScore);
        } else if (bearScore > bullScore + 10) {
            suggestedDirection = 'SHORT';
            score = Math.min(95, 50 + bearScore - bullScore);
        } else {
            score = 40 + Math.random() * 10; // Uncertain
        }

        // Penalty if requested direction conflicts
        if (requestedDirection === 'LONG' && suggestedDirection === 'SHORT') {
            score = Math.max(25, score - 20);
        } else if (requestedDirection === 'SHORT' && suggestedDirection === 'LONG') {
            score = Math.max(25, score - 20);
        }

        // Sort reasons by weight
        reasons.sort((a, b) => b.weight - a.weight);

        return { score, reasons, suggestedDirection };
    },

    _calculateLevels(price, direction, leverage, timeframe, highs, lows) {
        const atr = this._calculateATR(highs, lows, highs, 14); // Use highs as closes proxy

        const mults = this._atrMultipliers[timeframe] || this._atrMultipliers['15m'];
        const fallback = this._fallbackPct[timeframe] || this._fallbackPct['15m'];

        let tpDist, slDist;

        if (atr > 0) {
            tpDist = atr * mults.tp;
            slDist = atr * mults.sl;
        } else {
            tpDist = price * fallback.tp;
            slDist = price * fallback.sl;
        }

        // Ensure minimum R:R of 2:1
        if (tpDist < slDist * 2) {
            tpDist = slDist * 2;
        }

        let tp, sl, liq;

        if (direction === 'LONG') {
            tp = price + tpDist;
            sl = price - slDist;
            liq = price * (1 - 0.996 / leverage);
        } else {
            tp = price - tpDist;
            sl = price + slDist;
            liq = price * (1 + 0.996 / leverage);
        }

        // Round to appropriate precision
        const decimals = this._getPrecision(price);
        tp = parseFloat(tp.toFixed(decimals));
        sl = parseFloat(sl.toFixed(decimals));
        liq = parseFloat(liq.toFixed(decimals));

        return { tp, sl, liq, atr };
    },

    _getPrecision(price) {
        if (price >= 1000) return 2;
        if (price >= 100) return 3;
        if (price >= 1) return 4;
        if (price >= 0.01) return 5;
        if (price >= 0.001) return 6;
        return 8;
    },

    _createResult(decision, direction, confidence, reason) {
        return {
            decision,
            direction,
            confidence,
            reason,
            price: State.prices[State.symbol]?.price || 0,
            tp: 0,
            sl: 0,
            liq: 0,
            _clientSide: true
        };
    }
};
